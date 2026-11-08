<script setup lang="ts">
import {
  type CustomTrackPanelEmits,
  type CustomTrackPanelProps,
  useCustomTrackPanel,
} from '@any-music/ui/library'

import CustomTrackDrawer from './CustomTrackDrawer.vue'

const props = defineProps<CustomTrackPanelProps>()
const emit = defineEmits<CustomTrackPanelEmits>()

const { definitionById, expandedTrackIds, exportFormat, query, toggleTrack, visibleEntries } =
  useCustomTrackPanel(props)
</script>

<template>
  <section class="custom-tracks" aria-label="全部自定义音乐列表">
    <header class="custom-tracks__toolbar">
      <input
        v-model="query"
        placeholder="搜索全部自定义歌曲、创作者、来源博主或素材合集"
        aria-label="搜索全部自定义音乐"
      />
      <span>匹配 {{ visibleEntries.length }} / 共 {{ props.customTracks.length }} 首</span>
      <label>
        下载格式
        <select v-model="exportFormat">
          <option value="mp3">MP3 · 192 kbps</option>
          <option value="wav">WAV · PCM 16-bit</option>
        </select>
      </label>
    </header>

    <p v-if="props.errorMessage" class="custom-tracks__message custom-tracks__message--error">
      {{ props.errorMessage }}
    </p>
    <p v-if="props.exportMessage" class="custom-tracks__message">
      {{ props.exportMessage }}
    </p>
    <p v-if="props.customTracks.length === 0" class="custom-tracks__message">
      还没有自定义歌曲。请先在“片段创作”中创建素材合集并保存作品。
    </p>
    <p v-else-if="visibleEntries.length === 0" class="custom-tracks__message">
      没有匹配的自定义歌曲。
    </p>
    <div v-else class="custom-tracks__items">
      <CustomTrackDrawer
        v-for="entry in visibleEntries"
        :key="entry.record.track.id"
        :record="entry.record"
        :definition="entry.definition"
        :collection="entry.collection"
        :source-records="entry.sourceRecords"
        :custom-definitions="definitionById"
        :platform-names="props.platformNames"
        :favorite-track-ids="props.favoriteTrackIds"
        :current-track-id="props.currentTrackId"
        :expanded="expandedTrackIds.has(entry.record.track.id)"
        :export-format="exportFormat"
        :export-busy="props.exportBusy"
        @toggle="toggleTrack"
        @play="emit('play', $event)"
        @queue="emit('queue', $event)"
        @compose="emit('compose', $event)"
        @favorite="emit('favorite', $event)"
        @unfavorite="emit('unfavorite', $event)"
        @download="emit('download', $event, exportFormat)"
        @delete="emit('delete', $event)"
      />
    </div>
  </section>
</template>
