<script setup lang="ts">
import type { LibraryTrackRecord } from '@any-music/core'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import { computed } from 'vue'

export interface MaterialSegmentStats {
  segmentCount: number
  totalDurationMs: number
}

const props = defineProps<{
  records: readonly LibraryTrackRecord[]
  activeCollectionId: string
  platformNames: ReadonlyMap<string, string>
  segmentStatsByTrackId: ReadonlyMap<string, MaterialSegmentStats>
}>()

const emit = defineEmits<{
  addToCollection: [trackId: string]
  remove: [trackId: string]
}>()

const heading = computed(() =>
  props.activeCollectionId ? '选择素材并加入当前合集' : '先选择或创建合集，再整理这些素材',
)

function describeNature(record: LibraryTrackRecord): string {
  const kind = record.track.source.mediaKind
  if (kind === 'custom') return '性质：自定义成品，可再次作为素材并递归展开'
  return `性质：${kind === 'video' ? '视频音轨' : '音频'} · ${props.platformNames.get(record.track.source.pluginId) ?? record.track.source.pluginId}`
}

function describeClipStatus(trackId: string): string {
  const stats = props.segmentStatsByTrackId.get(trackId)
  if (!stats || stats.segmentCount === 0) return '截取状态：尚未截取'
  return `截取状态：已截取 ${stats.segmentCount} 段 · 合计 ${formatDuration(stats.totalDurationMs)}`
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>

<template>
  <section class="pending-materials" aria-label="待整理素材存储区">
    <header class="pending-materials__header">
      <div>
        <strong>待整理素材</strong>
        <small>{{ heading }}；切换板块或刷新页面都不会丢失。</small>
      </div>
      <span>{{ props.records.length }} 首</span>
    </header>
    <p v-if="props.records.length === 0" class="pending-materials__empty">
      在音乐列表、我的喜欢、歌单或自定义音乐中点击“截取”，歌曲会先存到这里。
    </p>
    <div v-else class="pending-materials__items">
      <article v-for="record in props.records" :key="record.track.id" class="pending-material">
        <TrackCardSummary
          :track="record.track"
          :context-label="
            props.platformNames.get(record.track.source.pluginId) ?? record.track.source.pluginId
          "
          :detail-lines="[
            describeNature(record),
            describeClipStatus(record.track.id),
            props.activeCollectionId ? '归档状态：等待加入当前合集' : '归档状态：尚未选择合集',
          ]"
          :badge-label="record.track.source.mediaKind === 'custom' ? '可复用成品' : '待归档'"
        />
        <div class="pending-material__actions">
          <button
            type="button"
            :disabled="!props.activeCollectionId"
            @click="emit('addToCollection', record.track.id)"
          >
            加入当前合集并截取
          </button>
          <button
            class="pending-material__remove"
            type="button"
            @click="emit('remove', record.track.id)"
          >
            移出待整理
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
