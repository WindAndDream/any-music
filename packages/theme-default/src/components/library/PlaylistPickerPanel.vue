<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import {
  usePlaylistPicker,
  createPlaylistOverviewFilters,
  provideEditingSession,
  useEditingSession,
} from '@any-music/ui/library'
import type { PlaylistPickerProps } from '@any-music/ui/library'
import { onScopeDispose, watch } from 'vue'

import CatalogDisplayModeDialog from '../music-sources/CatalogDisplayModeDialog.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import PlaylistOverviewFilters from './PlaylistOverviewFilters.vue'
import PlaylistPickerItem from './PlaylistPickerItem.vue'

const props = defineProps<PlaylistPickerProps & { overlayTarget?: HTMLElement | null }>()
const emit = defineEmits<{
  select: [ids: readonly string[]]
  modalOpenChange: [open: boolean]
  back: []
}>()
provideEditingSession(useEditingSession('playlist-picker-panel'))
const {
  coverUrls,
  customTagsByPlaylistId,
  mobileLayout,
  view,
  visible,
  preview,
  selectedIds,
  allSelected,
  modalOpen,
  filterCount,
  select,
  toggleAll,
  applyFilters,
  submit,
  reset,
} = usePlaylistPicker(props)
watch(modalOpen, (open) => emit('modalOpenChange', open), { immediate: true, flush: 'sync' })
onScopeDispose(() => emit('modalOpenChange', false))
function back() {
  reset()
  emit('back')
}
function confirmSelection() {
  const ids = submit()
  if (ids.length) emit('select', ids)
}
</script>

<template>
  <section
    class="playlist-picker"
    :class="{ 'playlist-picker--mobile': mobileLayout }"
    aria-label="添加歌单"
  >
    <header class="playlist-picker__controls">
      <p role="status">已选 {{ view.selection.length }} 个</p>
      <button
        type="button"
        class="playlist-picker__display"
        title="展示方式"
        aria-label="歌单展示方式"
        aria-haspopup="dialog"
        :disabled="suspended"
        @click="view.displayOpen = true"
      >
        <AppIcon name="list" :size="18" /><span>展示方式</span>
      </button>
      <button
        type="button"
        class="playlist-picker__filter"
        aria-label="歌单筛选器"
        aria-haspopup="dialog"
        :disabled="suspended"
        @click="view.draft = { ...view.filters }"
      >
        <AppIcon name="filter" :size="18" />筛选器<span
          v-if="filterCount"
          class="playlist-picker__filter-count"
          >{{ filterCount }}</span
        >
      </button>
      <button
        type="button"
        class="playlist-picker__select-all"
        aria-label="全选当前歌单"
        :aria-pressed="allSelected"
        :disabled="suspended || !visible.length"
        @click="toggleAll"
      >
        <span class="playlist-picker__check" aria-hidden="true"
          ><AppIcon v-if="allSelected" name="check" :size="12" /></span
        >全选
      </button>
    </header>
    <div class="playlist-picker__viewport" role="region" aria-label="歌单滚动列表" tabindex="0">
      <TrackCardGrid :display-mode="view.displayMode" :mobile-columns="view.mobileColumns">
        <PlaylistPickerItem
          v-for="playlist in visible"
          :key="playlist.id"
          :playlist="playlist"
          :cover-url="playlist.coverId ? coverUrls[playlist.coverId] : undefined"
          :tags="customTagsByPlaylistId?.get(playlist.id)"
          :selected="selectedIds.has(playlist.id)"
          :disabled="suspended"
          @select="select"
        />
      </TrackCardGrid>
      <div v-if="!visible.length" class="playlist-picker__empty">
        <AppIcon name="playlist" :size="32" />
        <p>
          {{
            playlists.length
              ? '没有匹配的歌单，请调整筛选条件。'
              : '还没有歌单，请先前往“我的歌单”创建。'
          }}
        </p>
        <button
          v-if="playlists.length"
          type="button"
          :disabled="suspended"
          @click="view.filters = createPlaylistOverviewFilters()"
        >
          重置筛选
        </button>
      </div>
    </div>
    <footer class="playlist-picker__footer">
      <button type="button" :disabled="suspended" @click="back">
        <AppIcon name="arrow-left" :size="18" />返回
      </button>
      <button
        type="button"
        class="playlist-picker__submit"
        :disabled="suspended || !view.selection.length || !selectedCount"
        @click="confirmSelection"
      >
        <AppIcon name="playlist" :size="18" /><span>加入歌单</span
        ><span
          class="playlist-picker__submit-count"
          :aria-hidden="!view.selection.length"
          :style="{
            inlineSize: view.selection.length
              ? `calc(2em + ${String(view.selection.length).length}ch)`
              : '0px',
          }"
          >（{{ view.selection.length }}）</span
        >
      </button>
    </footer>
    <ClassicPageOverlays :modal-open="modalOpen" :modal-target="overlayTarget">
      <CatalogDisplayModeDialog
        subject="歌单"
        :open="view.displayOpen"
        :display-mode="view.displayMode"
        :mobile-columns="view.mobileColumns"
        :suspended="suspended"
        @close="view.displayOpen = false"
        @update-display-mode="view.displayMode = $event"
        @update-mobile-columns="view.mobileColumns = $event"
      />
      <PlaylistOverviewFilters
        v-model:draft="view.draft"
        :playlists="playlists"
        :result-count="preview.length"
        :total-count="playlists.length"
        :disabled="Boolean(suspended)"
        @apply="applyFilters"
      />
    </ClassicPageOverlays>
  </section>
