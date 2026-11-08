<script setup lang="ts">
import type { CustomTrackDefinition, LibraryTrackRecord, Track } from '@any-music/core'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import TrackSourcePageLink from '@any-music/ui/components/tracks/TrackSourcePageLink.vue'
import { computed } from 'vue'

// 资料库曲目卡牌复用统一摘要，仅负责喜欢、歌单和批量选择场景的附加操作。
const props = defineProps<{
  record: LibraryTrackRecord
  platformName: string
  platformNames: ReadonlyMap<string, string>
  customDefinition?: CustomTrackDefinition
  active: boolean
  favorite: boolean
  selectable: boolean
  selected: boolean
  removableFromPlaylist: boolean
}>()

const emit = defineEmits<{
  play: [track: Track]
  queue: [track: Track]
  compose: [trackId: string]
  favorite: [track: Track]
  unfavorite: [trackId: string]
  select: [trackId: string]
  removeFromPlaylist: [trackId: string]
}>()

const isCustom = computed(() => props.record.track.source.mediaKind === 'custom')
const occurredLabel = computed(() => {
  const timestamp = isCustom.value
    ? (props.customDefinition?.createdAtMs ??
      props.record.track.publishedAtMs ??
      props.record.addedAtMs)
    : props.record.track.publishedAtMs
  if (timestamp === undefined) return isCustom.value ? '拼接时间未知' : '发布时间未知'
  const label = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(timestamp)
  return isCustom.value ? `拼接于 ${label}` : `发布于 ${label}`
})
const sourceCreditLabel = computed(() => {
  const credits = props.customDefinition?.sourceCredits ?? []
  if (credits.length === 0) return '来源博主未知'
  return credits
    .map((credit) => {
      const platformName = props.platformNames.get(credit.pluginId) ?? credit.pluginId
      const artist = credit.artistId
        ? `${credit.artistName} (${credit.artistId})`
        : credit.artistName
      return `${platformName} · ${artist}`
    })
    .join(' / ')
})
const favoritedLabel = computed(() => {
  if (props.record.favoritedAtMs === undefined) return ''
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(
    props.record.favoritedAtMs,
  )
})
const contextLabel = computed(() => (isCustom.value ? '自定义拼接音乐' : props.platformName))
const detailLines = computed(() => {
  const favoriteStatus = props.favorite ? `喜欢于 ${favoritedLabel.value}` : '未喜欢'
  if (isCustom.value) {
    return [`来源 ${sourceCreditLabel.value}`, `${occurredLabel.value} · ${favoriteStatus}`]
  }
  return [`${occurredLabel.value} · ${favoriteStatus}`]
})

function toggleFavorite(): void {
  if (props.favorite) emit('unfavorite', props.record.track.id)
  else emit('favorite', props.record.track)
}
</script>

<template>
  <article
    class="track-card favorite-track"
    :class="{
      'favorite-track--active': props.active,
      'favorite-track--selected': props.selected,
      'favorite-track--selectable': props.selectable,
    }"
  >
    <label
      v-if="props.selectable"
      class="favorite-track__select"
      :title="`选择 ${props.record.track.title}`"
    >
      <input
        type="checkbox"
        :checked="props.selected"
        :aria-label="`选择歌曲 ${props.record.track.title}`"
        @change="emit('select', props.record.track.id)"
      />
    </label>
    <TrackCardSummary
      :track="props.record.track"
      :context-label="contextLabel"
      :detail-lines="detailLines"
      :badge-label="props.favorite ? '已喜欢' : ''"
    >
      <template v-if="props.record.customTags.length > 0" #details>
        <div class="favorite-track__tags" aria-label="自定义标签">
          <span v-for="tag in props.record.customTags" :key="tag" class="favorite-track__tag">
            #{{ tag }}
          </span>
        </div>
      </template>
    </TrackCardSummary>

    <div class="favorite-track__actions">
      <button
        class="favorite-track__action--primary"
        type="button"
        @click="emit('play', props.record.track)"
      >
        播放
      </button>
      <button type="button" @click="emit('queue', props.record.track)">待听</button>
      <button type="button" @click="emit('compose', props.record.track.id)">截取</button>
      <button
        :class="{ 'favorite-track__unfavorite': props.favorite }"
        type="button"
        :aria-pressed="props.favorite"
        @click="toggleFavorite"
      >
        {{ props.favorite ? '取消喜欢' : '喜欢' }}
      </button>
      <button
        v-if="props.removableFromPlaylist"
        class="favorite-track__remove-playlist"
        type="button"
        @click="emit('removeFromPlaylist', props.record.track.id)"
      >
        移出歌单
      </button>
      <TrackSourcePageLink class="favorite-track__source-link" :track="props.record.track" />
    </div>
  </article>
</template>
