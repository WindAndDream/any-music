<script setup lang="ts">
import type {
  CustomTrackDefinition,
  LibraryTrackRecord,
  MaterialCollection,
  Track,
} from '@any-music/core'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import { useConfirmAction } from '@any-music/ui/library'
import type { AudioExportFormat } from '@any-music/ui/library'
import { useUiContributionAvailability } from '@any-music/ui/library'
import { computed } from 'vue'

import { usePresentationActivity } from '../../composables/use-presentation-activity'
import FavoriteTrackRow from './FavoriteTrackRow.vue'

const props = defineProps<{
  record: LibraryTrackRecord
  definition: CustomTrackDefinition
  collection?: MaterialCollection
  sourceRecords: readonly LibraryTrackRecord[]
  customDefinitions: ReadonlyMap<string, CustomTrackDefinition>
  platformNames: ReadonlyMap<string, string>
  favoriteTrackIds: ReadonlySet<string>
  currentTrackId?: string
  expanded: boolean
  exportFormat: AudioExportFormat
  exportBusy: boolean
}>()

const emit = defineEmits<{
  toggle: [trackId: string]
  play: [track: Track]
  queue: [track: Track]
  compose: [trackId: string]
  favorite: [track: Track]
  unfavorite: [trackId: string]
  download: [trackId: string, format: AudioExportFormat]
  delete: [trackId: string]
}>()
const confirm = useConfirmAction()
const activity = usePresentationActivity()
const creation = useUiContributionAvailability('track.actions.secondary', () => ({
  hasTrack: true,
}))

const directSourceCount = computed(
  () => new Set(props.definition.recipe.map((segment) => segment.sourceTrackId)).size,
)
const leafSourceCount = computed(
  () => new Set(props.definition.compiledSegments.map((segment) => segment.sourceTrackId)).size,
)
const detailLines = computed(() => [
  `素材合集 ${props.collection?.name ?? '未关联素材合集'}`,
  `${directSourceCount.value} 首直接素材 · ${leafSourceCount.value} 首叶子来源 · ${props.definition.compiledSegments.length} 个导出片段`,
])
const directRangesByTrackId = computed(() => {
  const ranges = new Map<string, string[]>()
  for (const segment of props.definition.recipe) {
    const current = ranges.get(segment.sourceTrackId) ?? []
    current.push(`${formatTime(segment.startMs)}–${formatTime(segment.endMs)}`)
    ranges.set(segment.sourceTrackId, current)
  }
  return ranges
})

async function requestDelete(): Promise<void> {
  const isCurrent = activity.checkpoint()
  const confirmed = await confirm({
    title: '删除自定义歌曲',
    message: `确定删除自定义歌曲“${props.record.track.title}”吗？仍被其他作品使用时系统会阻止删除。`,
    confirmLabel: '删除歌曲',
    tone: 'danger',
  })
  if (confirmed && isCurrent()) {
    emit('delete', props.record.track.id)
  }
}

function formatTime(milliseconds: number): string {
  const totalSeconds = milliseconds / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0')
  return `${minutes}:${seconds}`
}
</script>

<template>
  <article class="custom-track-drawer">
    <header class="custom-track-drawer__header">
      <button
        class="custom-track-drawer__toggle"
        type="button"
        :aria-expanded="props.expanded"
        :aria-controls="`custom-track-sources-${props.record.track.id}`"
        @click="emit('toggle', props.record.track.id)"
      >
        <AppIcon :name="props.expanded ? 'arrow-down' : 'arrow-right'" />
        <TrackCardSummary
          :track="props.record.track"
          context-label="单首自定义歌曲"
          :detail-lines="detailLines"
          badge-label="自定义"
        />
      </button>
      <div class="custom-track-drawer__actions">
        <button type="button" @click="emit('play', props.record.track)">播放</button>
        <button type="button" @click="emit('queue', props.record.track)">待听</button>
        <button
          v-if="creation.allows('compose')"
          type="button"
          @click="creation.allows('compose') && emit('compose', props.record.track.id)"
        >
          作为素材
        </button>
        <button
          type="button"
          :aria-pressed="props.favoriteTrackIds.has(props.record.track.id)"
          @click="
            props.favoriteTrackIds.has(props.record.track.id)
              ? emit('unfavorite', props.record.track.id)
              : emit('favorite', props.record.track)
          "
        >
          {{ props.favoriteTrackIds.has(props.record.track.id) ? '取消喜欢' : '喜欢' }}
        </button>
        <button
          type="button"
          :disabled="props.exportBusy"
          @click="emit('download', props.record.track.id, props.exportFormat)"
        >
          下载
        </button>
        <button class="custom-track-drawer__delete" type="button" @click="requestDelete">
          删除
        </button>
      </div>
    </header>

    <div
      v-if="props.expanded"
      :id="`custom-track-sources-${props.record.track.id}`"
      class="custom-track-drawer__panel"
    >
      <div class="custom-track-drawer__source-heading">
        <div>
          <strong>直接使用的音乐素材</strong>
          <small>嵌套自定义歌曲保留为素材节点，导出时递归展开到普通平台音轨。</small>
        </div>
      </div>
      <p v-if="props.sourceRecords.length === 0" class="custom-tracks__message">
        来源资料已不可用。
      </p>
      <div v-else class="custom-track-drawer__sources">
        <div v-for="sourceRecord in props.sourceRecords" :key="sourceRecord.track.id">
          <p class="custom-track-drawer__ranges">
            使用范围：{{ directRangesByTrackId.get(sourceRecord.track.id)?.join('、') }}
          </p>
          <FavoriteTrackRow
            :record="sourceRecord"
            :platform-name="
              props.platformNames.get(sourceRecord.track.source.pluginId) ??
              sourceRecord.track.source.pluginId
            "
            :platform-names="props.platformNames"
            :custom-definition="props.customDefinitions.get(sourceRecord.track.id)"
            :active="sourceRecord.track.id === props.currentTrackId"
            :favorite="props.favoriteTrackIds.has(sourceRecord.track.id)"
            :selectable="false"
            :selected="false"
            :removable-from-playlist="false"
            @play="emit('play', $event)"
            @queue="emit('queue', $event)"
            @compose="emit('compose', $event)"
            @favorite="emit('favorite', $event)"
            @unfavorite="emit('unfavorite', $event)"
          />
        </div>
      </div>
    </div>
  </article>
</template>
