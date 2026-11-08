import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useMeasuredVirtualList } from './use-measured-virtual-list'
import type { MeasuredVirtualListOptions } from './use-measured-virtual-list'
import { createVirtualTableLayout, createVirtualTableRowIndex } from './virtual-table-layout'

export interface MeasuredVirtualTableOptions<T> extends Omit<
  MeasuredVirtualListOptions<T>,
  'gap' | 'paddingStart' | 'paddingEnd'
> {
  /** One natural tbody measurement unit may contain a main row and several detail rows. */
  getItemRowCount?: (item: T, index: number) => number
  headerRowCount?: MaybeRefOrGetter<number>
  footerRowCount?: MaybeRefOrGetter<number>
}

/** Native row groups share list measurement/retention; no second height cache or scroll root. */
export function useMeasuredVirtualTable<T>(options: MeasuredVirtualTableOptions<T>) {
  const result = useMeasuredVirtualList({
    ...options,
    gap: 0,
    paddingStart: 0,
    paddingEnd: 0,
    getContentGeneration: (item, index) =>
      JSON.stringify([
        options.getContentGeneration(item, index),
        options.getItemRowCount?.(item, index) ?? 1,
      ]),
  })
  const rowIndex = computed(() =>
    createVirtualTableRowIndex(
      toValue(options.items),
      options.getItemRowCount ?? (() => 1),
      toValue(options.headerRowCount) ?? 0,
      toValue(options.footerRowCount) ?? 0,
    ),
  )
  const renderLayout = computed(() =>
    createVirtualTableLayout(result.virtualItems.value, result.totalSize.value),
  )
  return { ...result, rowIndex, renderLayout }
}
