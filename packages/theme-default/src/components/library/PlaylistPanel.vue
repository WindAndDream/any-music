<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import {
  type PlaylistPanelEmits,
  type PlaylistPanelProps,
  usePlaylistPanel,
} from '@any-music/ui/library'
import { useBackHandler } from '@any-music/ui/library'
import { computed, nextTick, useTemplateRef } from 'vue'

import PlaylistCard from './PlaylistCard.vue'
import PlaylistDrawer from './PlaylistDrawer.vue'

/** 歌单总览与单个歌曲页沿用一个集合身份，返回时保留查找位置和键盘焦点。 */
const props = defineProps<PlaylistPanelProps>()
const emit = defineEmits<PlaylistPanelEmits>()
const overview = useTemplateRef<HTMLElement>('overview')
const detailStage = useTemplateRef<HTMLElement>('detailStage')
const {
  activePlaylistId,
  closePlaylist,
  deletePlaylist,
  openPlaylist,
  playlistDraft,
  playPlaylistTrack,
  query,
  recordsByPlaylistId,
  submitPlaylist,
  visiblePlaylists,
} = usePlaylistPanel({ emit, props })

const activePlaylist = computed(() =>
  props.playlists.find((item) => item.id === activePlaylistId.value),
)
const totalTrackCount = computed(() =>
  props.playlists.reduce((count, item) => count + item.trackIds.length, 0),
)
let previousScrollTop = 0

function getScrollContainer(): HTMLElement | undefined {
  let element = overview.value?.parentElement
  while (element) {
    if (/auto|scroll/.test(getComputedStyle(element).overflowY)) return element
    element = element.parentElement
  }
  return undefined
}

async function viewPlaylist(playlistId: string): Promise<void> {
  const scrollContainer = getScrollContainer()
  previousScrollTop = scrollContainer?.scrollTop ?? 0
  openPlaylist(playlistId)
  await nextTick()
  if (scrollContainer) scrollContainer.scrollTop = 0
  detailStage.value
    ?.querySelector<HTMLButtonElement>('[data-playlist-back]')
    ?.focus({ preventScroll: true })
}

async function returnToOverview(playlistId: string): Promise<void> {
  closePlaylist()
  await nextTick()
  const scrollContainer = getScrollContainer()
  if (scrollContainer) scrollContainer.scrollTop = previousScrollTop
  const buttons = overview.value?.querySelectorAll<HTMLButtonElement>('[data-playlist-id]') ?? []
  ;[...buttons]
    .find((button) => button.dataset.playlistId === playlistId)
    ?.focus({ preventScroll: true })
}

async function removePlaylist(playlistId: string): Promise<void> {
  deletePlaylist(playlistId)
  await nextTick()
  overview.value?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
}
useBackHandler({
  active: () => Boolean(activePlaylist.value),
  handle: () => {
    if (activePlaylistId.value) void returnToOverview(activePlaylistId.value)
  },
})
</script>

