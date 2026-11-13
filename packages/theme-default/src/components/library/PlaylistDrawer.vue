<script setup lang="ts">
import type {
  CustomTrackDefinition,
  LibraryTrackRecord,
  MusicPlaylist,
  Track,
} from '@any-music/core'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { filterOpenKey, filterDraftKey } from '@any-music/ui/library'
import type { MusicPlatformOption } from '@any-music/ui/library'
import { CUSTOM_TRACK_PLATFORM_ID } from '@any-music/ui/library'
import { usePlaylistFilters } from '@any-music/ui/library'
import type { PlaylistFilterState } from '@any-music/ui/library'
import { useCatalogListControls } from '@any-music/ui/library'
import { useConfirmAction } from '@any-music/ui/library'
import { useEditingSession, provideEditingSession } from '@any-music/ui/library'
import { computed, shallowRef } from 'vue'

import { usePresentationActivity } from '../../composables/use-presentation-activity'
import FavoritePlatformDrawer from './FavoritePlatformDrawer.vue'
import FavoriteTrackRow from './FavoriteTrackRow.vue'
import PlaylistAddToolbar from './PlaylistAddToolbar.vue'
import PlaylistFilterSheet from './PlaylistFilterSheet.vue'

/** 单个歌单视为完整歌曲页；筛选只决定可见歌曲，点播始终沿用歌单原始顺序。 */
const props = defineProps<{
  playlist: MusicPlaylist
  records: readonly LibraryTrackRecord[]
  customTracks: readonly CustomTrackDefinition[]
  platforms: readonly MusicPlatformOption[]
  favoriteTrackIds: ReadonlySet<string>
  currentTrackId?: string
  downloadBusy: boolean
}>()

const emit = defineEmits<{
  back: []
  delete: [playlistId: string]
  play: [track: Track]
  queue: [track: Track]
  compose: [trackId: string]
  favorite: [track: Track]
  unfavorite: [trackId: string]
  removeTrack: [playlistId: string, trackId: string]
  download: [tracks: readonly Track[]]
}>()
const confirm = useConfirmAction()
const activity = usePresentationActivity()
const editing = useEditingSession(`playlist:${props.playlist.id}`)
provideEditingSession(editing)
const { filters, visibleRecords, platformOptions, platformDrawers, customTrackById } =
  usePlaylistFilters(
    () => props.records,
    () => props.platforms,
    () => props.customTracks,
    editing,
  )

