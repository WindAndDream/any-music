<script setup lang="ts">
import type { Track } from '@any-music/core'
import VirtualTable from '@any-music/ui/components/virtual-scroll/VirtualTable.vue'
import VirtualTrackCardGrid from '@any-music/ui/components/virtual-scroll/VirtualTrackCardGrid.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import type {
  useMeasuredVirtualList,
  useVirtualItemRetention,
  useVirtualScrollAnchor,
} from '@any-music/ui/virtual-scroll'
import { computed, useTemplateRef, watch } from 'vue'

import { useStudioOverlays } from '../../composables/use-studio-overlays'
import type {
  StudioTrackLayoutProps,
  StudioTrackLayoutSlots,
} from './studio-track-layout-contracts'

interface VirtualSurface {
  result: ReturnType<typeof useMeasuredVirtualList<Track>>
  retention?: ReturnType<typeof useVirtualItemRetention>
  anchor: ReturnType<typeof useVirtualScrollAnchor>
}
const props = defineProps<
  StudioTrackLayoutProps & {
    scrollElement: HTMLElement | null
    revision: unknown
  }
>()
defineSlots<StudioTrackLayoutSlots>()
const element = useTemplateRef<HTMLElement>('element')
const surface = useTemplateRef<VirtualSurface>('surface')
const overlays = useStudioOverlays(() => false)
const styled = computed(() => Boolean(props.state.itemStyle && props.state.itemStyle !== 'default'))
const estimate = computed(() =>
  styled.value
    ? props.state.displayMode === 'comfortable'
      ? 400
      : props.state.displayMode === 'compact'
        ? 96
        : 144
    : (props.state.displayMode === 'compact'
        ? 56
        : props.state.displayMode === 'comfortable'
          ? 96
          : 76) * props.rowCount,
)
const layoutGeneration = computed(() =>
  JSON.stringify([
    props.state.itemStyle,
    props.state.displayMode,
    props.state.mobileColumns,
    props.rowCount,
  ]),
)
// Revisions are rebuilt on content changes, never per-scroll/per-cache measurement batches.
const generations = computed(() => {
  const invalid = new Set(props.state.invalidTrackIds)
  return new Map(
    props.state.tracks.map((track) => [
      track.id,
      JSON.stringify([
        track,
        props.state.customNamesByTrackId.get(track.id),
        props.state.customTagsByTrackId.get(track.id),
        invalid.has(track.id),
        props.disabled,
      ]),
    ]),
  )
})
const offsets = computed(() => {
  const root = element.value?.parentElement
  const fieldset = root?.parentElement
  const header = fieldset?.parentElement?.querySelector(':scope > header')
  const siblings = Array.from(fieldset?.children ?? [])
  return [...(header ? [header] : []), ...siblings.slice(0, root ? siblings.indexOf(root) : 0)]
})
const continuity = usePresentationContinuity({
  register: false,
  element,
  region: () => props.continuityRegion ?? null,
  scrollElement: () => props.scrollElement,
  geometry: () => {
    const result = surface.value?.result
    return result
      ? { ...result.geometry.value, listOffset: result.context.metrics.value.listOffset }
      : undefined
  },
  refresh: () => surface.value?.result.context.refresh(),
  beforeRestore: () => {
    surface.value?.retention?.cancelNavigation()
    return surface.value?.anchor.suspend()
  },
  retain: (key) => surface.value?.retention?.retain(key, 'navigation'),
  revision: () => props.revision,
})
watch(
  [() => overlays?.trackActionId.value, () => surface.value?.retention],
  ([id, retention], _old, onCleanup) => {
    const release = id ? retention?.retain(id, 'popover') : undefined
    if (release) onCleanup(release)
  },
  { immediate: true, flush: 'post' },
)
defineExpose({ continuity })
</script>

<template>
  <div ref="element">
    <VirtualTrackCardGrid
      v-if="styled"
      ref="surface"
      :items="state.tracks"
      :get-item-key="(track) => track.id"
      :get-content-generation="(track) => generations.get(track.id)!"
      :estimated-item-size="estimate"
      :scroll-element="scrollElement"
      :display-mode="state.displayMode"
      :mobile-columns="state.mobileColumns"
      :layout-generation="layoutGeneration"
      :anchor-reset-key="revision"
      :offset-elements="offsets"
      interaction
      anchor
    >
      <template #default="{ row }"
        ><slot name="card" :track="row.item" :index="row.index"
      /></template>
    </VirtualTrackCardGrid>
    <VirtualTable
      v-else
      ref="surface"
      class="studio-track-table"
      :items="state.tracks"
      :get-item-key="(track) => track.id"
      :get-content-generation="(track) => generations.get(track.id)!"
      :get-item-row-count="() => rowCount"
      :estimated-item-size="estimate"
      :column-count="4"
      :header-row-count="1"
      :scroll-element="scrollElement"
      :layout-generation="layoutGeneration"
      :anchor-reset-key="revision"
      :offset-elements="offsets"
      :data-density="state.displayMode"
      :data-mobile-columns="state.mobileColumns"
      interaction
      anchor
    >
      <template #caption>{{ state.tracks.length }} 首歌曲</template>
      <template #columns
        ><col style="width: 12%" />
        <col style="width: 43%" />
        <col style="width: 15%" />
        <col style="width: 30%"
      /></template>
      <template #head><slot name="head" /></template>
      <template #rows="{ row, position }"
        ><slot name="rows" :track="row.item" :index="row.index" :row-index="position.firstRowIndex"
      /></template>
    </VirtualTable>
  </div>
</template>
