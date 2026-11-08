import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useVirtualScrollContext } from './use-virtual-scroll-context'
import type { VirtualScrollContextOptions } from './use-virtual-scroll-context'
import { createVirtualListGeometry } from './virtual-list-geometry'
import { createVirtualRetainedRange } from './virtual-retained-range'
import { createVirtualItemIndex } from './virtual-row-geometry'
import type { VirtualItemKey } from './virtual-row-geometry'
import { createVirtualRowGeometry } from './virtual-row-geometry'

export interface FixedVirtualListOptions<T> extends Omit<VirtualScrollContextOptions, 'axis'> {
  items: MaybeRefOrGetter<readonly T[]>
  /** Identity of this occurrence, including when the same entity appears more than once. */
  getItemKey: (item: T, index: number) => VirtualItemKey
  /** Positive, natural block size. Variable-height surfaces use a measured adapter instead. */
  itemSize: MaybeRefOrGetter<number>
  gap?: MaybeRefOrGetter<number>
  paddingStart?: MaybeRefOrGetter<number>
  paddingEnd?: MaybeRefOrGetter<number>
  /** Extra logical items at each end of the visible range. */
  overscan?: MaybeRefOrGetter<number>
  /** At most 32 distinct interaction occurrences in the complete caller-owned collection. */
  retainedIndexes?: MaybeRefOrGetter<readonly number[]>
}

export interface FixedVirtualListItem<T> {
  key: VirtualItemKey
  index: number
  item: T
  /** List-local block coordinates; preceding headers are already subtracted. */
  start: number
  end: number
  size: number
}

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid ${name}`)
  return value
}

/**
 * Vertical, headless rendering only. The caller keeps its scroll root, complete collection,
 * native semantics and keyed item parent; positioning must not replace its motion transform.
 */
export function useFixedVirtualList<T>(options: FixedVirtualListOptions<T>) {
  const source = computed(() => toValue(options.items))
  const index = computed(() => createVirtualItemIndex(source.value, options.getItemKey))
  const count = computed(() => source.value.length)
  const itemSize = computed(() => {
    const size = nonnegative(toValue(options.itemSize), 'item size')
    if (!size) throw new RangeError('Invalid item size')
    return size
  })
  const gap = computed(() => nonnegative(toValue(options.gap) ?? 0, 'item gap'))
  const paddingStart = computed(() =>
    nonnegative(toValue(options.paddingStart) ?? 0, 'start padding'),
  )
  const paddingEnd = computed(() => nonnegative(toValue(options.paddingEnd) ?? 0, 'end padding'))
  const overscan = computed(() => {
    const value = toValue(options.overscan) ?? 2
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid overscan')
    return value
  })
  // Keep the spacer even while hidden/disabled, without asking the engine to enumerate rows.
  const totalSize = computed(() =>
    nonnegative(
      count.value * itemSize.value +
        Math.max(0, count.value - 1) * gap.value +
        paddingStart.value +
        paddingEnd.value,
      'total list size',
    ),
  )
  const context = useVirtualScrollContext(options)
  const geometry = computed(() =>
    createVirtualListGeometry(
      index.value,
      createVirtualRowGeometry({
        count: count.value,
        columns: 1,
        rowGap: gap.value,
        paddingStart: paddingStart.value,
        paddingEnd: paddingEnd.value,
        getRowSize: () => itemSize.value,
      }),
    ),
  )
  const rangeExtractor = computed(() =>
    createVirtualRetainedRange(toValue(options.retainedIndexes) ?? [], count.value),
  )
  const ready = computed(() => context.metrics.value.ready)
  const listOffset = computed(() => context.metrics.value.listOffset)
  // A size change must also invalidate the engine's memoized measurements. Pair the key
  // extractor with that size, while building the O(N) occurrence index only on data changes.
  const itemOptions = computed(() => {
    const size = itemSize.value
    const keys = index.value.keys
    return { estimateSize: () => size, getItemKey: (position: number) => keys[position]! }
  })
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>(
    computed(() => ({
      ...itemOptions.value,
      count: count.value,
      enabled: ready.value && count.value > 0,
      getScrollElement: () => context.scrollElement.value,
      initialOffset: () => context.metrics.value.scrollOffset,
      scrollMargin: listOffset.value,
      gap: gap.value,
      paddingStart: paddingStart.value,
      paddingEnd: paddingEnd.value,
      overscan: overscan.value,
      rangeExtractor: rangeExtractor.value,
      // Subscribe to the pooled context, never the adapter's default observers/listeners.
      // Scalar computed dependencies above keep option/key identities stable during scrolling.
      observeElementRect: (_instance, notify) =>
        watch(
          [() => context.metrics.value.viewportWidth, () => context.metrics.value.viewportHeight],
          ([width, height]) => notify({ width, height }),
          { immediate: true, flush: 'sync' },
        ),
      observeElementOffset: (_instance, notify) =>
        watch(
          () => context.metrics.value.scrollOffset,
          (offset) => notify(offset, false),
          { immediate: true, flush: 'sync' },
        ),
      scrollToFn: (offset, { adjustments = 0 }, instance) => {
        const root = instance.scrollElement
        if (
          root === context.scrollElement.value &&
          ready.value &&
          root &&
          root.scrollTop !== offset + adjustments
        )
          root.scrollTop = offset + adjustments
      },
    })),
  )
  const virtualItems = computed<readonly FixedVirtualListItem<T>[]>(() => {
    // Validate the spacer even while hidden/empty, when there is no visible range to render.
    void totalSize.value
    if (!ready.value) return []
    return virtualizer.value.getVirtualItems().map((item) => ({
      key: item.key as VirtualItemKey,
      index: item.index,
      item: source.value[item.index]!,
      start: item.start - listOffset.value,
      end: item.end - listOffset.value,
      size: item.size,
    }))
  })
  return { context, count, totalSize, virtualItems, geometry }
}
