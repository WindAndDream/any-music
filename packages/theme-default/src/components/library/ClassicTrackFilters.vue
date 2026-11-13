<script setup lang="ts">
import { cloneCatalogTrackFilterState, getCatalogTagStats } from '@any-music/ui/catalog'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import { filterQueueTracks } from '@any-music/ui/library'
import type { UiThemeTrackListState, UiThemeTrackListActions } from '@any-music/ui/theme'
import { computed, shallowRef, watch } from 'vue'
import type { DeepReadonly } from 'vue'

import CatalogTrackFilterPanel from '../music-sources/CatalogTrackFilterPanel.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import ClassicFilterFooter from './ClassicFilterFooter.vue'

const props = defineProps<{
  state: DeepReadonly<
    Pick<
      UiThemeTrackListState,
      | 'tracks'
      | 'customTagsByTrackId'
      | 'customNamesByTrackId'
      | 'filters'
      | 'filterDraft'
      | 'platformNames'
      | 'addedAtMsByTrackId'
    >
  >
  actions: Pick<UiThemeTrackListActions, 'setFilterDraft' | 'applyFilters' | 'cancelFilters'>
  scope: string
  disabled?: boolean
  platformId?: string
}>()
const tracks = computed(() =>
  props.platformId === undefined
    ? props.state.tracks
    : props.state.tracks.filter((track) => track.source.pluginId === props.platformId),
)
const draft = computed({
  get: () => cloneCatalogTrackFilterState(props.state.filterDraft ?? props.state.filters),
  set: (value: CatalogTrackFilterState) => props.actions.setFilterDraft(value),
})
const detailOpen = shallowRef(false)
const dimensionPreview = shallowRef<CatalogTrackFilterState | null>(null)
watch(
  () => props.state.filterDraft,
  () => {
    dimensionPreview.value = null
  },
)
const preview = computed(() =>
  filterQueueTracks(
    tracks.value,
    dimensionPreview.value ?? draft.value,
    props.state.addedAtMsByTrackId,
    props.state.customNamesByTrackId,
    props.state.customTagsByTrackId,
  ),
)
const filterContext = computed(() =>
  props.scope.startsWith('favorites')
    ? 'favorites'
    : props.scope.startsWith('downloads')
      ? 'downloads'
      : 'queue',
)
const platformStats = computed(() => {
  const counts = new Map<string, number>()
  for (const track of tracks.value)
    counts.set(track.source.pluginId, (counts.get(track.source.pluginId) ?? 0) + 1)
  return [...counts].map(([id, count]) => ({
    id,
    name: props.state.platformNames.get(id) ?? id,
    count,
  }))
})
const tagStats = computed(() => getCatalogTagStats(tracks.value, props.state.customTagsByTrackId))
</script>

<template>
  <ClassicPageOverlays :modal-open="state.filterDraft !== null">
    <BottomSheet
      :open="state.filterDraft !== null"
      title="歌曲筛选器"
      size="full"
      @close="actions.cancelFilters"
    >
      <CatalogTrackFilterPanel
        v-if="state.filterDraft !== null"
        :inert="disabled ? true : undefined"
        v-model:filters="draft"
        :filter-context="filterContext"
        :tag-stats="tagStats"
        :platform-stats="platformStats"
        :platform-scoped="platformId !== undefined"
        :result-count="preview.length"
        :total-count="tracks.length"
        :history-scope="scope"
        @detail-open-change="detailOpen = $event"
        @preview-change="dimensionPreview = $event"
      />
      <template v-if="!detailOpen" #footer>
        <ClassicFilterFooter
          :summary="`匹配 ${preview.length} / ${tracks.length} 首`"
          :disabled="disabled"
          @cancel="actions.cancelFilters"
          @apply="actions.applyFilters"
        />
      </template>
    </BottomSheet>
  </ClassicPageOverlays>
</template>
