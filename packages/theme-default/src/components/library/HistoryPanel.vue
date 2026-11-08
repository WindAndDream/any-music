<script setup lang="ts">
import type { PlaybackHistoryEntry, Track } from '@any-music/core'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import TrackSourcePageLink from '@any-music/ui/components/tracks/TrackSourcePageLink.vue'
import { getPlaybackHistoryStartedAfterMs } from '@any-music/ui/library'
import { useTrackNames } from '@any-music/ui/library'
import type { HistoryPanelProps, HistoryPanelEmits } from '@any-music/ui/theme'
import { computed } from 'vue'

// 历史面板复用待听卡片的标准摘要，只保留历史特有的时间与进度信息。
const props = withDefaults(defineProps<HistoryPanelProps>(), {
  query: '',
  platformId: 'all',
  timeRange: 'all',
})

const emit = defineEmits<HistoryPanelEmits>()

const trackById = computed(
  () => new Map(props.records.map((record) => [record.track.id, record.track])),
)
const { customNamesByTrackId } = useTrackNames()
const historyRows = computed(() => {
  const normalizedQuery = props.query.trim().toLocaleLowerCase()
  const startedAfterMs = props.startedAfterMs ?? getPlaybackHistoryStartedAfterMs(props.timeRange)
  return props.history.flatMap((entry) => {
    const track = trackById.value.get(entry.trackId)
    if (!track) return []
    const platformId = track.source.mediaKind === 'custom' ? 'custom' : track.source.pluginId
    const searchableText = [
      track.title,
      customNamesByTrackId.value.get(track.id) ?? '',
      ...track.artists.map((artist) => artist.name),
    ]
      .join(' ')
      .toLocaleLowerCase()
    if (props.platformId !== 'all' && platformId !== props.platformId) return []
    if (startedAfterMs !== undefined && entry.startedAtMs < startedAfterMs) return []
    if (normalizedQuery && !searchableText.includes(normalizedQuery)) return []
    return [
      {
        entry,
        track,
        detailLines: [
          `${formatStartedAt(entry.startedAtMs)} · ${entry.completed ? '已播完' : progressLabel(entry)}`,
        ],
      },
    ]
  })
})

function progressLabel(entry: PlaybackHistoryEntry): string {
  if (!entry.durationMs) return `${Math.round(entry.positionMs / 1000)}s`
  const progress = Math.min(100, Math.max(0, (entry.positionMs / entry.durationMs) * 100))
  return `${Math.round(progress)}%`
}

function formatStartedAt(timestampMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(
    timestampMs,
  )
}

function getContextLabel(track: Track): string {
  if (track.source.mediaKind === 'custom') return '本地拼接'
  return props.platformNames.get(track.source.pluginId) ?? track.source.pluginId
}
</script>

<template>
  <aside class="history queue" aria-label="播放历史">
    <div class="queue__header">
      <strong>播放历史 {{ props.history.length }}</strong>
      <button class="queue__action" type="button" @click="emit('openOperator')">筛选与管理</button>
    </div>
    <p v-if="props.history.length === 0" class="queue__empty">暂无播放历史。</p>
    <p v-else-if="historyRows.length === 0" class="queue__empty">没有符合当前筛选条件的记录。</p>
    <div v-else class="queue__items">
      <article
        v-for="row in historyRows"
        :key="row.entry.id"
        class="track-card track queue__item history__item"
      >
        <TrackCardSummary
          :track="row.track"
          :context-label="getContextLabel(row.track)"
          :detail-lines="row.detailLines"
        />
        <div class="queue__actions">
          <button
            class="queue__action queue__action--primary"
            type="button"
            @click="emit('queue', row.track)"
          >
            待听
          </button>
          <TrackSourcePageLink
            v-if="row.track.source.mediaKind !== 'custom'"
            class="queue__source-link"
            :track="row.track"
          />
        </div>
      </article>
    </div>
  </aside>
</template>
