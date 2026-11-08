<script setup lang="ts">
import CollectionDisplayDialog from '@any-music/ui/components/CollectionDisplayDialog.vue'
import CollectionSelectionToolbar from '@any-music/ui/components/CollectionSelectionToolbar.vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { useReadonlyPlaylistCollection } from '@any-music/ui/library'
import type { TagPlaylistRecord } from '@any-music/ui/theme'
import { computed, onScopeDispose, watch } from 'vue'

import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import PlaylistOverviewFilters from './PlaylistOverviewFilters.vue'
import PlaylistPickerItem from './PlaylistPickerItem.vue'

const props = defineProps<{
  records: readonly TagPlaylistRecord[]
  selectedIds: ReadonlySet<string>
  disabled?: boolean
  mobileLayout?: boolean
}>()
const emit = defineEmits<{
  modalOpenChange: [open: boolean]
  select: [id: string]
  toggleAll: [ids: readonly string[]]
}>()
const {
  view,
  playlists,
  tags,
  visible,
  preview,
  modalOpen,
  filterCount,
  beginFilters,
  applyFilters,
} = useReadonlyPlaylistCollection(() => props.records)
const visibleIds = computed(() => visible.value.map(({ playlist }) => playlist.id))
const allSelected = computed(
  () => visibleIds.value.length > 0 && visibleIds.value.every((id) => props.selectedIds.has(id)),
)
watch(modalOpen, (open) => emit('modalOpenChange', open), { immediate: true, flush: 'sync' })
onScopeDispose(() => emit('modalOpenChange', false))
</script>

<template>
  <section class="readonly-playlists" aria-label="关联歌单列表">
    <CollectionSelectionToolbar
      subject="歌单"
      :selected-count="selectedIds.size"
      :visible-count="visible.length"
      :all-selected="allSelected"
      :filter-count="filterCount"
      :mobile-layout="mobileLayout"
      :disabled="disabled"
      @display="view.displayOpen = true"
      @filter="beginFilters"
      @toggle-all="emit('toggleAll', visibleIds)"
    />
    <div
      class="readonly-playlists__viewport"
      role="region"
      aria-label="关联歌单滚动列表"
      tabindex="0"
    >
      <TrackCardGrid :display-mode="view.displayMode" :mobile-columns="view.mobileColumns">
        <PlaylistPickerItem
          v-for="record in visible"
          :key="record.playlist.id"
          :playlist="record.playlist"
          :cover-url="record.coverUrl"
          :tags="record.customTags"
          :selected="selectedIds.has(record.playlist.id)"
          :disabled="disabled"
          @select="emit('select', $event)"
        />
      </TrackCardGrid>
      <p v-if="!visible.length" class="readonly-playlists__empty">
        {{ records.length ? '没有匹配的歌单，请调整筛选条件。' : '这个标签还没有关联歌单。' }}
      </p>
    </div>
    <ClassicPageOverlays :modal-open="modalOpen">
      <CollectionDisplayDialog
        :open="view.displayOpen"
        subject="歌单"
        :display-mode="view.displayMode"
        :mobile-columns="view.mobileColumns"
        :styles="[]"
        @update-display-mode="view.displayMode = $event"
        @update-mobile-columns="view.mobileColumns = $event"
        @close="view.displayOpen = false"
      />
      <PlaylistOverviewFilters
        v-model:draft="view.draft"
        :custom-tags-by-playlist-id="tags"
        :playlists="playlists"
        :result-count="preview.length"
        :total-count="records.length"
        :disabled="false"
        @apply="applyFilters"
      />
    </ClassicPageOverlays>
  </section>
</template>

<style scoped>
.readonly-playlists {
  display: grid;
  min-inline-size: 0;
  min-block-size: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--am-space-3);
}
.readonly-playlists__empty {
  color: var(--am-color-text-secondary);
  text-align: center;
}
.readonly-playlists__viewport {
  min-block-size: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.readonly-playlists__viewport:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
</style>
