<script setup lang="ts">
import { collectionItemStyles } from '@any-music/card-styles'
import type { LibraryTrackRecord } from '@any-music/core'
import type { TrackDisplayPreferences } from '@any-music/ui'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import CollectionDisplayDialog from '@any-music/ui/components/CollectionDisplayDialog.vue'
import CollectionSelectionToolbar from '@any-music/ui/components/CollectionSelectionToolbar.vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { useReadonlyTrackCollection } from '@any-music/ui/library'
import { computed, onScopeDispose, watch } from 'vue'

import StudioTrackRow from '../catalog/StudioTrackRow.vue'
import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'
import StudioFilters from './StudioFilters.vue'
import StudioStyledTrack from './StudioStyledTrack.vue'

const props = defineProps<{
  records: readonly LibraryTrackRecord[]
  platformNames: ReadonlyMap<string, string>
  defaultDisplayPreferences?: TrackDisplayPreferences
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
const { view, tracks, visibleTracks, actions } = collection
const visibleIds = computed(() => visibleTracks.value.map(({ id }) => id))
const allSelected = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => props.selectedIds.has(id)),
)
const filterState = computed(() => ({
  ...view,
  tracks: tracks.value,
  customTagsByTrackId: collection.customTags.value,
  platformNames: props.platformNames,
}))
const modalOpen = computed(() => view.filterDraft !== null || view.displayOpen)
watch(modalOpen, (open) => emit('modalOpenChange', open), { immediate: true, flush: 'sync' })
onScopeDispose(() => emit('modalOpenChange', false))
</script>

<template>
  <section class="studio-readonly-tracks" aria-label="关联音乐列表">
    <CollectionSelectionToolbar
      subject="音乐"
      :selected-count="selectedIds.size"
      :visible-count="visibleTracks.length"
      :all-selected="allSelected"
      :filter-count="collection.filterCount.value"
      :disabled="disabled"
      @display="view.displayOpen = true"
      @filter="collection.beginFilters"
      @toggle-all="emit('toggleAll', visibleIds)"
    />
    <div
      class="studio-readonly-tracks__viewport"
      role="region"
      aria-label="关联音乐滚动列表"
      tabindex="0"
    >
      <TrackCardGrid
        v-if="view.itemStyle === 'minimal'"
        :display-mode="view.displayMode"
        :mobile-columns="view.mobileColumns"
      >
        <div v-for="track in visibleTracks" :key="track.id" class="studio-readonly-tracks__cell">
          <StudioStyledTrack
            :track="track"
            :title="collection.getDisplayName(track)"
            :custom-tags="collection.customTags.value.get(track.id)"
            :selected="selectedIds.has(track.id)"
            :disabled="disabled"
            selectable
            selection-only
            @select="emit('select', track.id)"
          />
        </div>
      </TrackCardGrid>
      <div v-else class="studio-table-scroll">
        <table
          class="studio-track-table"
          :data-density="view.displayMode"
          :data-mobile-columns="view.mobileColumns"
        >
          <caption>
            {{
              visibleTracks.length
            }}
            首关联音乐
          </caption>
          <thead>
            <tr>
              <th scope="col">选择</th>
              <th scope="col">音乐 / 作者</th>
              <th scope="col">时长</th>
            </tr>
          </thead>
          <tbody>
            <StudioTrackRow
              v-for="(track, index) in visibleTracks"
              :key="track.id"
              :track="track"
              :index="index"
              :title="collection.getDisplayName(track)"
              :selected="selectedIds.has(track.id)"
              :disabled="disabled"
              selectable
              :favorite="false"
              :queued="false"
              :invalid="false"
              :current="false"
              :download-busy="false"
              readonly
              @select="emit('select', track.id)"
            />
          </tbody>
        </table>
      </div>
      <p v-if="!visibleTracks.length" class="studio-readonly-tracks__empty">
        {{ tracks.length ? '没有匹配的音乐，请调整筛选条件。' : '这个标签还没有关联音乐。' }}
      </p>
    </div>
    <StudioPageOverlays :open="modalOpen">
      <CollectionDisplayDialog
        :open="view.displayOpen"
        :display-mode="view.displayMode"
        :mobile-columns="view.mobileColumns"
        :item-style="view.itemStyle"
        :styles="collectionItemStyles"
        @update-display-mode="actions.setDisplayMode"
        @update-mobile-columns="actions.setMobileColumns"
        @update-item-style="actions.setItemStyle"
        @close="view.displayOpen = false"
      />
      <AppDialog
        :open="view.filterDraft !== null"
        title="关联音乐筛选器"
        @close="actions.cancelFilters"
        ><StudioFilters
          v-if="view.filterDraft"
          :state="filterState"
          :actions="actions"
          :editing="collection.editing"
          scope="tags:detail-tracks"
      /></AppDialog>
    </StudioPageOverlays>
  </section>
</template>

<style scoped>
.studio-readonly-tracks {
  display: grid;
  min-inline-size: 0;
  min-block-size: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--am-space-3);
}
.studio-readonly-tracks__cell {
  container: am-track-card / inline-size;
  display: grid;
  min-inline-size: 0;
}
.studio-readonly-tracks__empty {
  text-align: center;
}
.studio-readonly-tracks__viewport {
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.studio-readonly-tracks__viewport:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
</style>
