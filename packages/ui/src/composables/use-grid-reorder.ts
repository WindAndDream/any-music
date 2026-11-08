import { nextTick, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { CSSProperties, MaybeRefOrGetter } from 'vue'

import { createDomGridReorderGeometry } from './dom-grid-reorder-geometry'
import { isFocusUnavailable } from './focus-availability'
import { retainGridMotionVisibility } from './grid-move-animations'
import type {
  GridReorderGeometryFactory,
  GridReorderGeometrySession,
  GridReorderRect,
} from './grid-reorder-geometry'
import type { QueueReorderSlot } from './music-sources/queue-reorder-geometry'
import { retainNativeScrollAnchor } from './native-scroll-anchor'
import { usePointerGestureGuard } from './use-pointer-gesture-guard'

type DragKind = string
interface UseGridReorderOptions<Kind extends DragKind> {
  idsByKind: MaybeRefOrGetter<Readonly<Record<Kind, readonly string[]>>>
  scrollElement: MaybeRefOrGetter<HTMLElement | null>
  /** The existing viewport, including a currently short/nonoverflowing virtual collection. */
  autoScrollElement?: MaybeRefOrGetter<HTMLElement | null>
  /** Stable drop slots use this prefix; an inner data-am-grid-motion surface shares their origin. */
  attributePrefix: string
  verticalKinds?: readonly Kind[]
  getGroupId?: (kind: Kind, id: string) => string | undefined
  getGroupElement?: (kind: Kind, element: HTMLElement) => HTMLElement | null
  /** Internal geometry boundary; omitted consumers retain the DOM slot adapter. */
  createGeometry?: GridReorderGeometryFactory<Kind>
  /** Bounded presentation hold. Rejecting a source/target cancels; never mount the full list. */
  retainItem?: (kind: Kind, id: string) => (() => void) | undefined
  /** Restore the moved handle by stable identity after committing; honor cancellation before focus. */
  focusItem?: (kind: Kind, id: string, signal: AbortSignal) => Promise<boolean>
  /** 每次拖动首次命中其他分组时通知；跨组落点不会提交排序。 */
  onGroupMismatch?: (kind: Kind, draggedId: string, targetId: string) => void
  move: (kind: Kind, draggedId: string, targetId: string, visibleIds: readonly string[]) => void
}
/** 稳定外层保留布局和指针捕获，内层浮起并让位；固定槽位命中避免动画反馈造成闪跳。 */
export function useGridReorder<Kind extends DragKind>(options: UseGridReorderOptions<Kind>) {
  const draggedId = shallowRef<string>()
  const dropTargetId = shallowRef<string>()
  const dragKind = shallowRef<Kind>()
  const draggedStyle = shallowRef<CSSProperties>()
  const shiftedStyles = shallowRef<ReadonlyMap<string, CSSProperties>>(new Map())
  const isSettling = shallowRef(false)
  const landing = shallowRef<{ kind: Kind; styles: ReadonlyMap<string, CSSProperties> }>()
  let landingFrame: number | undefined
  let landingTimer: ReturnType<typeof setTimeout> | undefined
  let landingElement: HTMLElement | undefined
  let settlingElements: HTMLElement[] = []
  let landingGeneration = 0
  let landingResizeObserver: ResizeObserver | undefined
  let stopLandingGeometryWatch: (() => void) | undefined
  let landingMotionQuery: MediaQueryList | undefined
  let landingOrder: readonly string[] = []
  let expectedLandingOrder: readonly string[] | undefined
  let landingContainer: HTMLElement | undefined
  let landingScrollElement: HTMLElement | undefined
  let pointerId: number | undefined
  let dragGeneration = 0
  let captureElement: HTMLElement | undefined
  let scrollElement: HTMLElement | undefined
  let startPoint: { x: number; y: number } | undefined
  let point: { x: number; y: number } | undefined
  let frame: number | undefined
  let sourceIds: readonly string[] = []
  let geometry: GridReorderGeometrySession | undefined
  let candidateIds: ReadonlySet<string> = new Set()
  let eligibleIds: ReadonlySet<string> = new Set()
  let sourceSlot: QueueReorderSlot | undefined
  let sourceElement: HTMLElement | undefined
  let lastOffset = { x: 0, y: 0 }
  let domain: GridReorderRect | undefined
  let initialBounds: DOMRect | undefined
  let initialScrollTop = 0
  let initialScrollHeight = 0
  let acceptedBounds: DOMRect | undefined
  let didMove = false
  let didReportGroupMismatch = false
  let disposed = false
  let resizeObserver: ResizeObserver | undefined
  let stopGeometryWatch: (() => void) | undefined
  let sourceRelease: (() => void) | undefined
  let sourceAnchorRelease: (() => void) | undefined
  let targetRelease: (() => void) | undefined
  let landingReleases: (() => void)[] = []
  const previewMotions = new Map<
    HTMLElement,
    { id: string; release: () => void; timer?: ReturnType<typeof setTimeout> }
  >()
  let keyboardFocus:
    | {
        kind: Kind
        id: string
        container: HTMLElement
        viewport: HTMLElement | null | undefined
        order: readonly string[]
        expectedOrder?: readonly string[]
        controller: AbortController
        release?: () => void
      }
    | undefined
  const gestureGuard = usePointerGestureGuard({ finish: finishDrag, cancel: clearDrag })

  function idsFor(kind: Kind): readonly string[] {
    return toValue(options.idsByKind)[kind]
  }

  function startDrag(event: PointerEvent, kind: Kind, id: string): void {
    if (
      event.isPrimary === false ||
      event.button !== 0 ||
      disposed ||
      pointerId !== undefined ||
      !idsFor(kind).includes(id)
    )
      return
    cancelKeyboardFocus()
    const element = toValue(options.scrollElement)
    if (!element || element.isConnected === false) return
    const viewport =
      options.autoScrollElement === undefined
        ? findScrollableAncestor(element)
        : (toValue(options.autoScrollElement) ?? undefined)
    // Acquire before clearing an older landing: there must be no native-anchor gap or
    // forced layout between the previous handoff and this gesture's geometry snapshot.
    const releaseAnchor = viewport ? retainNativeScrollAnchor(viewport) : undefined
    let adopted = false
    try {
      clearLanding()
      const bounds = element.getBoundingClientRect()
      const ids = [...idsFor(kind)]
      const eligible = new Set(
        ids.filter(
          (candidate) => options.getGroupId?.(kind, candidate) === options.getGroupId?.(kind, id),
        ),
      )
      const input = {
        kind,
        sourceId: id,
        ids,
        eligibleIds: eligible,
        container: element,
        bounds,
        initialScrollTop: element.scrollTop ?? 0,
      }
      const session = options.createGeometry
        ? options.createGeometry(input)
        : createDomGridReorderGeometry(input, {
            attributePrefix: options.attributePrefix,
            getGroupElement: options.getGroupElement,
            includeOtherGroups: Boolean(options.onGroupMismatch),
            vertical: options.verticalKinds?.includes(kind),
          })
      if (!session || session.sourceSlot.id !== id || session.isValid?.() === false) return
      const release = options.retainItem?.(kind, id)
      if (options.retainItem && !release) return
      sourceAnchorRelease = releaseAnchor
      adopted = true
      sourceRelease = release
      geometry = session
      candidateIds = new Set(ids)
      eligibleIds = eligible
      sourceSlot = session.sourceSlot
      sourceElement = session.sourceElement
      sourceElement.setAttribute('data-am-grid-source', '')
      domain = session.domain
      initialBounds = bounds
      acceptedBounds = bounds
      initialScrollTop = element.scrollTop ?? 0
      initialScrollHeight = element.scrollHeight
      event.preventDefault()
      ;(event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
      pointerId = event.pointerId
      captureElement = element
      element.setAttribute('data-am-grid-dragging', '')
      scrollElement = viewport
      startPoint = { x: event.clientX, y: event.clientY }
      point = startPoint
      sourceIds = ids
      draggedId.value = id
      dragKind.value = kind
      const generation = ++dragGeneration
      gestureGuard.start(event)
      element.addEventListener('pointermove', continueDrag)
      element.addEventListener('pointerup', finishDrag)
      element.addEventListener('pointercancel', cancelPointerDrag)
      element.addEventListener('lostpointercapture', handleLostPointerCapture)
      window.addEventListener('resize', clearDrag)
      // Shadow Root 内的滚动不一定传到 window；直接监听滚动容器，统一合并到同一帧。
      scrollElement?.addEventListener('scroll', scheduleFrame, { passive: true })
      window.addEventListener('scroll', scheduleFrame, { capture: true, passive: true })
      stopGeometryWatch = watch(
        [() => session.getRevision?.(), () => session.isValid?.()],
        () => {
          if (
            generation !== dragGeneration ||
            geometry !== session ||
            captureElement !== element ||
            pointerId === undefined
          )
            return
          if (session.isValid?.() === false) clearDrag()
          else scheduleFrame()
        },
        { flush: 'post' },
      )
      if (typeof ResizeObserver !== 'undefined') {
        // 侧栏开合也会改变槽位宽度；仅拖动期间观察网格，不给每张卡片分配观察器。
        resizeObserver = new ResizeObserver(() => {
          if (
            generation !== dragGeneration ||
            geometry !== session ||
            captureElement !== element ||
            pointerId === undefined
          )
            return
          const current = element.getBoundingClientRect()
          if (
            session.isValid?.() === false ||
            Math.abs(current.width - bounds.width) > 1 ||
            (!session.allowsHeightChanges && Math.abs(current.height - bounds.height) > 1)
          )
            clearDrag()
          else if (
            session.refreshHeight &&
            acceptedBounds &&
            Math.abs(current.height - acceptedBounds.height) > 1
          )
            scheduleFrame()
        })
        resizeObserver.observe(element)
      }
      element.setPointerCapture(event.pointerId)
    } catch (error) {
      if (adopted) clearDrag()
      throw error
    } finally {
      if (!adopted) releaseAnchor?.()
    }
  }

  function continueDrag(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return
    point = { x: event.clientX, y: event.clientY }
    scheduleFrame()
  }

  function scheduleFrame(): void {
    if (pointerId !== undefined && frame === undefined)
      frame = requestAnimationFrame(() => updateFrame())
  }

  function updateFrame(allowAutoScroll = true): void {
    frame = undefined
    if (
      !point ||
      !startPoint ||
      !sourceSlot ||
      !geometry ||
      !initialBounds ||
      !captureElement ||
      !dragKind.value ||
      !draggedId.value
    )
      return
    if (
      geometry.isValid?.() === false ||
      captureElement.isConnected === false ||
      geometry.sourceElement.isConnected === false ||
      scrollElement?.isConnected === false ||
      toValue(options.scrollElement) !== captureElement ||
      (options.autoScrollElement !== undefined &&
        (toValue(options.autoScrollElement) ?? undefined) !== scrollElement)
    ) {
      clearDrag()
      return
    }
    const bounds = captureElement.getBoundingClientRect()
    if (acceptedBounds && Math.abs(bounds.width - acceptedBounds.width) > 1) {
      clearDrag()
      return
    }
    let heightRefreshed = false
    // This existing root read also covers wheel -> pointerup before ResizeObserver delivery.
    // Ordinary pointer/scroll frames never rescan DOM slots when the height is unchanged.
    if (
      geometry.refreshHeight &&
      acceptedBounds &&
      Math.abs(bounds.height - acceptedBounds.height) > 1
    ) {
      if (!geometry.refreshHeight()) {
        clearDrag()
        return
      }
      heightRefreshed = true
      acceptedBounds = bounds
      domain = geometry.domain
      initialScrollHeight = captureElement.scrollHeight
    }
    const x = point.x - bounds.left
    // 自身滚动与祖先滚动都换算到开始拖动时的槽位坐标；滚轮移动时指针可以保持不动。
    let y = point.y - bounds.top + (captureElement.scrollTop ?? 0) - initialScrollTop
    const originX = startPoint.x - initialBounds.left
    const originY = startPoint.y - initialBounds.top
    if (!didMove && !heightRefreshed && Math.hypot(x - originX, y - originY) < 6) return
    didMove = true
    let scrolling = false
    let nextScrollTop: number | undefined
    if (scrollElement && allowAutoScroll) {
      const scrollBounds =
        scrollElement === captureElement ? bounds : scrollElement.getBoundingClientRect()
      // 以实际可见边缘滚动；停住指针也可继续移动到视口外的歌曲。
      const top = Math.max(0, scrollBounds.top)
      const bottom = Math.min(window.innerHeight, scrollBounds.bottom)
      const step = point.y < top + 40 ? -14 : point.y > bottom - 40 ? 14 : 0
      const previous = scrollElement.scrollTop
      if (step && point.y >= top - 40 && point.y <= bottom + 40) {
        nextScrollTop = Math.max(
          0,
          Math.min(scrollElement.scrollHeight - scrollElement.clientHeight, previous + step),
        )
        const delta = nextScrollTop - previous
        y += delta
        scrolling = delta !== 0
      }
    }
    // A newly measured preceding row may move the retained source's natural slot.
    // Subtract that movement from its pointer transform, preserving the grabbed point.
    const currentSourceSlot = geometry.sourceSlot
    const dx =
      (options.verticalKinds?.includes(dragKind.value) ? 0 : x - originX) -
      (currentSourceSlot.left - sourceSlot.left)
    const dy = y - originY - (currentSourceSlot.top - sourceSlot.top)
    if (!draggedStyle.value || dx !== lastOffset.x || dy !== lastOffset.y) {
      draggedStyle.value = { transform: `translate3d(${dx}px, ${dy}px, 0)` }
      lastOffset = { x: dx, y: dy }
    }
    const area = domain ?? {
      left: 0,
      top: -initialScrollTop,
      width: bounds.width,
      height:
        captureElement === scrollElement
          ? Math.max(bounds.height, initialScrollHeight)
          : bounds.height,
    }
    const inDomain =
      x >= area.left && x <= area.left + area.width && y >= area.top && y <= area.top + area.height
    const candidate = inDomain
      ? geometry.findSlot(
          currentSourceSlot.left + currentSourceSlot.width / 2 + dx,
          currentSourceSlot.top + currentSourceSlot.height / 2 + dy,
        )
      : undefined
    // 同时命中所有候选槽位，避免把跨组落点误投到最近的同组项并保存错误顺序。
    const knownCandidate = candidate && candidateIds.has(candidate.id) ? candidate : undefined
    const target = knownCandidate && eligibleIds.has(knownCandidate.id) ? knownCandidate : undefined
    if (knownCandidate && !target && !didReportGroupMismatch) {
      didReportGroupMismatch = true
      options.onGroupMismatch?.(dragKind.value, draggedId.value, knownCandidate.id)
    }
    const targetId = target?.id === draggedId.value ? undefined : target?.id
    const targetChanged = targetId !== dropTargetId.value
    if (targetChanged) {
      // The previous destination's interaction ends here. Release it synchronously before
      // acquiring its replacement, keeping at most source + destination against the cap.
      // The source lease stays held throughout; no render tick or full-list fallback occurs.
      const previousRelease = targetRelease
      targetRelease = undefined
      previousRelease?.()
      const release = targetId ? options.retainItem?.(dragKind.value, targetId) : undefined
      if (targetId && options.retainItem && !release) {
        clearDrag()
        return
      }
      targetRelease = release
      dropTargetId.value = targetId
    }
    // Newly mounted neighbors need the current preview even if the pointer and target stay
    // still. The adapter only returns mounted/pinned identities; no full-collection styles.
    if (targetChanged || heightRefreshed || geometry.getRevision) {
      const offsets = targetId ? geometry.getOffsets(targetId) : new Map()
      const styles = new Map(
        [...offsets].map(([id, offset]) => {
          const transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`
          const previous = shiftedStyles.value.get(id)
          // 落点改变时复用位移相同的对象，已经让位的邻项无需再次渲染。
          return [id, previous?.transform === transform ? previous : { transform }] as const
        }),
      )
      if (
        styles.size !== shiftedStyles.value.size ||
        [...styles].some(([id, style]) => shiftedStyles.value.get(id) !== style)
      ) {
        syncPreviewMotions(styles)
        shiftedStyles.value = styles
      }
    }
    // 所有几何读取完成后再写滚动，避免同一帧 scrollTop 写入后立即强制布局。
    if (scrollElement && nextScrollTop !== undefined && scrolling)
      scrollElement.scrollTop = nextScrollTop
    if (scrolling) scheduleFrame()
  }

  function syncPreviewMotions(styles: ReadonlyMap<string, CSSProperties>) {
    const container = captureElement
    const kind = dragKind.value
    if (!container || !kind) return
    // Resolve only changed, already mounted slots; unchanged pointer frames do no DOM lookup.
    for (const id of styles.keys()) {
      if (id === draggedId.value) continue
      const element = geometry?.getMountedElement?.(id)
      if (!element) continue
      let motion = previewMotions.get(element)
      if (!motion) {
        motion = { id, release: retainGridMotionVisibility(element) }
        previewMotions.set(element, motion)
      }
      clearTimeout(motion.timer)
      motion.timer = undefined
    }
    const duration = getLandingDuration(container)
    for (const [element, motion] of previewMotions) {
      if (element.isConnected === false) {
        clearTimeout(motion.timer)
        motion.release()
        previewMotions.delete(element)
      } else if (!styles.has(motion.id) && motion.timer === undefined) {
        // A neighbor removed from the preview still transitions back to its natural slot.
        // Built-in transitions have no delays and finish within this shared token budget.
        const timer = setTimeout(() => {
          if (motion.timer !== timer) return
          motion.release()
          previewMotions.delete(element)
        }, duration)
        motion.timer = timer
      }
    }
  }

  function finishDrag(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    point = { x: event.clientX, y: event.clientY }
    // Pointer release may update the final hit target, but cannot scroll one more edge step.
    updateFrame(false)
    if (pointerId === undefined) return
    const sourceId = draggedId.value
    const targetId = dropTargetId.value
    const kind = dragKind.value
    const visibleIds = sourceIds
    // Only the controlled move's one expected identity update belongs to this handoff.
    // Later filters/removals/reorders must not leave retained, stale landing surfaces.
    const eligibleOrder = visibleIds.filter((id) => eligibleIds.has(id))
    const from = sourceId ? eligibleOrder.indexOf(sourceId) : -1
    const to = targetId ? eligibleOrder.indexOf(targetId) : -1
    if (from >= 0 && to >= 0) eligibleOrder.splice(to, 0, ...eligibleOrder.splice(from, 1))
    let eligibleIndex = 0
    const committedOrder = visibleIds.map((id) =>
      eligibleIds.has(id) ? eligibleOrder[eligibleIndex++]! : id,
    )
    const row = sourceElement
    const rect = row?.getBoundingClientRect()
    const visualPosition = rect
      ? { x: rect.left + lastOffset.x, y: rect.top + lastOffset.y }
      : undefined
    const style = draggedStyle.value
    const releaseGeometry = geometry
    const container = captureElement
    const viewport = scrollElement
    const releaseBounds = container?.getBoundingClientRect()
    const releaseScrollTop = container?.scrollTop ?? 0
    const shiftedIds = new Set([
      ...shiftedStyles.value.keys(),
      ...[...previewMotions.values()].map(({ id }) => id),
    ])
    const neighbors =
      kind && targetId && container
        ? [
            ...container.querySelectorAll<HTMLElement>(
              `[data-${options.attributePrefix}-drop-kind="${kind}"]`,
            ),
          ].filter((element) =>
            shiftedIds.has(element.dataset[`${options.attributePrefix}DropId`] ?? ''),
          )
        : []
    // A quick release can interrupt a neighbor's CSS transition before it reaches its preview
    // slot. Measure the aligned motion surface, not just its intended translation, before writes.
    const neighborPositions = neighbors.flatMap((element) => {
      const surface = element.querySelector?.<HTMLElement>('[data-am-grid-motion]')
      if (!surface?.getBoundingClientRect) return []
      const bounds = element.getBoundingClientRect()
      const visual = surface.getBoundingClientRect()
      return [{ element, id: element.dataset[`${options.attributePrefix}DropId`]!, bounds, visual }]
    })
    // Transfer the existing leases before clearDrag; there is no unretained render tick
    // between release, the controlled snapshot update, and the final landing frame.
    const releases = [sourceRelease, targetRelease, sourceAnchorRelease].filter(
      (release): release is () => void => Boolean(release),
    )
    sourceRelease = targetRelease = undefined
    sourceAnchorRelease = undefined
    if (!sourceId || !targetId || !kind) {
      clearDrag()
      for (const release of releases) release()
      return
    }
    // Transfer rendering protection before removing any drag/preview marker. A forced layout
    // read in the handoff must never see an unprotected content-visibility:auto descendant.
    row?.setAttribute('data-am-grid-landing', '')
    for (const neighbor of neighbors) neighbor.setAttribute('data-am-grid-settling', '')
    clearDrag()
    landingReleases = releases
    isSettling.value = true
    landingElement = row
    settlingElements = neighbors
    // Freeze measured neighbors at their current visual positions through the controlled reorder.
    // Surfaces without measurements keep the completed-preview handoff.
    const styles = new Map<string, CSSProperties>(
      [...shiftedIds].map((id) => [id, { transition: 'none', contentVisibility: 'visible' }]),
    )
    for (const { id, bounds, visual } of neighborPositions)
      styles.set(id, {
        transform: `translate3d(${visual.left - bounds.left}px, ${visual.top - bounds.top}px, 0)`,
        transition: 'none',
        contentVisibility: 'visible',
      })
    // The motion owner must suppress transitions itself: not every theme/page has a settling rule.
    // Keep content rendered while the old translation is rebased against the new layout slot.
    if (style) styles.set(sourceId, { ...style, transition: 'none', contentVisibility: 'visible' })
    landing.value = { kind, styles }
    landingOrder = visibleIds
    expectedLandingOrder = committedOrder
    landingContainer = container
    landingScrollElement = viewport
    window.addEventListener('resize', clearLanding)
    landingMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    landingMotionQuery?.addEventListener?.('change', handleLandingMotionChange)
    const generation = ++landingGeneration
    let landingBounds = container?.getBoundingClientRect()
    const rebaseMeasuredLanding = () => {
      if (!isCurrentLanding(generation) || !isSettling.value || !row || !visualPosition) return
      const currentBounds = container?.getBoundingClientRect()
      // Keep frozen positions in the scrolling content, so a continued wheel gesture
      // moves the landing naturally instead of pulling it back to an old viewport point.
      const scrollX = currentBounds && releaseBounds ? currentBounds.left - releaseBounds.left : 0
      const scrollY =
        (currentBounds && releaseBounds ? currentBounds.top - releaseBounds.top : 0) -
        ((container?.scrollTop ?? 0) - releaseScrollTop)
      const next = new Map(styles)
      for (const { element, id, visual } of neighborPositions) {
        if (element.isConnected === false) continue
        const slot = element.getBoundingClientRect()
        next.set(id, {
          transform: `translate3d(${visual.left + scrollX - slot.left}px, ${visual.top + scrollY - slot.top}px, 0)`,
          transition: 'none',
          contentVisibility: 'visible',
        })
      }
      const destination = row.getBoundingClientRect()
      landing.value = {
        kind,
        styles: next.set(sourceId, {
          transform: `translate3d(${visualPosition.x + scrollX - destination.left}px, ${visualPosition.y + scrollY - destination.top}px, 0)`,
          transition: 'none',
          contentVisibility: 'visible',
        }),
      }
    }
    if (releaseGeometry?.allowsHeightChanges) {
      // Controlled regrouping resets stretched-height history. Final natural heights
      // can publish after the parent render; keep release positions frozen until the
      // landing frame, rather than rebasing against only the first estimated layout.
      stopLandingGeometryWatch = watch(
        () => releaseGeometry.getLayoutRevision?.(),
        () => {
          rebaseMeasuredLanding()
          // The geometry may publish before its parent's DOM patch. Realign again
          // after that patch, under the same landing generation and frozen lifetime.
          void nextTick(rebaseMeasuredLanding)
        },
        { flush: 'sync' },
      )
    }
    if (typeof ResizeObserver !== 'undefined' && container) {
      landingResizeObserver = new ResizeObserver(() => {
        if (!isCurrentLanding(generation) || !landingBounds) return
        const current = container.getBoundingClientRect()
        if (
          Math.abs(current.width - landingBounds.width) > 1 ||
          (!(releaseGeometry?.allowsHeightChanges && isSettling.value) &&
            Math.abs(current.height - landingBounds.height) > 1)
        )
          clearLanding()
        else if (releaseGeometry?.allowsHeightChanges && isSettling.value) {
          landingBounds = current
          rebaseMeasuredLanding()
        }
      })
      landingResizeObserver.observe(container)
    }
    try {
      options.move(kind, sourceId, targetId, visibleIds)
    } catch (error) {
      clearLanding()
      throw error
    }
    // A synchronous host callback can cancel, dispose or begin a new gesture.
    // It must not be followed by a newly authorized continuation of this release.
    if (disposed || generation !== landingGeneration) return
    // 松手的 DOM 重排不能再叠加 FLIP：拖动项和仍在让位的邻项都从实际可见位置落位。
    void nextTick(async () => {
      if (!isCurrentLanding(generation)) return
      // Reduced motion commits normally but needs no rebasing frame, landing timer or lease tail.
      if (landingMotionQuery?.matches) {
        clearLanding()
        return
      }
      if (!row || !visualPosition) {
        clearLanding()
        return
      }
      // A controlled regrouping may change total height; accept its committed extent,
      // while a width change invalidates the original spatial handoff.
      const committedBounds = container?.getBoundingClientRect()
      if (
        committedBounds &&
        landingBounds &&
        Math.abs(committedBounds.width - landingBounds.width) > 1
      ) {
        clearLanding()
        return
      }
      landingBounds = committedBounds
      // move is a synchronous intent; allow its queued parent render, not a later
      // unrelated order publication after the release position has been rebased.
      expectedLandingOrder = undefined
      rebaseMeasuredLanding()
      await nextTick()
      if (!isCurrentLanding(generation)) return
      // 先让浏览器计算禁用过渡时的起始位置，下一帧再启用落位过渡。
      row.getBoundingClientRect()
      const startLandingMotion = () => {
        landingFrame = undefined
        if (!isCurrentLanding(generation)) return
        const currentBounds = container?.getBoundingClientRect()
        if (currentBounds && landingBounds) {
          if (Math.abs(currentBounds.width - landingBounds.width) > 1) {
            clearLanding()
            return
          }
          if (
            releaseGeometry?.allowsHeightChanges &&
            Math.abs(currentBounds.height - landingBounds.height) > 1
          ) {
            // A committed measurement/window patch may finish before its RO notification.
            // Freeze/rebase that final layout before starting motion, rather than letting
            // the delayed notification cancel a landing that has just begun.
            landingBounds = currentBounds
            rebaseMeasuredLanding()
            void nextTick(() => {
              if (!isCurrentLanding(generation)) return
              row.getBoundingClientRect()
              landingFrame = requestAnimationFrame(startLandingMotion)
            })
            return
          }
          landingBounds = currentBounds
        }
        stopLandingGeometryWatch?.()
        stopLandingGeometryWatch = undefined
        isSettling.value = false
        // Release only the translation. Dropping elevation/content visibility now can hide the
        // moving item behind its newly reordered neighbors or cull it before the transition ends.
        landing.value = {
          kind,
          styles: new Map(
            [sourceId, ...shiftedIds].map((id) => [id, { contentVisibility: 'visible' }]),
          ),
        }
        landingTimer = setTimeout(() => {
          if (generation === landingGeneration) clearLanding()
        }, getLandingDuration(container))
      }
      landingFrame = requestAnimationFrame(startLandingMotion)
    })
  }

  function isCurrentLanding(generation: number): boolean {
    if (disposed || generation !== landingGeneration) return false
    if (
      landingElement?.isConnected === false ||
      landingContainer?.isConnected === false ||
      landingScrollElement?.isConnected === false ||
      toValue(options.scrollElement) !== landingContainer ||
      (options.autoScrollElement !== undefined &&
        (toValue(options.autoScrollElement) ?? undefined) !== landingScrollElement)
    ) {
      clearLanding()
      return false
    }
    return true
  }

  function clearLanding(): void {
    landingGeneration += 1
    if (landingFrame !== undefined) cancelAnimationFrame(landingFrame)
    landingFrame = undefined
    clearTimeout(landingTimer)
    landingTimer = undefined
    landingResizeObserver?.disconnect()
    landingResizeObserver = undefined
    stopLandingGeometryWatch?.()
    stopLandingGeometryWatch = undefined
    landingMotionQuery?.removeEventListener?.('change', handleLandingMotionChange)
    landingMotionQuery = undefined
    if (landingContainer) window.removeEventListener('resize', clearLanding)
    landingContainer = landingScrollElement = undefined
    landingOrder = []
    expectedLandingOrder = undefined
    landingElement?.removeAttribute('data-am-grid-landing')
    landingElement = undefined
    for (const element of settlingElements) element.removeAttribute('data-am-grid-settling')
    settlingElements = []
    isSettling.value = false
    landing.value = undefined
    const releases = landingReleases
    landingReleases = []
    for (const release of releases) release()
  }

  function handleLandingMotionChange(): void {
    if (landingMotionQuery?.matches) clearLanding()
  }

  function clearDrag(): void {
    dragGeneration++
    gestureGuard.stop()
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    resizeObserver?.disconnect()
    resizeObserver = undefined
    stopGeometryWatch?.()
    stopGeometryWatch = undefined
    const element = captureElement
    captureElement = undefined
    element?.removeAttribute('data-am-grid-dragging')
    element?.removeEventListener('pointermove', continueDrag)
    element?.removeEventListener('pointerup', finishDrag)
    element?.removeEventListener('pointercancel', cancelPointerDrag)
    element?.removeEventListener('lostpointercapture', handleLostPointerCapture)
    scrollElement?.removeEventListener('scroll', scheduleFrame)
    if (element) {
      window.removeEventListener('resize', clearDrag)
      window.removeEventListener('scroll', scheduleFrame, { capture: true })
    }
    if (pointerId !== undefined && element?.hasPointerCapture(pointerId))
      element.releasePointerCapture(pointerId)
    pointerId = undefined
    point = startPoint = undefined
    scrollElement = undefined
    didMove = false
    didReportGroupMismatch = false
    sourceIds = []
    geometry = undefined
    candidateIds = new Set()
    eligibleIds = new Set()
    sourceSlot = domain = undefined
    sourceElement?.removeAttribute('data-am-grid-source')
    sourceElement = undefined
    lastOffset = { x: 0, y: 0 }
    initialBounds = undefined
    acceptedBounds = undefined
    initialScrollTop = 0
    initialScrollHeight = 0
    draggedId.value = dropTargetId.value = undefined
    dragKind.value = undefined
    draggedStyle.value = undefined
    shiftedStyles.value = new Map()
    for (const [element, motion] of previewMotions) {
      clearTimeout(motion.timer)
      motion.release()
      previewMotions.delete(element)
    }
    const releases = [sourceRelease, targetRelease, sourceAnchorRelease]
    sourceRelease = targetRelease = undefined
    sourceAnchorRelease = undefined
    for (const release of releases) release?.()
  }

  function cancelPointerDrag(event: PointerEvent): void {
    if (event.pointerId === pointerId) clearDrag()
  }

  function handleLostPointerCapture(event: PointerEvent): void {
    // 触屏手柄的隐式捕获移交给网格时也会冒泡此事件；只有网格自身失去捕获才取消。
    if (event.target === captureElement) cancelPointerDrag(event)
  }

  function shift(kind: Kind, id: string, direction: -1 | 1): void {
    cancelKeyboardFocus()
    clearLanding()
    clearDrag()
    if (disposed) return
    const element = toValue(options.scrollElement)
    const active = typeof document === 'undefined' ? null : getActiveElement(element)
    const restoreFocus = isSourceHandle(active, kind, id)
    const allIds = idsFor(kind)
    const ids = allIds.filter(
      (candidate) => options.getGroupId?.(kind, candidate) === options.getGroupId?.(kind, id),
    )
    const index = ids.indexOf(id)
    const targetId = index >= 0 ? ids[index + direction] : undefined
    if (!targetId) return
    if (!restoreFocus || !element) {
      options.move(kind, id, targetId, ids)
      return
    }
    const release = options.focusItem ? options.retainItem?.(kind, id) : undefined
    if (options.focusItem && options.retainItem && !release) return
    const reordered = [...ids]
    reordered.splice(index + direction, 0, ...reordered.splice(index, 1))
    const eligible = new Set(ids)
    let nextIndex = 0
    const request = {
      kind,
      id,
      container: element,
      viewport:
        options.autoScrollElement === undefined ? undefined : toValue(options.autoScrollElement),
      order: [...allIds],
      expectedOrder: allIds.map((candidate) =>
        eligible.has(candidate) ? reordered[nextIndex++]! : candidate,
      ) as readonly string[] | undefined,
      controller: new AbortController(),
      release,
    }
    keyboardFocus = request
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'])
      window.addEventListener(type, cancelKeyboardFocus, { capture: true, passive: true })
    window.addEventListener('focusin', handleKeyboardFocusIn, true)
    try {
      options.move(kind, id, targetId, ids)
    } catch (error) {
      if (keyboardFocus === request) cancelKeyboardFocus()
      throw error
    }
    // Wait for the controlled parent commit before navigating, also avoiding cancellation by
    // the initiating keydown bubbling to the scroll root. Dialog actions never enter this path.
    void (async () => {
      try {
        await nextTick()
        if (options.focusItem) await nextTick()
        if (!isCurrentKeyboardFocus(request)) return
        request.expectedOrder = undefined
        if (options.focusItem) {
          await options.focusItem(kind, id, request.controller.signal)
          return
        }
        const row = [
          ...element.querySelectorAll<HTMLElement>(
            `[data-${options.attributePrefix}-drop-kind="${kind}"]`,
          ),
        ].find((candidate) => candidate.dataset[`${options.attributePrefix}DropId`] === id)
        const handle = row?.querySelector<HTMLElement>(`[data-${options.attributePrefix}-handle]`)
        if (handle && handle.isConnected !== false && !isFocusUnavailable(handle))
          handle.focus({ preventScroll: true })
      } catch {
        // Focus is best-effort presentation work; a rejected adapter cannot undo the move.
      } finally {
        if (keyboardFocus === request) cancelKeyboardFocus()
      }
    })()
  }

  function isSourceHandle(active: Element | null, kind: Kind, id: string): boolean {
    return Boolean(
      active?.hasAttribute?.(`data-${options.attributePrefix}-handle`) &&
      active.closest<HTMLElement>(`[data-${options.attributePrefix}-drop-kind="${kind}"]`)?.dataset[
        `${options.attributePrefix}DropId`
      ] === id,
    )
  }

  function handleKeyboardFocusIn(event: Event): void {
    const request = keyboardFocus
    if (
      request &&
      !isSourceHandle(
        (event.composedPath()[0] ?? event.target) as Element,
        request.kind,
        request.id,
      )
    )
      cancelKeyboardFocus()
  }

  function isCurrentKeyboardFocus(request: NonNullable<typeof keyboardFocus>): boolean {
    if (keyboardFocus !== request) return false
    if (
      disposed ||
      !request.container.isConnected ||
      isFocusUnavailable(request.container) ||
      toValue(options.scrollElement) !== request.container ||
      (options.autoScrollElement !== undefined &&
        toValue(options.autoScrollElement) !== request.viewport) ||
      !idsFor(request.kind).includes(request.id)
    ) {
      cancelKeyboardFocus()
      return false
    }
    return true
  }

  function cancelKeyboardFocus(): void {
    const request = keyboardFocus
    if (!request) return
    keyboardFocus = undefined
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'])
      window.removeEventListener(type, cancelKeyboardFocus, true)
    window.removeEventListener('focusin', handleKeyboardFocusIn, true)
    request.controller.abort()
    request.release?.()
  }

  function getItemStyle(kind: Kind, id: string): CSSProperties | undefined {
    if (landing.value?.kind === kind && landing.value.styles.has(id))
      return landing.value.styles.get(id)
    if (kind !== dragKind.value) return undefined
    return id === draggedId.value ? draggedStyle.value : shiftedStyles.value.get(id)
  }

  // 上层公开状态可刷新出新数组；只有 ID/顺序变化才使槽位失效，不能因元数据更新吞掉拖动。
  watch(
    () => toValue(options.idsByKind),
    (next, previous) => {
      const kinds = Object.keys(next) as Kind[]
      if (
        kinds.length !== Object.keys(previous).length ||
        kinds.some((kind) => {
          const before = previous[kind]
          const after = next[kind]
          return (
            !before ||
            before.length !== after.length ||
            after.some((id, index) => id !== before[index])
          )
        })
      ) {
        clearDrag()
        if (keyboardFocus) {
          const after = next[keyboardFocus.kind]
          if (sameIds(after, keyboardFocus.expectedOrder)) {
            keyboardFocus.order = after
            keyboardFocus.expectedOrder = undefined
          } else if (!sameIds(after, keyboardFocus.order)) cancelKeyboardFocus()
        }
        if (landing.value) {
          const after = next[landing.value.kind]
          if (sameIds(after, expectedLandingOrder)) {
            landingOrder = after
            expectedLandingOrder = undefined
          } else if (!sameIds(after, landingOrder)) clearLanding()
        }
      }
    },
    { flush: 'sync' },
  )
  watch(
    [
      () => toValue(options.scrollElement),
      () =>
        options.autoScrollElement === undefined ? undefined : toValue(options.autoScrollElement),
    ],
    () => {
      cancelKeyboardFocus()
      clearDrag()
      clearLanding()
    },
    { flush: 'sync' },
  )
  onScopeDispose(() => {
    disposed = true
    cancelKeyboardFocus()
    clearLanding()
    clearDrag()
  })
  return {
    draggedId: readonly(draggedId),
    dropTargetId: readonly(dropTargetId),
    dragKind: readonly(dragKind),
    getItemStyle,
    isSettling: readonly(isSettling),
    startDrag,
    continueDrag,
    finishDrag,
    clearDrag: () => {
      cancelKeyboardFocus()
      clearDrag()
      clearLanding()
    },
    shift,
  }
}

function sameIds(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  return Boolean(
    left && right && left.length === right.length && left.every((id, i) => id === right[i]),
  )
}

/** All built-in reorder transitions use these theme durations, without a transition delay. */
function getLandingDuration(element: HTMLElement | undefined): number {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return 0
  const style =
    element && typeof getComputedStyle !== 'undefined' ? getComputedStyle(element) : null
  const durations = ['fast', 'normal', 'slow'].map((speed) => {
    const token = style?.getPropertyValue?.(`--am-motion-${speed}`).trim() ?? ''
    const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
    return Number.isFinite(duration) ? duration : 340
  })
  return Math.max(0, ...durations)
}

function getActiveElement(element: HTMLElement | null): Element | null {
  const root = element?.getRootNode()
  return root instanceof ShadowRoot ? root.activeElement : document.activeElement
}

function findScrollableAncestor(start: HTMLElement): HTMLElement | undefined {
  let element: HTMLElement | null = start
  while (element) {
    if (
      element.scrollHeight > element.clientHeight + 2 &&
      /auto|scroll|overlay/.test(getComputedStyle(element).overflowY)
    )
      return element
    const root: Node = element.getRootNode()
    element =
      element.parentElement ??
      (root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null)
  }
  return undefined
}
