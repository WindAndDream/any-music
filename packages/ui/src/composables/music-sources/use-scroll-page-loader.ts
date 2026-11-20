import { computed, onScopeDispose, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { editingStateKey, type EditingSession } from '../use-editing-session'
import type { VirtualScrollMetrics } from '../virtual-scroll/use-virtual-scroll-context'

interface UseScrollPageLoaderOptions {
  editing?: EditingSession
  listElement: MaybeRefOrGetter<HTMLElement | null>
  /** Nonvirtual root override. Null waits for mount; undefined discovers the nearest root. */
  scrollElement?: MaybeRefOrGetter<HTMLElement | null | undefined>
  /** Accepts the fixed/dynamic list's full geometry without observing its mounted rows. */
  virtualList?: {
    totalSize: MaybeRefOrGetter<number>
    context: {
      scrollElement: MaybeRefOrGetter<HTMLElement | null>
      metrics: MaybeRefOrGetter<VirtualScrollMetrics>
    }
  }
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
  /** Restore the current list's position from its editing scope before listening for scroll. */
  restoreScroll?: boolean
}

interface PageAdmission {
  requestedPageNumber: number
  previousPageNumber: number
  wasLoading: boolean
  canRetry: boolean
  scrollTop?: number
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
export function useScrollPageLoader(options: UseScrollPageLoaderOptions): void {
  let scrollContainer: HTMLElement | undefined
  let listElement: HTMLElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let attachmentVersion = 0
  let lastScrollTop = 0
  let hasScrollDemand = false
  let touchY: number | undefined
  // A presentation replacement must not admit the same page again before its
  // request updates the host projection. Listeners still belong to this view.
  const admission = options.editing?.state(pageAdmissionKey, createAdmission) ?? createAdmission()
  const scrollRoot = computed(() => {
    // A virtual renderer already owns root selection and pooled geometry observation.
    if (options.virtualList) return toValue(options.virtualList.context.scrollElement)
    const explicitRoot = toValue(options.scrollElement)
    if (explicitRoot !== undefined) return explicitRoot
    const element = toValue(options.listElement)
    return element ? findScrollContainer(element) : undefined
  })

  function requestNext(explicit = false): void {
    const pageNumber = toValue(options.pageNumber)
    if (
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
    if (!options.virtualList) {
      const viewportHeight = scrollContainer.clientHeight
      return viewportHeight > 0
        ? { bottom: scrollContainer.scrollHeight, viewportHeight }
        : undefined
    }
    const metrics = toValue(options.virtualList.context.metrics)
    const totalSize = toValue(options.virtualList.totalSize)
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
    if (!scrollContainer) return
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
    // Demand arriving during a load survives completion; filtered lists do not
    // keep paging in the background without another explicit scroll.
    if (!isNearBottom()) hasScrollDemand = false
    if (hasScrollDemand && toValue(options.visibleCount) === toValue(options.loadedCount))
      requestNext()
  }

  function detach(): void {
    attachmentVersion += 1
    if (options.restoreScroll && scrollContainer) admission.scrollTop = scrollContainer.scrollTop
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

  function fillShortList(): void {
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
    [() => toValue(options.listElement), () => scrollRoot.value],
    ([element, root]) => {
      detach()
      hasScrollDemand = false
      listElement = element ?? undefined
      listElement?.addEventListener('keydown', handleKeyDown)
      scrollContainer = element ? (root ?? undefined) : undefined
      if (scrollContainer && options.restoreScroll && admission.scrollTop !== undefined)
        scrollContainer.scrollTop = admission.scrollTop
      lastScrollTop = scrollContainer?.scrollTop ?? 0
      scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
      scrollContainer?.addEventListener('wheel', handleWheel, { passive: true })
      scrollContainer?.addEventListener('touchstart', handleTouchStart, { passive: true })
      scrollContainer?.addEventListener('touchmove', handleTouchMove, { passive: true })
      scrollContainer?.addEventListener('touchend', handleTouchEnd, { passive: true })
      scrollContainer?.addEventListener('touchcancel', handleTouchEnd, { passive: true })
      if (scrollContainer && !options.virtualList && typeof ResizeObserver !== 'undefined') {
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
      () => options.virtualList && toValue(options.virtualList.context.metrics).ready,
      () => options.virtualList && toValue(options.virtualList.context.metrics).viewportHeight,
      () => options.virtualList && toValue(options.virtualList.context.metrics).listOffset,
      () => options.virtualList && toValue(options.virtualList.totalSize),
      () => toValue(options.fillShortList),
    ],
    fillShortList,
    { flush: 'post' },
  )

  onScopeDispose(detach)
}
