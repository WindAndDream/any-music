<script setup lang="ts">
import type { LibraryTrackRecord, SegmentRecipe } from '@any-music/core'
import { useEditingSession } from '@any-music/ui'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import { computed, shallowRef, watch } from 'vue'

import { startSecondsKey, endSecondsKey } from '../material-range-state'

const props = defineProps<{
  record: LibraryTrackRecord
  platformName: string
  included: boolean
  segmentCount: number
  clippedDurationMs: number
  exportBusy: boolean
}>()

const emit = defineEmits<{
  addMaterial: [trackId: string]
  removeMaterial: [trackId: string]
  addSegment: [segment: SegmentRecipe]
  preview: [segment: SegmentRecipe]
  download: [segment: SegmentRecipe]
}>()

const startSeconds = useEditingSession(`material:${props.record.track.id}`).state(
  startSecondsKey,
  () => shallowRef<number | ''>(0),
)
const endSeconds = useEditingSession(`material:${props.record.track.id}`).state(endSecondsKey, () =>
  shallowRef<number | ''>(Math.min(30, (props.record.track.durationMs ?? 30_000) / 1000)),
)

const durationSeconds = computed(() => (props.record.track.durationMs ?? 0) / 1000)
const range = computed<SegmentRecipe | undefined>(() => {
  const startMs = Math.round(Number(startSeconds.value) * 1000)
  const endMs = Math.round(Number(endSeconds.value) * 1000)
  if (
    startMs < 0 ||
    endMs <= startMs ||
    (props.record.track.durationMs !== undefined && endMs > props.record.track.durationMs)
  ) {
    return undefined
  }
  return { sourceTrackId: props.record.track.id, startMs, endMs }
})
const detailLines = computed(() => [
  `合集状态：${props.included ? '已加入，可截取' : '尚未加入'}`,
  props.segmentCount > 0
    ? `截取状态：已截取 ${props.segmentCount} 段 · 合计 ${formatDuration(props.clippedDurationMs)}`
    : '截取状态：尚未截取',
  props.record.track.source.mediaKind === 'custom'
    ? '性质：自定义成品，保存和导出时递归展开为叶子素材'
    : `性质：${props.record.track.source.mediaKind === 'video' ? '视频音轨' : '音频'} · 来源 ID ${props.record.track.source.resourceId}`,
])

watch(
  () => props.record.track.id,
  () => {
    startSeconds.value = 0
    endSeconds.value = Math.min(30, (props.record.track.durationMs ?? 30_000) / 1000)
  },
)

function emitRange(action: 'add' | 'preview' | 'download'): void {
  const segment = range.value
  if (!segment) return
  if (action === 'add') emit('addSegment', segment)
  else if (action === 'preview') emit('preview', segment)
  else emit('download', segment)
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
</script>

<template>
  <article class="material-track" :class="{ 'material-track--included': props.included }">
    <TrackCardSummary
      :track="props.record.track"
      :context-label="props.platformName"
      :detail-lines="detailLines"
      :badge-label="props.record.track.source.mediaKind === 'custom' ? '可复用成品' : ''"
    >
      <template v-if="props.record.customTags.length > 0" #details>
        <div class="material-track__tags">
          <span v-for="tag in props.record.customTags" :key="tag">#{{ tag }}</span>
        </div>
      </template>
    </TrackCardSummary>

    <div class="material-track__membership">
      <button
        v-if="props.included"
        class="material-track__remove"
        type="button"
        @click="emit('removeMaterial', props.record.track.id)"
      >
        移出合集
      </button>
      <button v-else type="button" @click="emit('addMaterial', props.record.track.id)">
        加入合集
      </button>
    </div>

    <div v-if="props.included" class="material-track__range">
      <label>
        开始秒
        <input v-model="startSeconds" type="number" min="0" step="0.01" />
      </label>
      <label>
        结束秒
        <input v-model="endSeconds" type="number" min="0" :max="durationSeconds" step="0.01" />
      </label>
      <button type="button" :disabled="!range" @click="emitRange('add')">加入时间线</button>
      <button type="button" :disabled="!range" @click="emitRange('preview')">试听选段</button>
      <button type="button" :disabled="!range || props.exportBusy" @click="emitRange('download')">
        下载选段
      </button>
    </div>
  </article>
</template>
