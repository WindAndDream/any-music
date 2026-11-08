<script setup lang="ts">
import type { LibraryTrackRecord } from '@any-music/core'
import type { TrackDisplayPreferences } from '@any-music/ui'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import CollectionSelectionToolbar from '@any-music/ui/components/CollectionSelectionToolbar.vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { useReadonlyTrackCollection } from '@any-music/ui/library'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import CatalogDisplayModeDialog from '../music-sources/CatalogDisplayModeDialog.vue'
import CatalogTrackFilterPanel from '../music-sources/CatalogTrackFilterPanel.vue'
import TrackRow from '../music-sources/TrackRow.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import ClassicFilterFooter from './ClassicFilterFooter.vue'

const props = defineProps<{
  records: readonly LibraryTrackRecord[]
  platformNames: ReadonlyMap<string, string>
  defaultDisplayPreferences?: TrackDisplayPreferences
  mobileLayout?: boolean
  selectedIds: ReadonlySet<string>
  disabled?: boolean
}>()
const emit = defineEmits<{
  modalOpenChange: [open: boolean]
  select: [id: string]
  toggleAll: [ids: readonly string[]]
}>()
const collection = useReadonlyTrackCollection(
  () => props.records,
  () => props.defaultDisplayPreferences,
)
const { view, tracks, customTags, visibleTracks, filterCount, tagStats, actions } = collection
const visibleIds = computed(() => visibleTracks.value.map(({ id }) => id))
const allSelected = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => props.selectedIds.has(id)),
)
const detailOpen = shallowRef(false)
const dimensionPreview = shallowRef<CatalogTrackFilterState | null>(null)
watch(
  () => view.filterDraft,
  () => {
    dimensionPreview.value = null
  },
)
const preview = computed(() =>
  collection.filter(dimensionPreview.value ?? view.filterDraft ?? view.filters),
)
const platformStats = computed(() => {
  const counts = new Map<string, number>()
  for (const track of tracks.value)
    counts.set(track.source.pluginId, (counts.get(track.source.pluginId) ?? 0) + 1)
  return [...counts].map(([id, count]) => ({ id, name: props.platformNames.get(id) ?? id, count }))
})
const modalOpen = computed(() => view.filterDraft !== null || view.displayOpen)
watch(modalOpen, (open) => emit('modalOpenChange', open), { immediate: true, flush: 'sync' })
onScopeDispose(() => emit('modalOpenChange', false))
</script>

<template>
  <section
    class="readonly-tracks"
    :class="{ 'readonly-tracks--mobile': mobileLayout }"
    aria-label="关联音乐列表"
  >
    <CollectionSelectionToolbar
      subject="音乐"
      :selected-count="selectedIds.size"
      :visible-count="visibleTracks.length"
      :all-selected="allSelected"
      :filter-count="filterCount"
      :mobile-layout="mobileLayout"
      :disabled="disabled"
      @display="view.displayOpen = true"
      @filter="collection.beginFilters"
      @toggle-all="emit('toggleAll', visibleIds)"
    />
    <div
      ref="viewport"
      class="readonly-tracks__viewport"
      role="region"
      aria-label="关联音乐滚动列表"
      tabindex="0"
    >
      <TrackCardGrid :display-mode="view.displayMode" :mobile-columns="view.mobileColumns">
        <div
          v-for="track in visibleTracks"
          :key="track.id"
          class="readonly-tracks__cell"
          data-readonly-track-cell
        >
          <TrackRow
            :track="track"
            :custom-tags="customTags.get(track.id)"
            :active="false"
            :invalid="false"
            :favorite="false"
            :selected="selectedIds.has(track.id)"
            :disabled="disabled"
            :display-mode="view.displayMode"
            :item-style="view.itemStyle"
            selectable
            selection-only
            @select="emit('select', $event)"
          />
        </div>
      </TrackCardGrid>
      <p v-if="!visibleTracks.length" class="readonly-tracks__empty">
        {{ tracks.length ? '没有匹配的音乐，请调整筛选条件。' : '这个标签还没有关联音乐。' }}
      </p>
    </div>
    <ClassicPageOverlays :modal-open="modalOpen">
      <CatalogDisplayModeDialog
        :open="view.displayOpen"
        :display-mode="view.displayMode"
        :mobile-columns="view.mobileColumns"
        :item-style="view.itemStyle"
        @update-display-mode="actions.setDisplayMode"
        @update-mobile-columns="actions.setMobileColumns"
        @update-item-style="actions.setItemStyle"
        @close="view.displayOpen = false"
      />
      <BottomSheet
        :open="view.filterDraft !== null"
        title="关联音乐筛选器"
        size="full"
        @close="actions.cancelFilters"
      >
        <CatalogTrackFilterPanel
          v-if="view.filterDraft"
          v-model:filters="view.filterDraft"
          :tag-stats="tagStats"
          :platform-stats="platformStats"
          :result-count="preview.length"
          :total-count="tracks.length"
          history-scope="tags:detail-tracks"
          @detail-open-change="detailOpen = $event"
          @preview-change="dimensionPreview = $event"
        />
        <template v-if="!detailOpen" #footer
          ><ClassicFilterFooter
            :summary="`匹配 ${preview.length} / ${tracks.length} 首`"
            @cancel="actions.cancelFilters"
            @apply="actions.applyFilters"
        /></template>
      </BottomSheet>
    </ClassicPageOverlays>
  </section>
</template>

<style scoped>
.readonly-tracks {
  container: am-readonly-tracks / inline-size;
  display: grid;
  min-inline-size: 0;
  min-block-size: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--am-space-3);
}
.readonly-tracks__viewport {
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.readonly-tracks__viewport:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.readonly-tracks__cell {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
.readonly-tracks__empty {
  color: var(--am-color-text-secondary);
  text-align: center;
}
</style>