const isFilterOpen = editing.state(filterOpenKey, () => shallowRef(false))
const isArrangementOpen = shallowRef(false)
const filterDraft = editing.state(filterDraftKey, () =>
  shallowRef<PlaylistFilterState>({ ...filters.value }),
)
const expandedPlatformIds = shallowRef<ReadonlySet<string>>(new Set())
const platformLabelById = computed(
  () => new Map(platformOptions.value.map((platform) => [platform.id, platform.name])),
)
const visiblePlatformDrawers = computed(() =>
  platformDrawers.value.filter((item) => item.records.length > 0),
)
const draftTagStats = computed(() => {
  const selectedIds = new Set(filterDraft.value.selectedPlatformIds)
  const counts = new Map<string, number>()
  for (const record of props.records) {
    if (!selectedIds.has(record.track.source.pluginId)) continue
    for (const tag of record.customTags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .toSorted(
      (left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN'),
    )
})
const hasRegularDraftSelection = computed(() =>
  filterDraft.value.selectedPlatformIds.some((id) => id !== CUSTOM_TRACK_PLATFORM_ID),
)
const hasCustomDraftSelection = computed(() =>
  filterDraft.value.selectedPlatformIds.includes(CUSTOM_TRACK_PLATFORM_ID),
)
const activeFilterCount = computed(() => {
  const state = filters.value
  const textFields = [
    state.titleQuery,
    state.artistQuery,
    state.regularTag,
    state.regularPublishedFrom,
    state.regularPublishedTo,
    state.customCreatedFrom,
    state.customCreatedTo,
  ]
  return (
    textFields.filter(Boolean).length +
    Number(state.favoriteOnly) +
    Number(state.durationRange !== 'any') +
    Number(state.selectedPlatformIds.length !== platformOptions.value.length)
  )
})
const selection = useCatalogListControls({
  editing,
  items: visibleRecords,
  getId: (record) => record.track.id,
  getName: (record) => [record.customName ?? '', record.track.title].join('\n'),
})

function openFilters(): void {
  filterDraft.value = {
    ...filters.value,
    selectedPlatformIds: [...filters.value.selectedPlatformIds],
  }
  isFilterOpen.value = true
}

function applyFilters(): void {
  filters.value = filterDraft.value
  selection.clearSelection()
  isFilterOpen.value = false
}

function setArrangement(mode: PlaylistFilterState['arrangementMode']): void {
  filters.value = { ...filters.value, arrangementMode: mode }
  isArrangementOpen.value = false
}

function togglePlatformDrawer(platformId: string): void {
  const nextIds = new Set(expandedPlatformIds.value)
  if (nextIds.has(platformId)) nextIds.delete(platformId)
  else nextIds.add(platformId)
  expandedPlatformIds.value = nextIds
}

async function requestDelete(): Promise<void> {
  const isCurrent = activity.checkpoint()
  const confirmed = await confirm({
    title: '删除歌单',
    message: `确定删除歌单“${props.playlist.name}”吗？歌单内歌曲和“我的喜欢”不会被删除。`,
    confirmLabel: '删除歌单',
    tone: 'danger',
  })
  if (confirmed && isCurrent()) emit('delete', props.playlist.id)
}

function downloadSelectedTracks(): void {
  if (selection.selectedCount.value === 0 || props.downloadBusy) return
  const selectedIds = selection.selectedIds.value
  const tracks = visibleRecords.value
    .filter((record) => selectedIds.has(record.track.id))
    .map((record) => record.track)
  if (tracks.length === 0) return
  emit('download', tracks)
  selection.clearSelection()
}
</script>

<template>
  <article class="playlist-detail">
    <header class="playlist-detail__heading">
      <button
        data-playlist-back
        class="playlist-detail__back"
        type="button"
        aria-label="返回我的歌单"
        @click="emit('back')"
      >
        <AppIcon name="arrow-left" :size="18" />
        <span>返回歌单</span>
      </button>
      <div class="playlist-detail__context">
        <strong :title="props.playlist.name">{{ props.playlist.name }}</strong>
        <span
          >{{ props.playlist.trackIds.length }} 首歌曲 · 当前显示
          {{ visibleRecords.length }} 首</span
        >
      </div>
      <div class="playlist-detail__actions">
        <button type="button" aria-haspopup="dialog" @click="openFilters">
          <AppIcon name="filter" :size="17" />
          筛选<span v-if="activeFilterCount" class="playlist-detail__count">{{
            activeFilterCount
          }}</span>
        </button>
        <button type="button" aria-haspopup="dialog" @click="isArrangementOpen = true">
          <AppIcon name="list" :size="17" />
          排列
        </button>
      </div>
    </header>

    <div class="playlist-detail__subbar">
      <span>{{ filters.arrangementMode === 'mixed' ? '按歌单顺序' : '按平台分组' }}</span>
      <button type="button" @click="requestDelete">删除歌单</button>
    </div>

    <PlaylistAddToolbar
      :playlists="[]"
      :selected-count="selection.selectedCount.value"
      :are-all-visible-selected="selection.areAllVisibleSelected.value"
      :are-some-visible-selected="selection.areSomeVisibleSelected.value"
      :visible-count="visibleRecords.length"
      :can-add-to-playlist="false"
      :can-download="true"
      :download-busy="props.downloadBusy"
      @toggle-all-visible="selection.toggleAllVisible"
      @download-selected="downloadSelectedTracks"
    />

    <div v-if="props.records.length === 0" class="playlist-detail__empty">
      <AppIcon name="music" :size="28" />
      <strong>这个歌单还没有歌曲</strong>
      <p>在音乐列表或“我的喜欢”中选择歌曲，再加入这个歌单。</p>
    </div>
    <div v-else-if="visibleRecords.length === 0" class="playlist-detail__empty">
      <AppIcon name="filter" :size="28" />
      <strong>没有符合条件的歌曲</strong>
      <p>调整平台或其他筛选条件后再试。</p>
      <button type="button" @click="openFilters">调整筛选</button>
    </div>
    <div v-else-if="filters.arrangementMode === 'collapsed'" class="favorite-drawers">
      <FavoritePlatformDrawer
        v-for="drawer in visiblePlatformDrawers"
        :key="drawer.platform.id"
        :platform="drawer.platform"
        :records="drawer.records"
        :current-track-id="props.currentTrackId"
        :expanded="expandedPlatformIds.has(drawer.platform.id)"
        :platform-names="platformLabelById"
        :custom-track-by-id="customTrackById"
        :favorite-track-ids="props.favoriteTrackIds"
        :selected-track-ids="selection.selectedIds.value"
        :selectable="true"
        :total-label="`共 ${drawer.platform.count} 首`"
        :removable-from-playlist="true"
        @toggle="togglePlatformDrawer"
        @play="emit('play', $event)"
        @queue="emit('queue', $event)"
        @compose="emit('compose', $event)"
        @favorite="emit('favorite', $event)"
        @unfavorite="emit('unfavorite', $event)"
        @select="selection.toggleItem"
        @remove-from-playlist="emit('removeTrack', props.playlist.id, $event)"
      />
    </div>
    <div v-else class="favorites__items">
      <FavoriteTrackRow
        v-for="record in visibleRecords"
        :key="record.track.id"
        :record="record"
        :platform-name="
          platformLabelById.get(record.track.source.pluginId) ?? record.track.source.pluginId
        "
        :platform-names="platformLabelById"
        :custom-definition="customTrackById.get(record.track.id)"
        :active="record.track.id === props.currentTrackId"
        :favorite="props.favoriteTrackIds.has(record.track.id)"
        :selectable="true"
        :selected="selection.selectedIds.value.has(record.track.id)"
        :removable-from-playlist="true"
        @play="emit('play', $event)"
        @queue="emit('queue', $event)"
        @compose="emit('compose', $event)"
        @favorite="emit('favorite', $event)"
        @unfavorite="emit('unfavorite', $event)"
        @select="selection.toggleItem"
        @remove-from-playlist="emit('removeTrack', props.playlist.id, $event)"
      />
    </div>

    <PlaylistFilterSheet
      v-model="filterDraft"
      :open="isFilterOpen"
      :platform-options="platformOptions"
      :has-regular-selection="hasRegularDraftSelection"
      :has-custom-selection="hasCustomDraftSelection"
      :tag-stats="draftTagStats"
      @close="isFilterOpen = false"
      @apply="applyFilters"
    />
    <AppDialog
      :open="isArrangementOpen"
      title="排列歌曲"
      description="只改变浏览方式，播放仍以歌单保存的歌曲顺序为准。"
      size="compact"
      @close="isArrangementOpen = false"
    >
      <div class="playlist-detail__modes" role="group" aria-label="歌曲排列方式">
        <button
          type="button"
          :aria-pressed="filters.arrangementMode === 'mixed'"
          @click="setArrangement('mixed')"
        >
          <strong>歌单顺序</strong><small>按加入歌单的顺序连续浏览</small>
        </button>
        <button
          type="button"
          :aria-pressed="filters.arrangementMode === 'collapsed'"
          @click="setArrangement('collapsed')"
        >
          <strong>按平台分组</strong><small>先选平台，再展开其中的歌曲</small>
        </button>
      </div>
    </AppDialog>
  </article>
</template>

<style scoped>
.playlist-detail {
  container: am-playlist-detail / inline-size;
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-3);
}
.playlist-detail__heading {
  position: sticky;
  z-index: 3;
  top: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-lg);
  background: var(--am-color-surface);
}
.playlist-detail__back,
.playlist-detail__actions button,
.playlist-detail__subbar button {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: 700 var(--am-font-size-sm) var(--am-font-family);
  white-space: nowrap;
}
.playlist-detail__back {
  color: var(--am-color-primary);
}
.playlist-detail__back:focus-visible,
.playlist-detail__actions button:focus-visible,
.playlist-detail__subbar button:focus-visible,
.playlist-detail__modes button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.playlist-detail__context {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}
.playlist-detail__context strong {
  overflow: hidden;
  font-size: var(--am-font-size-lg);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.playlist-detail__context span,
.playlist-detail__subbar {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.playlist-detail__actions {
  display: flex;
  gap: var(--am-space-2);
}
.playlist-detail__count {
  display: grid;
  min-inline-size: 20px;
  block-size: 20px;
  place-items: center;
  border-radius: var(--am-radius-pill);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-xs);
}
.playlist-detail__subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-inline: var(--am-space-2);
}
.playlist-detail__subbar button {
  min-block-size: 44px;
  color: var(--am-color-danger);
}
.playlist-detail__empty {
  display: grid;
  min-block-size: 220px;
  place-content: center;
  justify-items: center;
  gap: var(--am-space-2);
  padding: var(--am-space-5);
  border: 1px dashed var(--am-color-border-strong);
  border-radius: var(--am-radius-xl);
  background: var(--am-color-surface);
  text-align: center;
}
.playlist-detail__empty p {
  margin: 0;
  color: var(--am-color-text-secondary);
}
.playlist-detail__empty button {
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-md);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  cursor: pointer;
  font: inherit;
}
.playlist-detail__modes {
  display: grid;
  gap: var(--am-space-2);
}
.playlist-detail__modes button {
  display: grid;
  gap: var(--am-space-1);
  min-block-size: 72px;
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  text-align: start;
}
.playlist-detail__modes button[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
}
.playlist-detail__modes small {
  color: var(--am-color-text-secondary);
}
@container am-playlist-detail (max-width: 720px) {
  .playlist-detail__heading {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .playlist-detail__actions {
    grid-column: 2;
    justify-content: flex-end;
  }
  .playlist-detail__back {
    grid-row: span 2;
  }
}
@container am-playlist-detail (max-width: 420px) {
  .playlist-detail__heading {
    gap: var(--am-space-2);
  }
  .playlist-detail__back span {
    display: none;
  }
  .playlist-detail__actions button {
    min-inline-size: 44px;
    padding-inline: var(--am-space-2);
  }
}
</style>
