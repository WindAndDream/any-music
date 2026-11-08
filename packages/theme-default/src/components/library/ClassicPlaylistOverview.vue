<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import { playlistEditorErrorMessage } from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { shallowRef, useTemplateRef } from 'vue'

import { useClassicPlaylistOverview } from '../../composables/use-classic-playlist-overview'
import { usePresentationActivity } from '../../composables/use-presentation-activity'
import CatalogDisplayModeDialog from '../music-sources/CatalogDisplayModeDialog.vue'
import ClassicPageOverlays from '../overlays/ClassicPageOverlays.vue'
import ClassicCollectionControls from './ClassicCollectionControls.vue'
import ClassicCollectionSurface from './ClassicCollectionSurface.vue'
import ClassicPlaylistTile from './ClassicPlaylistTile.vue'
import PlaylistOverviewFilters from './PlaylistOverviewFilters.vue'
import PlaylistOverviewOperator from './PlaylistOverviewOperator.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['playlists']; suspended?: boolean }>()
const emit = defineEmits<{ open: [id: string]; create: []; details: [id: string] }>()
const {
  state,
  collection,
  ids,
  compact,
  displayOpen,
  modalOpen,
  reorder,
  busy,
  error,
  available,
  removeSelected,
  downloadSelected,
} = useClassicPlaylistOverview(props, useTemplateRef<HTMLElement>('grid'))
const importInput = useTemplateRef<HTMLInputElement>('importInput')
const importMessage = shallowRef('')
const importError = shallowRef('')
const activity = usePresentationActivity()
async function importPlaylist(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !available() || state.value.transferBusy) return
  const current = activity.checkpoint()
  importError.value = ''
  importMessage.value = ''
  try {
    await props.feature.actions.importFile(file)
    if (current()) importMessage.value = '歌单已导入。'
  } catch (cause) {
    if (current()) importError.value = playlistEditorErrorMessage(cause)
  }
}
</script>

<template>
  <ClassicCollectionSurface
    title="我的歌单"
    :total-count="state.playlists.length"
    count-unit="个"
    intro="把喜欢的音乐收进自己的歌单，长按封面调整顺序。"
    :mobile-layout="state.mobileLayout"
    :detail="false"
    :empty="!collection.visible.value.length"
  >
    <template #controls>
      <div
        class="playlist-overview__actions"
        :class="{ 'playlist-overview__actions--compact': compact }"
      >
        <button
          type="button"
          class="playlist-overview__import"
          :disabled="!available() || state.transferBusy"
          @click="importInput?.click()"
        >
          <AppIcon name="arrow-down" :size="16" />{{ state.transferBusy ? '处理中…' : '导入歌单' }}
        </button>
        <input
          ref="importInput"
          hidden
          type="file"
          accept=".json,application/json"
          aria-label="选择歌单 JSON 文件"
          @change="importPlaylist"
        />
        <button
          type="button"
          class="playlist-overview__create"
          aria-haspopup="dialog"
          :disabled="!available()"
          @click="emit('create')"
        >
          <AppIcon name="plus" :size="16" />创建
        </button>
      </div>
      <p v-if="importMessage" role="status">{{ importMessage }}</p>
      <p v-if="importError" class="playlist-overview__error" role="alert">{{ importError }}</p>
    </template>
    <MusicListEmptyState
      v-if="!collection.visible.value.length"
      icon="playlist"
      :title="state.playlists.length ? '没有匹配的歌单' : '还没有歌单'"
      >{{
        state.playlists.length
          ? '调整筛选条件，找到想听的歌单。'
          : '创建歌单收集喜欢的音乐，或导入已有的 JSON 歌单文件。'
      }}</MusicListEmptyState
    >
    <!-- Keep the measurement root mounted for empty/filter states as well. -->
    <div ref="grid" class="playlist-overview__grid">
      <TrackCardGrid
        v-if="collection.visible.value.length"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
        :item-keys="ids"
        :animate="!reorder.isSettling.value"
      >
        <div
          v-for="(playlist, index) in collection.visible.value"
          :key="playlist.id"
          class="list__cell playlist-overview__cell"
          :class="{ 'playlist-overview__cell--dragging': reorder.draggedId.value === playlist.id }"
          data-queue-drop-kind="track"
          :data-queue-drop-id="playlist.id"
        >
          <ClassicPlaylistTile
            :playlist="playlist"
            :index="index"
            :tags="state.customTagsByPlaylistId?.get(playlist.id)"
            :cover-url="playlist.coverId ? state.coverUrls[playlist.coverId] : undefined"
            :dragging="reorder.draggedId.value === playlist.id"
            :get-reorder-style="reorder.getItemStyle"
            :selectable="collection.operatorOpen.value"
            :selected="collection.selectedIds.value.has(playlist.id)"
            @select="collection.select"
            @open="emit('open', $event)"
            @details="emit('details', $event)"
            @press="reorder.startTrackPress"
            @shift="(id, direction) => reorder.shift('track', id, direction)"
            @cancel-drag="reorder.clearDrag"
          />
        </div>
      </TrackCardGrid>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <ClassicPageOverlays :modal-open="modalOpen" :operator-open="collection.operatorOpen.value">
      <template #toolbar>
        <ClassicCollectionControls
          :selected-count="collection.selected.value.length"
          :total-count="collection.visible.value.length"
          :operator-open="collection.operatorOpen.value"
          can-display
          :icon-only-display="compact"
          :disabled="!available()"
          display-label="选择歌单展示方式"
          filter-label="筛选歌单"
          @filter="collection.draft.value = { ...collection.filters.value }"
          @operator="collection.operatorOpen.value = !collection.operatorOpen.value"
          @display="displayOpen = true"
        />
      </template>
      <CatalogDisplayModeDialog
        subject="歌单"
        :open="displayOpen"
        :display-mode="state.displayMode"
        :mobile-columns="state.mobileColumns"
        :suspended="!available()"
        @close="displayOpen = false"
        @update-display-mode="feature.actions.setDisplayMode"
        @update-mobile-columns="feature.actions.setMobileColumns"
      />
      <PlaylistOverviewFilters
        v-model:draft="collection.draft.value"
        :playlists="state.playlists"
        :custom-tags-by-playlist-id="state.customTagsByPlaylistId"
        :result-count="collection.preview.value.length"
        :total-count="state.playlists.length"
        :disabled="!available()"
        @apply="collection.applyFilters"
      />

      <template #operator>
        <PlaylistOverviewOperator
          :open="collection.operatorOpen.value"
          :suspended="modalOpen || !available()"
          :selected-count="collection.selected.value.length"
          :visible-count="collection.visible.value.length"
          :track-count="collection.selectedTrackIds.value.length"
          :all-selected="collection.allSelected.value"
          :download-busy="Boolean(state.downloadBusy || busy)"
          @close="collection.operatorOpen.value = false"
          @toggle-all="collection.toggleAll"
          @enqueue="feature.actions.enqueue(collection.selectedTrackIds.value)"
          @download="downloadSelected"
          @remove="removeSelected"
        />
      </template>
    </ClassicPageOverlays>
  </ClassicCollectionSurface>
