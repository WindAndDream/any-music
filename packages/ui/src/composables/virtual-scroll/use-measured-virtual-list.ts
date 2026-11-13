import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type { FixedVirtualListItem, FixedVirtualListOptions } from './use-fixed-virtual-list'
import { useVirtualItemMeasurements } from './use-virtual-item-measurements'
import type { VirtualItemGeneration } from './use-virtual-item-measurements'
import { useVirtualScrollContext } from './use-virtual-scroll-context'
import { createVirtualListGeometry } from './virtual-list-geometry'
import { createVirtualRetainedRange } from './virtual-retained-range'
import { createVirtualItemIndex } from './virtual-row-geometry'
import { createVirtualRowGeometry } from './virtual-row-geometry'

export interface MeasuredVirtualListOptions<T> extends Omit<
  FixedVirtualListOptions<T>,
  'itemSize'
> {
  /** Positive fallback for unmeasured/evicted occurrences; never applied as a CSS height. */
  estimatedItemSize: MaybeRefOrGetter<number>
  layoutGeneration?: MaybeRefOrGetter<VirtualItemGeneration>
  /** Caller-owned semantic revision, including offscreen title/tag/expansion edits. */
  getContentGeneration: (item: T, index: number) => VirtualItemGeneration
  cacheLimit?: number
}

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Invalid ${name}`)
  return value
}

/** Vertical measured foundation. Native markup and natural measurement units remain caller-owned. */
export function useMeasuredVirtualList<T>(options: MeasuredVirtualListOptions<T>) {
  const source = computed(() => toValue(options.items))
  const index = computed(() => createVirtualItemIndex(source.value, options.getItemKey))
  const count = computed(() => source.value.length)
  const estimatedItemSize = computed(() => {
    const size = nonnegative(toValue(options.estimatedItemSize), 'estimated item size')
    if (!size) throw new RangeError('Invalid estimated item size')
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
  const context = useVirtualScrollContext(options)
  const measurements = useVirtualItemMeasurements({
    context,
    layoutGeneration: options.layoutGeneration,
    cacheLimit: options.cacheLimit,
    getContentGeneration: (key) => {
      const position = index.value.indexOf(key)
      return position === undefined
        ? undefined
        : options.getContentGeneration(source.value[position]!, position)
    },
  })
  const totalSize = computed(() => {
    const estimate = estimatedItemSize.value
    let size =
      count.value * estimate +
      Math.max(0, count.value - 1) * gap.value +
      paddingStart.value +
      paddingEnd.value
    for (const [key, height] of measurements.heights.value) {
      if (index.value.indexOf(key) !== undefined) size += height - estimate
    }
    return nonnegative(size, 'total list size')
  })
  const ready = computed(() => context.metrics.value.ready)
  const geometry = computed(() => {
    const keys = index.value.keys
    const estimate = estimatedItemSize.value
    return createVirtualListGeometry(
      index.value,
      createVirtualRowGeometry({
        count: count.value,
        columns: 1,
        rowGap: gap.value,
        paddingStart: paddingStart.value,
        paddingEnd: paddingEnd.value,
        getRowSize: (position) => measurements.getHeight(keys[position]!) ?? estimate,
      }),
    )
  })
  const rangeExtractor = computed(() =>
    createVirtualRetainedRange(toValue(options.retainedIndexes) ?? [], count.value),
  )
  const listOffset = computed(() => context.metrics.value.listOffset)
  const itemOptions = computed(() => {
    const keys = index.value.keys
    const estimate = estimatedItemSize.value
    return {
      getItemKey: (position: number) => keys[position]!,
      estimateSize: (position: number) => measurements.getHeight(keys[position]!) ?? estimate,
    }
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
          root &&
          root === context.scrollElement.value &&
          ready.value &&
          root.scrollTop !== offset + adjustments
        )
          root.scrollTop = offset + adjustments
      },
    })),
  )
  // The bounded cache is the sole height authority. Never feed measureElement/resizeItem:
  // those retain a second visited-item map in the engine. One reset per committed batch
  // rebuilds engine geometry from current estimates/cache, including evictions and shrinking.
  // Semantic anchor compensation is opt-in through the shared geometry; this foundation
  // never invents a scroll write.
  watch([measurements.revision, estimatedItemSize], () => virtualizer.value.measure(), {
    flush: 'sync',
  })
  const virtualItems = computed<readonly FixedVirtualListItem<T>[]>(() => {
    void totalSize.value
    if (!ready.value) return []
    return virtualizer.value.getVirtualItems().map((item) => ({
      key: item.key as FixedVirtualListItem<T>['key'],
      index: item.index,
      item: source.value[item.index]!,
      start: item.start - listOffset.value,
      end: item.end - listOffset.value,
      size: item.size,
    }))
  })
  return { context, count, totalSize, virtualItems, measurements, geometry }
}
