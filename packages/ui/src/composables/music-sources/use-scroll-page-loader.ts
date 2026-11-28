import { computed, nextTick, onScopeDispose, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { editingStateKey, type EditingSession } from '../use-editing-session'
import type { VirtualScrollMetrics } from '../virtual-scroll/use-virtual-scroll-context'
import type { VirtualItemKey } from '../virtual-scroll/virtual-row-geometry'

export interface VirtualPageGeometry {
  totalSize: MaybeRefOrGetter<number>
  context: {
    scrollElement: MaybeRefOrGetter<HTMLElement | null>
    metrics: MaybeRefOrGetter<VirtualScrollMetrics>
  }
  virtualItems?: MaybeRefOrGetter<readonly { key: VirtualItemKey }[]>
  measurements?: { getHeight(key: VirtualItemKey): number | undefined }
}

interface UseScrollPageLoaderOptions {
  editing?: EditingSession
  listElement: MaybeRefOrGetter<HTMLElement | null>
  /** Nonvirtual root override. Null waits for mount; undefined discovers the nearest root. */
  scrollElement?: MaybeRefOrGetter<HTMLElement | null | undefined>
  /** Accepts the fixed/dynamic list's full geometry without observing its mounted rows. */
  virtualList?: MaybeRefOrGetter<VirtualPageGeometry | undefined>
  hasMore: MaybeRefOrGetter<boolean>
  loading: MaybeRefOrGetter<boolean>
  pageNumber: MaybeRefOrGetter<number>
  /** Complete filtered collection count, never the mounted virtual window length. */
  visibleCount: MaybeRefOrGetter<number>
  /** Complete loaded collection count before filtering. */
  loadedCount: MaybeRefOrGetter<number>
  loadNext: () => void
  /** Disable background filling for retained discovery results; explicit scrolling still pages. */
  fillShortList?: MaybeRefOrGetter<boolean>
  /** Start one page ahead on downward input, using the current viewport height. */
  prefetch?: MaybeRefOrGetter<boolean>
  /** Restore the current list's position from its editing scope without adding pagination demand. */
  restoreScroll?: boolean
  /** Measure actual rows while preparing a new, unfiltered discovery viewport. */
  initialFill?: {
    enabled: MaybeRefOrGetter<boolean>
    contentElement: MaybeRefOrGetter<HTMLElement | null>
  }
}

const INITIAL_FILL_PAGE_LIMIT = 4
const INITIAL_FILL_TIMEOUT_MS = 4_000

interface PageAdmission {
  requestedPageNumber: number
  previousPageNumber: number
  wasLoading: boolean
  canRetry: boolean
  scrollTop?: number
  initialFillFinished?: boolean
}
const pageAdmissionKey = editingStateKey<PageAdmission>('scroll-page-loader:admission')
function createAdmission(): PageAdmission {
  return { requestedPageNumber: -1, previousPageNumber: 0, wasLoading: false, canRetry: false }
}

/** A native viewport and its Vue fallback share the same editing-session position. */
export function getPageScrollCheckpoint(editing: EditingSession) {
  const admission = editing.state(pageAdmissionKey, createAdmission)
  return {
    read: () => admission.scrollTop,
    save: (position: number) => {
      if (Number.isFinite(position) && position >= 0) admission.scrollTop = position
    },
  }
}

function findScrollContainer(element: HTMLElement): HTMLElement | undefined {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) return parent
  }
  return undefined
}

