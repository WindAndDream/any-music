<script setup lang="ts">
import type { LibraryTrackRecord, MusicPlaylist } from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { MusicPlatformOption } from '@any-music/ui/library'
import { CUSTOM_TRACK_PLATFORM_ID } from '@any-music/ui/library'
import { computed } from 'vue'

/** 歌单卡片只展示本地集合的内容线索；打开与删除等操作由歌单页决定。 */
const props = defineProps<{
  playlist: MusicPlaylist
  records: readonly LibraryTrackRecord[]
  platforms: readonly MusicPlatformOption[]
  index: number
}>()
const emit = defineEmits<{ open: [playlistId: string] }>()

const preview = computed(() =>
  props.records.slice(0, 3).map((record) => record.customName ?? record.track.title),
)
const remainingCount = computed(() =>
  Math.max(0, props.playlist.trackIds.length - preview.value.length),
)
const platformSummary = computed(() => {
  const names = new Map(props.platforms.map((platform) => [platform.id, platform.name]))
  const counts = new Map<string, number>()
  for (const record of props.records) {
    const id =
      record.track.source.mediaKind === 'custom'
        ? CUSTOM_TRACK_PLATFORM_ID
        : record.track.source.pluginId
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([id]) => (id === CUSTOM_TRACK_PLATFORM_ID ? '自定义拼接音乐' : (names.get(id) ?? id)))
    .join(' · ')
})
</script>

<template>
  <article class="playlist-card">
    <div class="playlist-card__top">
      <span class="playlist-card__index" aria-hidden="true">{{
        String(props.index + 1).padStart(2, '0')
      }}</span>
      <span class="playlist-card__type">个人歌单</span>
    </div>
    <div class="playlist-card__body">
      <h3 :title="props.playlist.name">{{ props.playlist.name }}</h3>
      <p>
        {{ props.playlist.trackIds.length }} 首歌曲<span v-if="platformSummary">
          · {{ platformSummary }}</span
        >
      </p>
    </div>
    <div class="playlist-card__preview" aria-label="歌单歌曲预览">
      <template v-if="preview.length > 0">
        <span v-for="(title, titleIndex) in preview" :key="titleIndex">
          <small>{{ String(titleIndex + 1).padStart(2, '0') }}</small>
          <span :title="title">{{ title }}</span>
        </span>
        <small v-if="remainingCount > 0" class="playlist-card__remaining"
          >还有 {{ remainingCount }} 首</small
        >
      </template>
      <p v-else>还没有歌曲，可从音乐列表中添加。</p>
    </div>
    <button
      class="playlist-card__open"
      type="button"
      :data-playlist-id="props.playlist.id"
      @click="emit('open', props.playlist.id)"
    >
      查看歌曲
      <AppIcon name="arrow-right" :size="18" />
    </button>
  </article>
</template>

<style scoped>
.playlist-card {
  display: grid;
  min-inline-size: 0;
  grid-template-rows: auto auto minmax(88px, 1fr) auto;
  gap: var(--am-space-4);
  padding: var(--am-space-4);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-xl);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-control);
  color: var(--am-color-text);
}

.playlist-card__top,
.playlist-card__open {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.playlist-card__index {
  color: var(--am-color-primary);
  font-size: var(--am-font-size-xl);
  font-weight: 800;
  letter-spacing: -0.06em;
}

.playlist-card__type {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.playlist-card__body h3,
.playlist-card__body p,
.playlist-card__preview p {
  margin: 0;
}

.playlist-card__body h3 {
  overflow: hidden;
  font-size: var(--am-font-size-lg);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-card__body p,
.playlist-card__preview {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.playlist-card__body p {
  margin-block-start: var(--am-space-1);
}

.playlist-card__preview {
  display: grid;
  align-content: start;
  gap: var(--am-space-2);
  padding: var(--am-space-3);
  border-radius: var(--am-radius-lg);
  background: var(--am-color-surface-subtle);
}

.playlist-card__preview > span {
  display: flex;
  min-inline-size: 0;
  gap: var(--am-space-3);
}

.playlist-card__preview > span > span {
  overflow: hidden;
  color: var(--am-color-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-card__preview small {
  flex: 0 0 auto;
  color: var(--am-color-text-secondary);
}

.playlist-card__remaining {
  text-align: end;
}

.playlist-card__open {
  min-block-size: 44px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-primary);
  cursor: pointer;
  font: 700 var(--am-font-size-sm) var(--am-font-family);
  touch-action: manipulation;
}

.playlist-card__open:hover {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
}

.playlist-card__open:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
