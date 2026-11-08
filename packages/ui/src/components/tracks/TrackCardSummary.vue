<script setup lang="ts">
import type { Track } from '@any-music/core'
import { computed } from 'vue'

import { useTrackName } from '../../composables/tracks/use-track-name'
import AppIcon from '../AppIcon.vue'
import RemoteImage from '../music-sources/RemoteImage.vue'

// 卡牌摘要统一跨板块的封面与曲目信息；标签和操作仍由各功能组件通过插槽组合。
const props = withDefaults(
  defineProps<{
    track: Track
    contextLabel?: string
    trailingMeta?: string
    detailLines?: readonly string[]
    badgeLabel?: string
    badgeTone?: 'accent' | 'danger'
  }>(),
  {
    contextLabel: '',
    trailingMeta: '',
    detailLines: () => [],
    badgeLabel: '',
    badgeTone: 'accent',
  },
)

defineSlots<{
  details?: () => unknown
  'cover-overlay'?: () => unknown
  meta?: (props: { primaryMeta: string }) => unknown
}>()

const artistLabel = computed(() =>
  props.track.artists.length > 0
    ? props.track.artists.map((artist) => artist.name).join(' / ')
    : '创作者未知',
)
const primaryMeta = computed(() =>
  [
    props.contextLabel,
    artistLabel.value,
    formatDuration(props.track.durationMs),
    props.trailingMeta,
  ]
    .filter(Boolean)
    .join(' · '),
)
const badgeClass = computed(() => `track-card-summary__badge--${props.badgeTone}`)
const { customName, displayName } = useTrackName(() => props.track)

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) return '--:--'
  const totalSeconds = Math.floor(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="track-card-summary">
    <div class="track-card-summary__media">
      <RemoteImage
        v-if="props.track.artworkUrl"
        class="track-card-summary__cover"
        :src="props.track.artworkUrl"
        :alt="`${props.track.title} 封面`"
      />
      <div
        v-else
        class="track-card-summary__cover track-card-summary__cover--empty"
        aria-hidden="true"
      >
        <AppIcon name="music" :size="24" />
      </div>
      <slot name="cover-overlay" />
    </div>

    <div class="track-card-summary__body">
      <h3 class="track-card-summary__title" :title="displayName">
        {{ displayName }}
        <span v-if="props.badgeLabel" class="track-card-summary__badge" :class="badgeClass">
          {{ props.badgeLabel }}
        </span>
      </h3>
      <p
        v-if="customName"
        class="track-card-summary__original"
        :title="`原名：${props.track.title}`"
      >
        <span class="track-card-summary__name-label">原名</span>
        <span class="track-card-summary__original-text">{{ props.track.title }}</span>
      </p>
      <slot name="meta" :primary-meta="primaryMeta">
        <p class="track-card-summary__meta" :title="primaryMeta">{{ primaryMeta }}</p>
      </slot>
      <p
        v-for="(line, lineIndex) in props.detailLines"
        :key="`${lineIndex}:${line}`"
        class="track-card-summary__meta track-card-summary__meta--detail"
        :title="line"
      >
        {{ line }}
      </p>
      <div v-if="$slots.details" class="track-card-summary__details">
        <slot name="details" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.track-card-summary__original {
  display: flex;
  min-inline-size: 0;
  align-items: baseline;
  gap: var(--am-space-1);
  margin: var(--am-space-1) 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.track-card-summary__name-label {
  flex: 0 0 auto;
  font-weight: 500;
}
.track-card-summary__original-text {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
