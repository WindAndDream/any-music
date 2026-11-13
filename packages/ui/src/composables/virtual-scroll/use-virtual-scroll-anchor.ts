import { nextTick, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { retainNativeScrollAnchor as suppressNativeAnchor } from '../native-scroll-anchor'
import type { useVirtualScrollContext } from './use-virtual-scroll-context'
import type { VirtualItemKey } from './virtual-row-geometry'

export interface VirtualScrollAnchorItem {
  key: VirtualItemKey
  index: number
  /** List-local coordinates, without preceding headers. */
  start: number
  end: number
  size: number
}

/** Immutable layout snapshot. Lookups must not scan the complete collection during scrolling. */
export interface VirtualScrollAnchorGeometry {
  count: number
  totalSize: number
  getItem: (index: number) => VirtualScrollAnchorItem | undefined
  indexOf: (key: VirtualItemKey) => number | undefined
  findItemAtOffset: (offset: number) => VirtualScrollAnchorItem | undefined
}

export interface VirtualScrollAnchorOptions {
  context: ReturnType<typeof useVirtualScrollContext>
  geometry: MaybeRefOrGetter<VirtualScrollAnchorGeometry>
  enabled?: MaybeRefOrGetter<boolean>
  /** Advance for intentional scroll resets/navigation, together with the new collection. */
  resetKey?: MaybeRefOrGetter<unknown>
}

export interface VirtualScrollAnchor {
  key: VirtualItemKey
  index: number
  /** Offset of the viewport start inside this occurrence, including a following row gap. */
  offset: number
}

interface CapturedAnchor {
  root: HTMLElement
  scrollOffset: number
  candidates: readonly VirtualScrollAnchor[]
}

function isScrollKey(event: Event) {
  const key = (event as KeyboardEvent).key
  return ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(key)
}

/**
 * Opt-in semantic compensation for an existing vertical scroll root. Changes coalesce after
 * Vue renders; input, actual scrolling, reset and presentation replacement always win.
 * Layout/collection snapshots are caller-owned, and nothing enters product persistence.
 */
export function useVirtualScrollAnchor(options: VirtualScrollAnchorOptions) {
  const anchor = shallowRef<VirtualScrollAnchor | undefined>()
  const pending = shallowRef(false)
  let baseline: CapturedAnchor | undefined
  let generation = 0
  let disposed = false
  let writing = false
  let suspended = false
  let suspensionLeases = 0
  let suspensionGeneration = 0

  function cancelPending() {
    generation++
    pending.value = false
  }

  function captureFrom(
    geometry: VirtualScrollAnchorGeometry,
    root: HTMLElement,
    origin: number,
  ): CapturedAnchor | undefined {
    const scrollOffset = root.scrollTop
    const localOffset = scrollOffset - origin
    // Before/after this surface, preserve the caller's surrounding content instead of
    // inventing an anchor in a list that does not contain the viewport's leading edge.
    if (!geometry.count || localOffset < 0 || localOffset >= geometry.totalSize) return
    const item = geometry.findItemAtOffset(localOffset)
    if (!item) return
    const candidates = [item, geometry.getItem(item.index + 1), geometry.getItem(item.index - 1)]
      .filter((candidate): candidate is VirtualScrollAnchorItem => candidate !== undefined)
      .map((candidate) => ({
        key: candidate.key,
        index: candidate.index,
        offset: localOffset - candidate.start,
      }))
    return { root, scrollOffset, candidates }
  }

  function capture() {
    const metrics = options.context.metrics.value
    const root = options.context.scrollElement.value
    baseline =
      root && metrics.ready && (toValue(options.enabled) ?? true)
        ? captureFrom(toValue(options.geometry), root, metrics.listOffset)
        : undefined
    anchor.value = baseline?.candidates[0]
  }

  function cancel() {
    cancelPending()
    capture()
  }

  /** Deliberate multi-render navigation owns scroll until its bounded handoff completes. */
  function suspend() {
    cancelPending()
    suspensionLeases++
    capture()
    let held = true
    return () => {
      if (!held) return
      held = false
      suspensionLeases--
      if (!disposed && !suspensionLeases) capture()
    }
  }

  function suspendThroughRender() {
    cancel()
    suspended = true
    const ticket = ++suspensionGeneration
    void nextTick(() => {
      if (disposed || ticket !== suspensionGeneration) return
      suspended = false
      capture()
    })
  }

  function schedule() {
    if (pending.value || !baseline || suspensionLeases) return
    const captured = baseline
    const ticket = ++generation
    pending.value = true
    void nextTick(() => {
      if (disposed || ticket !== generation) return
      pending.value = false
      const root = options.context.scrollElement.value
      const metrics = options.context.metrics.value
      if (
        !root ||
        root !== captured.root ||
        !metrics.ready ||
        !(toValue(options.enabled) ?? true) ||
        // Covers scrollbar/programmatic/native adjustments that precede their scroll event.
        root.scrollTop !== captured.scrollOffset
      ) {
        capture()
        return
      }
      const geometry = toValue(options.geometry)
      let target: { item: VirtualScrollAnchorItem; offset: number } | undefined
      for (const candidate of captured.candidates) {
        const index = geometry.indexOf(candidate.key)
        const item = index === undefined ? undefined : geometry.getItem(index)
        if (item) {
          target = { item, offset: candidate.offset }
          break
        }
      }
      // If the occurrence and its immediate neighbors disappeared together, retain the
      // nearest logical position. The fallback is bounded and deterministic, not a scan.
      if (!target && geometry.count) {
        const original = captured.candidates[0]!
        const item = geometry.getItem(Math.min(original.index, geometry.count - 1))
        if (item) target = { item, offset: original.offset }
      }
      if (target) {
        const offset = Math.max(0, metrics.listOffset + target.item.start + target.offset)
        if (Number.isFinite(offset) && root.scrollTop !== offset) {
          writing = true
          try {
            root.scrollTop = offset
          } finally {
            writing = false
          }
        }
      }
      capture()
    })
  }

  watch(
    [
      () => options.context.scrollElement.value,
      () => options.context.metrics.value.ready,
      () => toValue(options.enabled) ?? true,
    ],
    ([root, ready, enabled], previous, onCleanup) => {
      // A newly shown/replaced root owns its current position. Geometry can publish later
      // in the same render; do not reuse a pre-replacement coordinate system for that work.
      if (previous.length) suspendThroughRender()
      else cancel()
      if (!root || !ready || !enabled) return
      const restoreNativeAnchor = suppressNativeAnchor(root)
      const handleInput = (event: Event) => {
        if (event.type !== 'keydown' || isScrollKey(event)) suspendThroughRender()
      }
      const events = ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown']
      for (const event of events) root.addEventListener(event, handleInput, { passive: true })
      onCleanup(() => {
        for (const event of events) root.removeEventListener(event, handleInput)
        restoreNativeAnchor()
        cancelPending()
        baseline = undefined
        anchor.value = undefined
      })
    },
    { immediate: true, flush: 'sync' },
  )

  watch(
    [() => toValue(options.geometry), () => options.context.metrics.value.listOffset],
    () => {
      if (suspended || suspensionLeases || !baseline) capture()
      else schedule()
    },
    { flush: 'sync' },
  )
  watch(
    () => options.context.metrics.value.scrollOffset,
    () => {
      if (writing) capture()
      else suspendThroughRender()
    },
    { flush: 'sync' },
  )
  watch(() => toValue(options.resetKey), suspendThroughRender, { flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    cancelPending()
    baseline = undefined
    anchor.value = undefined
  })

  // An explicit recapture supersedes earlier compensation just like cancellation; callers
  // must not receive an old queued write after choosing a new semantic baseline.
  return { anchor: readonly(anchor), pending: readonly(pending), capture: cancel, cancel, suspend }
}