/** 在最近的滚动容器接近底部时逐页请求；短列表只补齐到能够滚动。 */
export function useScrollPageLoader(options: UseScrollPageLoaderOptions) {
  let scrollContainer: HTMLElement | undefined
  let listElement: HTMLElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let attachmentVersion = 0
  let restoreRevision = 0
  let lastScrollTop = 0
  let hasScrollDemand = false
  let touchY: number | undefined
  // A presentation replacement must not admit the same page again before its
  // request updates the host projection. Listeners still belong to this view.
  const admission = options.editing?.state(pageAdmissionKey, createAdmission) ?? createAdmission()
  const initialFill = options.initialFill
  const preparing = shallowRef(
    Boolean(initialFill && toValue(initialFill.enabled)) &&
      !admission.initialFillFinished &&
      admission.scrollTop === undefined,
  )
  let initialFillTimer: ReturnType<typeof setTimeout> | undefined
  const virtualList = computed(() => toValue(options.virtualList))
  const initialMeasurementsReady = computed(() => {
    const virtual = virtualList.value
    const measurements = virtual?.measurements
    if (!preparing.value || !measurements || toValue(options.visibleCount) === 0) return true
    // Wait for the leading window's natural sizes before estimates can finish preparation.
    const rows = toValue(virtual.virtualItems)
    return Boolean(
      rows?.length && rows.every(({ key }) => measurements.getHeight(key) !== undefined),
    )
  })
  const scrollRoot = computed(() => {
    // A virtual renderer already owns root selection and pooled geometry observation.
    const virtual = virtualList.value
    if (virtual)
      return toValue(virtual.context.metrics).ready
        ? toValue(virtual.context.scrollElement)
        : undefined
    const explicitRoot = toValue(options.scrollElement)
    if (explicitRoot !== undefined) return explicitRoot
    const element = toValue(options.listElement)
    return element ? findScrollContainer(element) : undefined
  })

  function requestNext(explicit = false): void {
    const pageNumber = toValue(options.pageNumber)
    if (
      (explicit && preparing.value) ||
      !toValue(options.hasMore) ||
      toValue(options.loading) ||
      (admission.requestedPageNumber === pageNumber && !(explicit && admission.canRetry))
    )
      return
    admission.requestedPageNumber = pageNumber
    admission.canRetry = false
    options.loadNext()
  }

  function getGeometry(): { bottom: number; viewportHeight: number } | undefined {
    if (
      !scrollContainer ||
      !listElement ||
      listElement !== toValue(options.listElement) ||
      scrollContainer !== scrollRoot.value
    )
      return
    if (!virtualList.value) {
      const viewportHeight = scrollContainer.clientHeight
      return viewportHeight > 0
        ? { bottom: scrollContainer.scrollHeight, viewportHeight }
        : undefined
    }
    const metrics = toValue(virtualList.value.context.metrics)
    const totalSize = toValue(virtualList.value.totalSize)
    const bottom = metrics.listOffset + totalSize
    if (
      !metrics.ready ||
      metrics.viewportHeight <= 0 ||
      !Number.isFinite(metrics.viewportHeight) ||
      !Number.isFinite(totalSize) ||
      totalSize < 0 ||
      !Number.isFinite(bottom)
    )
      return
    return { bottom, viewportHeight: metrics.viewportHeight }
  }

  function isNearBottom(allowPrefetch = false): boolean {
    const geometry = getGeometry()
    if (!scrollContainer || !geometry) return false
    const distance = geometry.bottom - scrollContainer.scrollTop - geometry.viewportHeight
    const threshold =
      allowPrefetch &&
      toValue(options.prefetch) &&
      toValue(options.visibleCount) === toValue(options.loadedCount)
        ? Math.max(240, Math.min(1600, geometry.viewportHeight * 1.5))
        : 240
    return distance <= threshold
  }

  function handleScroll(): void {
    if (!scrollContainer || preparing.value) return
    const scrollTop = scrollContainer.scrollTop
    const isScrollingDown = scrollTop > lastScrollTop
    const isScrollingUp = scrollTop < lastScrollTop
    lastScrollTop = scrollTop
    if (options.restoreScroll) admission.scrollTop = scrollTop
    const nearBottom = isNearBottom(true)
    if (!nearBottom || isScrollingUp) hasScrollDemand = false
    if (isScrollingDown && scrollTop > 0 && nearBottom) {
      hasScrollDemand = true
      requestNext(true)
    }
  }

  function handleWheel(event: WheelEvent): void {
    // At the bottom (including a short first page), a wheel has no scroll event.
    if (event.deltaY < 0) hasScrollDemand = false
    if (event.deltaY > 0 && isNearBottom(true)) {
      hasScrollDemand = true
      requestNext(true)
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.target !== listElement || !['ArrowDown', 'PageDown', 'End'].includes(event.key))
      return
    if (isNearBottom(true)) {
      hasScrollDemand = true
      requestNext(true)
    }
  }

  function handleTouchStart(event: TouchEvent): void {
    touchY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined
  }

  function handleTouchMove(event: TouchEvent): void {
    const nextY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined
    if (touchY === undefined || nextY === undefined) return
    if (nextY > touchY + 8) hasScrollDemand = false
    if (nextY < touchY - 8 && isNearBottom(true)) {
      touchY = nextY
      hasScrollDemand = true
      requestNext(true)
    }
  }

  function handleTouchEnd(): void {
    touchY = undefined
  }

  function continueScrollLoad(): void {
    if (preparing.value) return
    // Demand arriving during a load survives completion; filtered lists do not
    // keep paging in the background without another explicit scroll.
    if (!isNearBottom()) hasScrollDemand = false
    if (hasScrollDemand && toValue(options.visibleCount) === toValue(options.loadedCount))
      requestNext()
  }

  function detach(): void {
    attachmentVersion += 1
    if (options.restoreScroll && scrollContainer && !preparing.value)
      admission.scrollTop = scrollContainer.scrollTop
    listElement?.removeEventListener('keydown', handleKeyDown)
    listElement = undefined
    scrollContainer?.removeEventListener('scroll', handleScroll)
    scrollContainer?.removeEventListener('wheel', handleWheel)
    scrollContainer?.removeEventListener('touchstart', handleTouchStart)
    scrollContainer?.removeEventListener('touchmove', handleTouchMove)
    scrollContainer?.removeEventListener('touchend', handleTouchEnd)
    scrollContainer?.removeEventListener('touchcancel', handleTouchEnd)
    scrollContainer = undefined
    touchY = undefined
    resizeObserver?.disconnect()
    resizeObserver = undefined
  }

  /** Rebase pagination before the browser delivers scroll events from a viewport handoff. */
  function restorePosition(position: number): void {
    if (!scrollContainer || !Number.isFinite(position) || position < 0) return
    restoreRevision++
    scrollContainer.scrollTop = position
    lastScrollTop = scrollContainer.scrollTop
    hasScrollDemand = false
    if (options.restoreScroll && !preparing.value) admission.scrollTop = lastScrollTop
  }

  function revealInitialFill(): void {
    clearTimeout(initialFillTimer)
    if (scrollContainer) scrollContainer.scrollTop = 0
    lastScrollTop = 0
    hasScrollDemand = false
    if (options.restoreScroll) admission.scrollTop = 0
    admission.initialFillFinished = true
    preparing.value = false
  }

  function fillInitialViewport(): void {
    if (!initialFill || !preparing.value || !listElement) return
    if (!toValue(initialFill.enabled)) {
      revealInitialFill()
      return
    }
    if (toValue(options.loading)) return
    const pageNumber = toValue(options.pageNumber)
    if (
      !toValue(options.hasMore) ||
      pageNumber === 0 ||
      toValue(options.visibleCount) !== toValue(options.loadedCount) ||
      admission.canRetry ||
      pageNumber >= INITIAL_FILL_PAGE_LIMIT
    ) {
      revealInitialFill()
      return
    }
    initialFillTimer ??= setTimeout(revealInitialFill, INITIAL_FILL_TIMEOUT_MS)
    const geometry = getGeometry()
    if (!geometry || !scrollContainer || !initialMeasurementsReady.value) return
    const virtual = virtualList.value
    const hasRows = toValue(options.visibleCount) > 0
    const content = toValue(initialFill.contentElement)
    // Padding, loading indicators, and a stretched list surface do not count as rows.
    const paddingBottom = Number.parseFloat(getComputedStyle(scrollContainer).paddingBottom) || 0
    const rowsBottom = virtual
      ? hasRows
        ? geometry.bottom
        : 0
      : content && hasRows
        ? content.getBoundingClientRect().bottom -
          scrollContainer.getBoundingClientRect().top -
          scrollContainer.clientTop +
          scrollContainer.scrollTop
        : 0
    if (rowsBottom >= geometry.viewportHeight - paddingBottom - 1) {
      revealInitialFill()
    } else requestNext()
  }

  function fillShortList(): void {
    if (preparing.value) {
      fillInitialViewport()
      return
    }
    const geometry = getGeometry()
    if (
      toValue(options.fillShortList) === false ||
      !geometry ||
      toValue(options.loading) ||
      !toValue(options.hasMore) ||
      toValue(options.pageNumber) === 0 ||
      toValue(options.visibleCount) !== toValue(options.loadedCount) ||
      geometry.bottom > geometry.viewportHeight + 1
    )
      return
    // 仅在列表未经过筛选且尚不能滚动时逐页补齐，避免无用户滚动时全量预取。
    requestNext()
  }

  watch(
    () => toValue(options.loading),
    (loading) => {
      if (
        admission.wasLoading &&
        !loading &&
        admission.requestedPageNumber === toValue(options.pageNumber)
      ) {
        // No committed page means failure/cancellation. Only fresh user demand may retry;
        // a resize, remount or the retained demand must never create a background loop.
        admission.canRetry = true
        hasScrollDemand = false
      }
      admission.wasLoading = loading
    },
    // Observe even a same-tick failure before any post-render fill checks run.
    { immediate: true, flush: 'sync' },
  )

  watch(
    [() => toValue(options.listElement), () => scrollRoot.value, virtualList],
    ([element, root]) => {
      detach()
      hasScrollDemand = false
      listElement = element ?? undefined
      listElement?.addEventListener('keydown', handleKeyDown)
      scrollContainer = element ? (root ?? undefined) : undefined
      const restoredTop = preparing.value ? 0 : admission.scrollTop
      if (options.restoreScroll && scrollContainer && restoredTop !== undefined) {
        if (virtualList.value && restoredTop > 0 && scrollContainer.scrollTop !== restoredTop) {
          const version = attachmentVersion
          const revision = restoreRevision
          const initialTop = scrollContainer.scrollTop
          // The lazy grid can publish its root before its extent and engine offset finish mounting.
          void nextTick(() => {
            if (
              version === attachmentVersion &&
              revision === restoreRevision &&
              scrollContainer?.scrollTop === initialTop &&
              !hasScrollDemand
            )
              restorePosition(restoredTop)
          })
        } else restorePosition(restoredTop)
      }
      lastScrollTop = scrollContainer?.scrollTop ?? 0
      scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
      scrollContainer?.addEventListener('wheel', handleWheel, { passive: true })
      scrollContainer?.addEventListener('touchstart', handleTouchStart, { passive: true })
      scrollContainer?.addEventListener('touchmove', handleTouchMove, { passive: true })
      scrollContainer?.addEventListener('touchend', handleTouchEnd, { passive: true })
      scrollContainer?.addEventListener('touchcancel', handleTouchEnd, { passive: true })
      if (scrollContainer && !virtualList.value && typeof ResizeObserver !== 'undefined') {
        const version = attachmentVersion
        resizeObserver = new ResizeObserver(() => {
          if (version === attachmentVersion) fillShortList()
        })
        resizeObserver.observe(scrollContainer)
        if (element) resizeObserver.observe(element)
      }
      fillShortList()
    },
    { immediate: true, flush: 'post' },
  )

  watch(
    () =>
      [
        toValue(options.pageNumber),
        toValue(options.loading),
        toValue(options.hasMore),
        toValue(options.visibleCount),
        toValue(options.loadedCount),
        initialFill && toValue(initialFill.enabled),
        initialFill && toValue(initialFill.contentElement),
      ] as const,
    ([pageNumber]) => {
      if (pageNumber < admission.previousPageNumber) {
        admission.requestedPageNumber = -1
        admission.canRetry = false
        hasScrollDemand = false
      }
      admission.previousPageNumber = pageNumber
      continueScrollLoad()
      fillShortList()
    },
    { immediate: true, flush: 'post' },
  )

  watch(
    [
      () => virtualList.value && toValue(virtualList.value.context.metrics).ready,
      () => virtualList.value && toValue(virtualList.value.context.metrics).viewportHeight,
      () => virtualList.value && toValue(virtualList.value.context.metrics).listOffset,
      () => virtualList.value && toValue(virtualList.value.totalSize),
      initialMeasurementsReady,
      () => toValue(options.fillShortList),
    ],
    fillShortList,
    { flush: 'post' },
  )

  onScopeDispose(() => {
    clearTimeout(initialFillTimer)
    detach()
  })
  return { preparing: computed(() => preparing.value), restorePosition }
}
