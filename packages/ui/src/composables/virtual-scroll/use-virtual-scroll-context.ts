import { computed, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { observeVirtualElement } from './virtual-scroll-resize-observer'

export interface VirtualScrollMetrics {
  ready: boolean
  viewportWidth: number
  viewportHeight: number
  listWidth: number
  /** Physical scroll coordinates; horizontal RTL conversion belongs to its layout adapter. */
  scrollOffset: number
  /** List origin in the scroll element's content coordinates, including preceding headers. */
  listOffset: number
}
export interface VirtualScrollContextOptions {
  listElement: MaybeRefOrGetter<HTMLElement | null>
  /** The consumer supplies the actual existing root, including nested/Shadow/responsive roots. */
  scrollElement: MaybeRefOrGetter<HTMLElement | null>
  enabled?: MaybeRefOrGetter<boolean>
  axis?: MaybeRefOrGetter<'vertical' | 'horizontal'>
  /** Bounded preceding headers whose resize can move the list without resizing the list itself. */
  offsetElements?: MaybeRefOrGetter<readonly Element[]>
}
function emptyMetrics(): VirtualScrollMetrics {
  return {
    ready: false,
    viewportWidth: 0,
    viewportHeight: 0,
    listWidth: 0,
    scrollOffset: 0,
    listOffset: 0,
  }
}

/** Bounded viewport observation only: no item enumeration, window scrolling, or business effects. */
export function useVirtualScrollContext(options: VirtualScrollContextOptions) {
  const metrics = shallowRef<VirtualScrollMetrics>(emptyMetrics())
  const currentRoot = shallowRef<HTMLElement | null>(null)
  let refresh: (() => void) | undefined
  function publish(next: VirtualScrollMetrics) {
    const previous = metrics.value
    if (
      (Object.keys(next) as (keyof VirtualScrollMetrics)[]).some(
        (key) => next[key] !== previous[key],
      )
    )
      metrics.value = next
  }
  watch(
    [
      () => toValue(options.listElement),
      () => toValue(options.scrollElement),
      () => toValue(options.enabled) ?? true,
      () => toValue(options.axis) ?? 'vertical',
      () => toValue(options.offsetElements),
    ],
    ([list, root, enabled, axis, offsetElements], _previous, onCleanup) => {
      currentRoot.value = enabled ? root : null
      publish(emptyMetrics())
      refresh = undefined
      if (!list || !root || !enabled) return
      let active = true
      const isCurrent = () =>
        active &&
        (toValue(options.enabled) ?? true) &&
        toValue(options.listElement) === list &&
        toValue(options.scrollElement) === root &&
        (toValue(options.axis) ?? 'vertical') === axis
      const offset = () => (axis === 'vertical' ? root.scrollTop : root.scrollLeft)
      function measure() {
        if (!isCurrent()) return
        const listRect = list!.getBoundingClientRect()
        const rootRect = root!.getBoundingClientRect()
        const width = root!.clientWidth,
          height = root!.clientHeight
        if (
          !list!.isConnected ||
          !root!.isConnected ||
          width <= 0 ||
          height <= 0 ||
          listRect.width <= 0
        ) {
          publish(emptyMetrics())
          return
        }
        const scrollOffset = offset()
        publish({
          ready: true,
          viewportWidth: width,
          viewportHeight: height,
          listWidth: list === root ? width : listRect.width,
          scrollOffset,
          listOffset:
            list === root
              ? 0
              : axis === 'vertical'
                ? listRect.top - rootRect.top - root!.clientTop + scrollOffset
                : listRect.left - rootRect.left - root!.clientLeft + scrollOffset,
        })
      }
      function handleScroll() {
        // The list origin is invariant under scrolling: avoid fresh geometry reads every frame.
        if (isCurrent() && metrics.value.ready)
          publish({ ...metrics.value, scrollOffset: offset() })
      }
      refresh = measure
      root.addEventListener('scroll', handleScroll, { passive: true })
      const stopRoot = observeVirtualElement(root, measure)
      const stopList = list === root ? undefined : observeVirtualElement(list, measure)
      const stopOffsets = [...new Set(offsetElements ?? [])]
        .filter((element) => element !== root && element !== list)
        .map((element) => observeVirtualElement(element, measure))
      const view = root.ownerDocument.defaultView
      if (!stopRoot) view?.addEventListener('resize', measure)
      measure()
      onCleanup(() => {
        active = false
        root.removeEventListener('scroll', handleScroll)
        stopRoot?.()
        stopList?.()
        for (const stop of stopOffsets) stop?.()
        if (!stopRoot) view?.removeEventListener('resize', measure)
        refresh = undefined
        currentRoot.value = null
        publish(emptyMetrics())
      })
    },
    { immediate: true, flush: 'post' },
  )
  return {
    metrics: readonly(metrics),
    scrollElement: computed(() => currentRoot.value),
    refresh: () => refresh?.(),
  }
}