</template>

<style scoped>
.playlist-picker {
  container: am-playlist-picker / inline-size;
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
}
.playlist-picker__controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, max-content);
  align-items: center;
  gap: var(--am-space-2);
}
.playlist-picker__controls p {
  min-inline-size: 0;
  margin: 0;
  overflow: hidden;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.playlist-picker button {
  display: inline-flex;
  box-sizing: border-box;
  min-block-size: 36px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: 700 var(--am-font-size-xs) var(--am-font-family);
  cursor: pointer;
  white-space: nowrap;
}
.playlist-picker button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}
.playlist-picker button:focus-visible,
.playlist-picker__viewport:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}

.playlist-picker .playlist-picker__submit {
  gap: 0;
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.playlist-picker__submit > .app-icon {
  margin-inline-end: var(--am-space-2);
}
.playlist-picker__submit-count {
  overflow: hidden;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  transition: inline-size var(--am-motion-normal) var(--am-ease-emphasized);
}

.playlist-picker .playlist-picker__submit:hover {
  background: var(--am-color-primary);
}
.playlist-picker button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.playlist-picker__viewport {
  max-block-size: min(360px, 45dvh);
  min-block-size: 120px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.playlist-picker__empty {
  display: grid;
  justify-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-5);
  color: var(--am-color-text-secondary);
  text-align: center;
}
.playlist-picker__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--am-space-3);
}

.playlist-picker__filter-count {
  display: grid;
  min-inline-size: 20px;
  block-size: 20px;
  place-items: center;
  padding-inline: 4px;
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  font-size: 10px;
}
.playlist-picker .playlist-picker__select-all,
.playlist-picker .playlist-picker__select-all:hover:not(:disabled) {
  background: var(--am-color-surface-subtle);
}
.playlist-picker__check {
  display: grid;
  flex: 0 0 16px;
  inline-size: 16px;
  block-size: 16px;
  box-sizing: border-box;
  place-items: center;
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-detail);
}
.playlist-picker .playlist-picker__select-all[aria-pressed='true'],
.playlist-picker .playlist-picker__select-all[aria-pressed='true']:hover:not(:disabled) {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.playlist-picker__select-all[aria-pressed='true'] .playlist-picker__check {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.playlist-picker .playlist-picker__footer button {
  min-block-size: 44px;
}
.playlist-picker--mobile .playlist-picker__display {
  inline-size: 36px;
  min-inline-size: 36px;
  padding-inline: 0;
}
.playlist-picker--mobile .playlist-picker__display span {
  display: none;
}
@container am-playlist-picker (max-width: 600px) {
  .playlist-picker__controls {
    gap: var(--am-space-1);
  }
  .playlist-picker__controls button {
    padding-inline: var(--am-space-2);
  }
  .playlist-picker .playlist-picker__display {
    inline-size: 36px;
    min-inline-size: 36px;
    padding-inline: 0;
  }
  .playlist-picker__display span {
    display: none;
  }
}
@container am-playlist-picker (max-width: 320px) {
  .playlist-picker__controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: var(--am-space-2);
  }
  .playlist-picker__display {
    justify-self: end;
  }
  .playlist-picker__filter,
  .playlist-picker__select-all {
    min-inline-size: 0;
    inline-size: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .playlist-picker__submit-count {
    transition: none;
  }
}
</style>
