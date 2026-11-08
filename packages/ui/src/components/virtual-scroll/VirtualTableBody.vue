<script setup lang="ts" generic="T">
import { onScopeDispose, useTemplateRef, watch } from 'vue'
import type { HTMLAttributes } from 'vue'

import type { FixedVirtualListItem } from '../../composables/virtual-scroll/use-fixed-virtual-list'
import type { VirtualItemKey } from '../../composables/virtual-scroll/virtual-row-geometry'
import type { VirtualTableRowPosition } from '../../composables/virtual-scroll/virtual-table-layout'

/** A keyed natural row group; every physical tr keeps its native table position. */
const props = defineProps<{
  row: FixedVirtualListItem<T>
  position: VirtualTableRowPosition
  observe: (key: VirtualItemKey, element: HTMLElement) => () => void
  getRowAttributes?: (item: T, index: number, rowOffset: number) => HTMLAttributes
  registerInteraction?: (key: VirtualItemKey, element: HTMLElement) => () => void
  interactionGeneration?: number
}>()
defineSlots<{
  default?(props: { row: FixedVirtualListItem<T>; rowOffset: number; rowIndex: number }): unknown
  /** Existing native row components may own their tr(s); bind the supplied physical positions. */
  rows?(props: { row: FixedVirtualListItem<T>; position: VirtualTableRowPosition }): unknown
}>()
const content = useTemplateRef<HTMLElement>('content')
let release: (() => void) | undefined
watch(
  [content, () => props.row.key],
  ([element, key]) => {
    release?.()
    release = element ? props.observe(key, element) : undefined
  },
  { immediate: true, flush: 'post' },
)
onScopeDispose(() => release?.())
let releaseInteraction: (() => void) | undefined
watch(
  [
    content,
    () => props.row.key,
    () => props.registerInteraction,
    () => props.interactionGeneration,
  ],
  ([element, key, register]) => {
    releaseInteraction?.()
    releaseInteraction = element && register ? register(key, element) : undefined
  },
  { immediate: true, flush: 'post' },
)
onScopeDispose(() => releaseInteraction?.())
</script>

<template>
  <tbody ref="content" class="virtual-table-body" :data-occurrence="row.key">
    <slot v-if="$slots.rows" name="rows" :row="row" :position="position" />
    <template v-else>
      <tr
        v-for="offset in position.rowCount"
        :key="offset"
        v-bind="getRowAttributes?.(row.item, row.index, offset - 1)"
        :aria-rowindex="position.firstRowIndex + offset - 1"
      >
        <slot
          :row="row"
          :row-offset="offset - 1"
          :row-index="position.firstRowIndex + offset - 1"
        />
      </tr>
    </template>
  </tbody>
</template>

<style scoped>
.virtual-table-body {
  content-visibility: visible;
  contain: none;
}
.virtual-table-body :deep(*) {
  content-visibility: visible;
  contain-intrinsic-block-size: none;
}
</style>
