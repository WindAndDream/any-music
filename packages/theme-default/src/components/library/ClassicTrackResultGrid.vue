<script setup lang="ts" generic="T">
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import type { CatalogTrackDisplayMode, MobileTrackColumns } from '@any-music/ui/library'
import { computed, defineAsyncComponent, useTemplateRef, watch } from 'vue'
import type { CSSProperties } from 'vue'

import {
  createClassicTrackGridGeometry,
  type ClassicMeasuredTrackGrid,
} from '../../composables/classic-virtual-track-grid'

/** Both renderers consume the same slot; callers own the complete ordered result. */
const props = defineProps<{
  items: readonly T[]
  itemKey: (item: T) => string
  contentGeneration: (item: T) => string
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  itemStyle?: string
  scrollElement: HTMLElement | null
  continuityRegion: string
  resetKey?: unknown
  popoverKey?: string | null
  animate?: boolean
  getReorderStyle?: (id: string) => CSSProperties | undefined
}>()
defineSlots<{ default(scope: { item: T; virtualPlacement: boolean }): unknown }>()

const virtualized = import.meta.env.MODE === 'dev'
const VirtualGrid = virtualized
  ? defineAsyncComponent(
      () => import('@any-music/ui/components/virtual-scroll/VirtualTrackCardGrid.vue'),
    )
  : null
const element = useTemplateRef<HTMLElement>('element')
const grid = useTemplateRef<ClassicMeasuredTrackGrid<T>>('grid')
const keys = computed(() => (props.animate ? props.items.map(props.itemKey) : undefined))
const estimate = computed(() =>
  props.displayMode === 'comfortable' ? 400 : props.displayMode === 'compact' ? 96 : 144,
)
const layoutKey = computed(() =>
  JSON.stringify([props.displayMode, props.mobileColumns, props.itemStyle]),
)
const reorder = computed(() => {
  const getItemStyle = props.getReorderStyle
  return getItemStyle
    ? {
        attributePrefix: 'queue',
        kind: 'track',
        getItemId: (row: { key: string | number }) => String(row.key),
        getItemStyle,
      }
    : undefined
})
const offsetElements = computed(() => {
  const surface = element.value?.closest('.listen-queue__surface, .download-collection__surface')
  return Array.from(surface?.children ?? []).filter((child) => !child.contains(element.value))
})
const virtualContinuity = usePresentationContinuity({
  register: false,
  element: () => grid.value?.element ?? null,
  region: () => props.continuityRegion,
  scrollElement: () => props.scrollElement,
  geometry: () => {
    const result = grid.value?.result
    return result
      ? { ...result.geometry.value, listOffset: result.context.metrics.value.listOffset }
      : undefined
  },
  refresh: () => grid.value?.result.context.refresh(),
  beforeRestore: () => grid.value?.anchor.suspend(),
  retain: (key) => grid.value?.retention?.retain(key, 'navigation'),
  revision: () => props.resetKey,
})
usePresentationContinuity({
  element,
  region: () => props.continuityRegion,
  scrollElement: () => props.scrollElement,
  revision: () => props.resetKey,
  waitForDelegate: () => virtualized,
  delegate: () => (grid.value ? virtualContinuity : undefined),
})
watch(
  [() => props.popoverKey, () => grid.value?.retention],
  ([id, retention], _previous, onCleanup) => {
    const release = id ? retention?.retain(id, 'popover') : undefined
    if (release) onCleanup(release)
  },
  { immediate: true, flush: 'post' },
)

defineExpose({
  createGeometry: virtualized
    ? createClassicTrackGridGeometry(
        () => grid.value,
        () => props.scrollElement,
        () => layoutKey.value,
      )
    : undefined,
  retainItem: (id: string) => grid.value?.retention?.retain(id, 'reorder'),
  focusItem: (id: string, signal: AbortSignal) =>
    grid.value?.retention?.focusItem(id, {
      signal,
      target: (cell) => cell.querySelector<HTMLElement>('[data-queue-handle]'),
    }) ?? Promise.resolve(false),
})
</script>

<template>
  <div ref="element">
    <VirtualGrid
      v-if="VirtualGrid"
      ref="grid"
      :items="items"
      :get-item-key="itemKey"
      :get-content-generation="contentGeneration"
      :estimated-item-size="estimate"
      :display-mode="displayMode"
      :mobile-columns="mobileColumns"
      :scroll-element="scrollElement"
      :offset-elements="offsetElements"
      :layout-generation="layoutKey"
      :anchor-reset-key="resetKey"
      :animate="animate"
      :reorder="reorder"
      interaction
      anchor
    >
      <template #default="{ row }"
        ><slot :item="row.item as T" :virtual-placement="true"
      /></template>
    </VirtualGrid>
    <TrackCardGrid
      v-else
      :display-mode="displayMode"
      :mobile-columns="mobileColumns"
      :item-keys="keys"
      :animate="animate"
    >
      <template v-for="item in items" :key="itemKey(item)">
        <slot :item="item" :virtual-placement="false" />
      </template>
    </TrackCardGrid>
  </div>
</template>
