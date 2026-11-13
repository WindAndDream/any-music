<script setup lang="ts" generic="T">
import { computed, effectScope, shallowRef, useTemplateRef, watch } from 'vue'
import type { HTMLAttributes } from 'vue'

import type { FixedVirtualListItem } from '../../composables/virtual-scroll/use-fixed-virtual-list'
import { useMeasuredVirtualTable } from '../../composables/virtual-scroll/use-measured-virtual-table'
import type { VirtualItemGeneration } from '../../composables/virtual-scroll/use-virtual-item-measurements'
import { useVirtualItemRetention } from '../../composables/virtual-scroll/use-virtual-item-retention'
import { useVirtualScrollAnchor } from '../../composables/virtual-scroll/use-virtual-scroll-anchor'
import type { VirtualItemKey } from '../../composables/virtual-scroll/virtual-row-geometry'
import type { VirtualTableRowPosition } from '../../composables/virtual-scroll/virtual-table-layout'
import VirtualTableBody from './VirtualTableBody.vue'

/** Controlled native table. Slots supply caption text, col elements, header/footer rows and cells. */
const props = withDefaults(
  defineProps<{
    items: readonly T[]
    getItemKey: (item: T, index: number) => VirtualItemKey
    getContentGeneration: (item: T, index: number) => VirtualItemGeneration
    estimatedItemSize: number
    columnCount: number
    scrollElement: HTMLElement | null
    getItemRowCount?: (item: T, index: number) => number
    getRowAttributes?: (item: T, index: number, rowOffset: number) => HTMLAttributes
    /** Exact physical row count supplied by the head slot, including multirow column headers. */
    headerRowCount?: number
    /** Exact physical row count supplied by the foot slot. */
    footerRowCount?: number
    layoutGeneration?: VirtualItemGeneration
    overscan?: number
    cacheLimit?: number
    enabled?: boolean
    offsetElements?: readonly Element[]
    retainedIndexes?: readonly number[]
    /** Optional bounded focus/composition retention on each natural row group. */
    interaction?: boolean
    anchor?: boolean
    anchorResetKey?: unknown
  }>(),
  { enabled: true, headerRowCount: 0, footerRowCount: 0 },
)
defineSlots<{
  caption?(): unknown
  columns?(): unknown
  head?(props: { firstRowIndex: number; rowCount: number }): unknown
  foot?(props: { firstRowIndex: number; rowCount: number }): unknown
  default?(props: { row: FixedVirtualListItem<T>; rowOffset: number; rowIndex: number }): unknown
  /** Native tr component path: the caller binds position.firstRowIndex + each physical offset. */
  rows?(props: { row: FixedVirtualListItem<T>; position: VirtualTableRowPosition }): unknown
}>()
const origin = useTemplateRef<HTMLElement>('origin')
const caption = useTemplateRef<HTMLElement>('caption')
const head = useTemplateRef<HTMLElement>('head')
const interactionIndexes = shallowRef<readonly number[]>([])
// Inline geometry keeps ordinary theme th/td selectors from adding extent to omitted intervals.
const spacerStyle = {
  blockSize: '0',
  minBlockSize: '0',
  padding: '0',
  border: '0',
  lineHeight: '0',
  fontSize: '0',
}
const columnCount = computed(() => {
  if (!Number.isSafeInteger(props.columnCount) || props.columnCount < 1)
    throw new RangeError('Invalid table column count')
  return props.columnCount
})
const result = useMeasuredVirtualTable({
  items: () => props.items,
  getItemKey: (item, index) => props.getItemKey(item, index),
  getContentGeneration: (item, index) => props.getContentGeneration(item, index),
  getItemRowCount: (item, index) => props.getItemRowCount?.(item, index) ?? 1,
  headerRowCount: () => props.headerRowCount,
  footerRowCount: () => props.footerRowCount,
  estimatedItemSize: () => props.estimatedItemSize,
  listElement: origin,
  scrollElement: () => props.scrollElement,
  enabled: () => props.enabled,
  offsetElements: () =>
    [...(props.offsetElements ?? []), caption.value, head.value].filter(
      (element): element is Element => element !== null,
    ),
  layoutGeneration: () => props.layoutGeneration ?? 0,
  overscan: () => props.overscan ?? 2,
  cacheLimit: props.cacheLimit,
  retainedIndexes: () => [...(props.retainedIndexes ?? []), ...interactionIndexes.value],
})
const anchor = useVirtualScrollAnchor({
  context: result.context,
  geometry: result.geometry,
  enabled: () => props.anchor ?? false,
  resetKey: () => props.anchorResetKey,
})
const retention = shallowRef<ReturnType<typeof useVirtualItemRetention>>()
const interactionGeneration = shallowRef(0)
watch(
  [() => result.context.scrollElement.value, () => result.context.metrics.value.ready],
  () => interactionGeneration.value++,
  { flush: 'sync' },
)
watch(
  () => props.interaction ?? false,
  (enabled, _previous, onCleanup) => {
    if (!enabled) return
    const scope = effectScope()
    scope.run(() => {
      const interaction = useVirtualItemRetention({
        context: result.context,
        geometry: result.geometry,
        beforeScroll: anchor.cancel,
        suspendReorder: anchor.suspend,
      })
      retention.value = interaction
      watch(interaction.retainedIndexes, (indexes) => (interactionIndexes.value = indexes), {
        immediate: true,
        flush: 'sync',
      })
    })
    onCleanup(() => {
      scope.stop()
      retention.value = undefined
      interactionIndexes.value = []
    })
  },
  { immediate: true, flush: 'sync' },
)
defineExpose({ result, element: origin, retention, anchor })
</script>

