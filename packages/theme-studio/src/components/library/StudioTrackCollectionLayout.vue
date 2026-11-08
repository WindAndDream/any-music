<script setup lang="ts">
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { usePresentationContinuity } from '@any-music/ui/library'
import { computed, defineAsyncComponent, useTemplateRef } from 'vue'

import { useStudioCollectionViewport } from '../../composables/use-studio-collection-viewport'
import type {
  StudioTrackLayoutProps,
  StudioTrackLayoutSlots,
  StudioVirtualTrackLayoutAdapter,
} from './studio-track-layout-contracts'

/** Full and virtual surfaces consume identical theme-owned row/card slots. */
const props = defineProps<StudioTrackLayoutProps & { virtualized?: boolean }>()
defineSlots<StudioTrackLayoutSlots>()
const VirtualLayout = defineAsyncComponent(() => import('./StudioVirtualTrackLayout.vue'))
const element = useTemplateRef<HTMLElement>('element')
const virtual = useTemplateRef<StudioVirtualTrackLayoutAdapter>('virtual')
const scrollElement = useStudioCollectionViewport(element)
const revision = computed(
  (previous: { region?: string; filters: unknown; empty: boolean } | undefined) => {
    const region = props.continuityRegion
    const filters = props.state.filters
    const empty = props.state.tracks.length === 0
    // Metadata/selection and ordinary collection changes must keep semantic anchoring active.
    return previous &&
      previous.region === region &&
      previous.filters === filters &&
      previous.empty === empty
      ? previous
      : { region, filters, empty }
  },
)
usePresentationContinuity({
  element,
  region: () => props.continuityRegion ?? null,
  scrollElement,
  revision,
  waitForDelegate: () => Boolean(props.virtualized),
  delegate: () => virtual.value?.continuity,
})
</script>

<template>
  <div ref="element" class="studio-table-scroll" data-am-scroll-key="library:tracks">
    <VirtualLayout
      v-if="virtualized"
      ref="virtual"
      :state="state"
      :disabled="disabled"
      :row-count="rowCount"
      :continuity-region="continuityRegion"
      :scroll-element="scrollElement"
      :revision="revision"
    >
      <template #head><slot name="head" /></template>
      <template #card="context"><slot name="card" v-bind="context" /></template>
      <template #rows="context"><slot name="rows" v-bind="context" /></template>
    </VirtualLayout>
    <TrackCardGrid
      v-else-if="state.itemStyle && state.itemStyle !== 'default'"
      :display-mode="state.displayMode"
      :mobile-columns="state.mobileColumns"
    >
      <template v-for="(track, index) in state.tracks" :key="track.id">
        <slot name="card" :track="track" :index="index" />
      </template>
    </TrackCardGrid>
    <table
      v-else
      class="studio-track-table"
      :data-density="state.displayMode"
      :data-mobile-columns="state.mobileColumns"
    >
      <caption>
        {{
          state.tracks.length
        }}
        首歌曲
      </caption>
      <thead>
        <slot name="head" />
      </thead>
      <tbody>
        <template v-for="(track, index) in state.tracks" :key="track.id">
          <slot name="rows" :track="track" :index="index" />
        </template>
      </tbody>
    </table>
  </div>
</template>