</template>

<style scoped>
.playlist-overview__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--am-space-2);
  margin-block-end: var(--am-space-4);
  padding-block-end: var(--am-space-3);
  border-block-end: 1px solid var(--am-color-border);
}
.playlist-overview__error {
  color: var(--am-color-danger);
}
.playlist-overview__actions button {
  display: inline-flex;
  box-sizing: border-box;
  block-size: 44px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding: 0 var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  white-space: nowrap;
  cursor: pointer;
}
.playlist-overview__actions button:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-surface-hover);
}
.playlist-overview__actions .playlist-overview__create {
  border-color: var(--am-color-primary);
  color: var(--am-color-on-primary);
  background: var(--am-color-primary);
}
.playlist-overview__actions .playlist-overview__create:is(:hover, :focus-visible):not(:disabled) {
  background: color-mix(in srgb, var(--am-color-primary) 90%, var(--am-color-text));
}
.playlist-overview__actions button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.playlist-overview__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
@media (prefers-reduced-motion: no-preference) {
  .playlist-overview__actions .app-icon {
    transform-origin: center;
    transition: transform var(--am-motion-slow) var(--am-ease-emphasized);
  }
  .playlist-overview__import:is(:hover, :focus-visible):not(:disabled) .app-icon {
    transform: translateY(2px) scale(1.12);
  }
  .playlist-overview__create:is(:hover, :focus-visible):not(:disabled) .app-icon {
    transform: rotate(90deg) scale(1.15);
  }
}
.playlist-overview__actions--compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.playlist-overview__actions--compact button {
  min-inline-size: 0;
  inline-size: 100%;
  block-size: 44px;
}
.playlist-overview__cell {
  /* Slot content owns its sizing scope; tile queries follow each card's actual width. */
  container: am-track-card / inline-size;
  position: relative;
  display: grid;
  min-inline-size: 0;
}
.playlist-overview__cell--dragging {
  z-index: 2;
}
</style>