<template>
  <table
    class="virtual-table"
    :aria-rowcount="result.rowIndex.value.rowCount"
    :aria-colcount="columnCount"
    :style="{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }"
  >
    <caption v-if="$slots.caption" ref="caption">
      <slot name="caption" />
    </caption>
    <colgroup v-if="$slots.columns">
      <slot name="columns" />
    </colgroup>
    <thead v-if="$slots.head" ref="head">
      <slot name="head" :first-row-index="1" :row-count="headerRowCount" />
    </thead>
    <!-- The origin stays below caption/headers, independent of the current mounted window. -->
    <tbody ref="origin" aria-hidden="true" class="virtual-table__origin" :style="spacerStyle">
      <tr class="virtual-table__spacer-row" :style="spacerStyle">
        <td :colspan="columnCount" class="virtual-table__spacer-cell" :style="spacerStyle" />
      </tr>
    </tbody>
    <template v-for="entry in result.renderLayout.value.rows" :key="entry.row.key">
      <tbody v-if="entry.gapBefore > 0" aria-hidden="true">
        <tr class="virtual-table__spacer-row" :style="spacerStyle">
          <td
            :colspan="columnCount"
            class="virtual-table__spacer-cell"
            :style="{ ...spacerStyle, blockSize: `${entry.gapBefore}px` }"
          />
        </tr>
      </tbody>
      <VirtualTableBody
        :row="entry.row"
        :position="result.rowIndex.value.positions[entry.row.index]!"
        :observe="result.measurements.observeItem"
        :get-row-attributes="getRowAttributes"
        :register-interaction="retention?.registerItem"
        :interaction-generation="interactionGeneration"
      >
        <template v-if="$slots.rows" #rows="scope"><slot name="rows" v-bind="scope" /></template>
        <template #default="scope"><slot v-bind="scope" /></template>
      </VirtualTableBody>
    </template>
    <tbody v-if="result.renderLayout.value.trailingGap > 0" aria-hidden="true">
      <tr class="virtual-table__spacer-row" :style="spacerStyle">
        <td
          :colspan="columnCount"
          class="virtual-table__spacer-cell"
          :style="{ ...spacerStyle, blockSize: `${result.renderLayout.value.trailingGap}px` }"
        />
      </tr>
    </tbody>
    <tfoot v-if="$slots.foot">
      <slot
        name="foot"
        :first-row-index="result.rowIndex.value.rowCount - footerRowCount + 1"
        :row-count="footerRowCount"
      />
    </tfoot>
  </table>
</template>

<style scoped>
.virtual-table {
  /* Unmounted cells cannot influence automatic column sizing. Callers supply widths via cols. */
  inline-size: 100%;
}
</style>
