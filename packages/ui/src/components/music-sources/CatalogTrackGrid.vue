<script setup lang="ts">
import type { Track } from '@any-music/core'
import { computed, defineAsyncComponent, useTemplateRef } from 'vue'

import type { VirtualPageGeometry } from '../../composables/music-sources/use-scroll-page-loader'
import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
  TrackGridViewport,
} from './catalog-track-display-mode'
import TrackCardGrid from './TrackCardGrid.vue'

const VirtualGrid = defineAsyncComponent(() => import('../virtual-scroll/VirtualTrackCardGrid.vue'))
const props = defineProps<{
  tracks: readonly Track[]
  getContentGeneration: (track: Track) => string
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  viewportSize?: TrackGridViewport
  scrollElement?: HTMLElement | null
  layoutGeneration?: string
  virtualized?: boolean
  animate?: boolean
}>()
defineSlots<{ default(props: { track: Track }): unknown }>()
const surface = useTemplateRef<{ result: VirtualPageGeometry }>('surface')
const itemKeys = computed(() => (props.animate ? props.tracks.map(({ id }) => id) : undefined))
const estimate = computed(
  () => ({ comfortable: 400, standard: 144, compact: 96 })[props.displayMode],
)
defineExpose({ geometry: computed(() => surface.value?.result) })
</script>

<template>
  <VirtualGrid
    v-if="virtualized"
    ref="surface"
    :items="tracks"
    :get-item-key="(track: Track) => track.id"
    :get-content-generation="getContentGeneration"
    :estimated-item-size="estimate"
    :scroll-element="scrollElement ?? null"
    :display-mode="displayMode"
    :mobile-columns="mobileColumns"
    :viewport-size="viewportSize"
    :layout-generation="layoutGeneration"
    :animate="animate"
    interaction
    anchor
  >
    <template #default="{ row }"><slot :track="row.item" /></template>
  </VirtualGrid>
  <TrackCardGrid
    v-else
    :display-mode="displayMode"
    :mobile-columns="mobileColumns"
    :viewport-size="viewportSize"
    :item-keys="itemKeys"
    :animate="animate"
  >
    <div v-for="track in tracks" :key="track.id" class="catalog-track-grid__cell">
      <slot :track="track" />
    </div>
  </TrackCardGrid>
</template>

<style scoped>
.catalog-track-grid__cell {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
</style>
