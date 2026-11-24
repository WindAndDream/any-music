<script setup lang="ts">
import type { Track } from '@any-music/core'
import type { VirtualPageGeometry } from '@any-music/ui/catalog'
import { computed, defineAsyncComponent, useTemplateRef } from 'vue'

const VirtualTable = defineAsyncComponent(
  () => import('@any-music/ui/components/virtual-scroll/VirtualTable.vue'),
)
defineProps<{
  tracks: readonly Track[]
  getContentGeneration: (track: Track) => string
  scrollElement?: HTMLElement | null
  virtualized?: boolean
}>()
defineSlots<{
  head(props: { rowIndex?: number }): unknown
  row(props: { track: Track; index: number; rowIndex?: number }): unknown
}>()
const surface = useTemplateRef<{ result: VirtualPageGeometry }>('surface')
defineExpose({ geometry: computed(() => surface.value?.result) })
</script>

<template>
  <VirtualTable
    v-if="virtualized"
    ref="surface"
    class="studio-track-table"
    :items="tracks"
    :get-item-key="(track: Track) => track.id"
    :get-content-generation="getContentGeneration"
    :estimated-item-size="76"
    :column-count="4"
    :header-row-count="1"
    :scroll-element="scrollElement ?? null"
    interaction
    anchor
  >
    <template #caption>{{ tracks.length }} 首已加载歌曲</template>
    <template #columns>
      <col style="width: 12%" />
      <col style="width: 43%" />
      <col style="width: 15%" />
      <col style="width: 30%" />
    </template>
    <template #head="{ firstRowIndex }"><slot name="head" :row-index="firstRowIndex" /></template>
    <template #rows="{ row, position }">
      <slot name="row" :track="row.item" :index="row.index" :row-index="position.firstRowIndex" />
    </template>
  </VirtualTable>
  <table v-else class="studio-track-table">
    <caption>
      {{
        tracks.length
      }}
      首已加载歌曲
    </caption>
    <thead>
      <slot name="head" />
    </thead>
    <tbody>
      <template v-for="(track, index) in tracks" :key="track.id">
        <slot name="row" :track="track" :index="index" />
      </template>
    </tbody>
  </table>
</template>