<template>
  <section class="playlists" aria-label="我的歌单">
    <div ref="overview" v-show="!activePlaylist" class="playlists__overview">
      <header class="playlists__intro">
        <div>
          <span class="playlists__eyebrow">你的收藏</span>
          <h2>我的歌单</h2>
          <p>{{ props.playlists.length }} 个歌单 · 收纳 {{ totalTrackCount }} 首歌曲</p>
        </div>
        <label v-if="props.playlists.length > 0" class="playlists__search">
          <AppIcon name="search" :size="18" />
          <span class="am-sr-only">搜索歌单名称</span>
          <input v-model="query" type="search" placeholder="搜索歌单名称…" />
          <small>{{ visiblePlaylists.length }} / {{ props.playlists.length }}</small>
        </label>
      </header>

      <form class="playlists__create" @submit.prevent="submitPlaylist">
        <label>
          <span>创建新的歌单</span>
          <input
            v-model="playlistDraft"
            maxlength="80"
            placeholder="给歌单取个名字"
            aria-label="新歌单名称"
          />
        </label>
        <button type="submit" :disabled="!playlistDraft.trim()">
          <AppIcon name="playlist" :size="18" />
          创建歌单
        </button>
      </form>

      <p
        v-if="props.errorMessage"
        class="playlists__message playlists__message--error"
        role="alert"
      >
        {{ props.errorMessage }}
      </p>
      <div v-if="props.playlists.length === 0" class="playlists__empty">
        <AppIcon name="playlist" :size="28" />
        <strong>先创建一个歌单</strong>
        <p>之后可从音乐列表或“我的喜欢”把歌曲加入这里。</p>
      </div>
      <div v-else-if="visiblePlaylists.length === 0" class="playlists__empty">
        <AppIcon name="search" :size="28" />
        <strong>没有找到这个歌单</strong>
        <p>试试歌单名称中的其他字词。</p>
      </div>
      <div v-else class="playlists__grid">
        <PlaylistCard
          v-for="(playlist, index) in visiblePlaylists"
          :key="playlist.id"
          :playlist="playlist"
          :records="recordsByPlaylistId.get(playlist.id) ?? []"
          :platforms="props.platforms"
          :index="index"
          @open="viewPlaylist"
        />
      </div>
    </div>

    <div v-if="activePlaylist" ref="detailStage" class="playlists__detail">
      <PlaylistDrawer
        :key="activePlaylist.id"
        :playlist="activePlaylist"
        :records="recordsByPlaylistId.get(activePlaylist.id) ?? []"
        :custom-tracks="props.customTracks"
        :platforms="props.platforms"
        :favorite-track-ids="props.favoriteTrackIds"
        :current-track-id="props.currentTrackId"
        :download-busy="props.downloadBusy"
        @back="returnToOverview(activePlaylist.id)"
        @delete="removePlaylist"
        @play="playPlaylistTrack($event, activePlaylist.id)"
        @queue="emit('queue', $event)"
        @compose="emit('compose', $event)"
        @favorite="emit('favorite', $event)"
        @unfavorite="emit('unfavorite', $event)"
        @download="emit('download', $event, activePlaylist)"
        @remove-track="(playlistId, trackId) => emit('removeTrack', playlistId, trackId)"
      />
    </div>
  </section>
</template>

<style scoped>
.playlists {
  container: am-playlists / inline-size;
  min-inline-size: 0;
  padding: var(--am-space-4);
  padding-block-end: calc(var(--am-space-6) + env(safe-area-inset-bottom));
}
.playlists__overview,
.playlists__detail {
  display: grid;
  gap: var(--am-space-4);
}
.playlists__intro {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--am-space-4);
}
.playlists__eyebrow {
  color: var(--am-color-primary);
  font-size: var(--am-font-size-xs);
  font-weight: 800;
}
.playlists__intro h2,
.playlists__intro p {
  margin: 0;
}
.playlists__intro h2 {
  margin-block: var(--am-space-1);
  font-size: clamp(1.25rem, 2.5vw, 1.75rem);
}
.playlists__intro p {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.playlists__search {
  display: flex;
  inline-size: min(100%, 340px);
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text-secondary);
}
.playlists__search:focus-within {
  border-color: var(--am-color-primary);
}
.playlists__search input {
  min-inline-size: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
}
.playlists__search small {
  white-space: nowrap;
}
.playlists__create {
  display: flex;
  align-items: end;
  gap: var(--am-space-3);
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-lg);
  background: var(--am-color-surface);
}
.playlists__create label {
  display: grid;
  min-inline-size: 0;
  flex: 1;
  gap: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 700;
}
.playlists__create input {
  min-inline-size: 0;
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}
.playlists__create button {
  display: inline-flex;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-md);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  cursor: pointer;
  font: 700 var(--am-font-size-sm) var(--am-font-family);
  white-space: nowrap;
}
.playlists__create button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.playlists__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--am-space-4);
}
.playlists__empty {
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
.playlists__empty p,
.playlists__message {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.playlists__message--error {
  color: var(--am-color-danger);
}
@container am-playlists (max-width: 680px) {
  .playlists__intro {
    align-items: stretch;
    flex-direction: column;
  }
  .playlists__search {
    inline-size: 100%;
  }
  .playlists__grid {
    grid-template-columns: 1fr;
  }
}
@container am-playlists (max-width: 420px) {
  .playlists__create {
    align-items: stretch;
    flex-direction: column;
  }
  .playlists__create button {
    inline-size: 100%;
  }
}
</style>
