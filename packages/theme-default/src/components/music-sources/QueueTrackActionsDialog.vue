<script setup lang="ts">
import type { MusicPlaylist, Track } from '@any-music/core'

import CatalogTrackActionsDialog from './CatalogTrackActionsDialog.vue'
import TrackActionButton from './TrackActionButton.vue'

/** 集合只扩展排序；待听通过主操作取消并沿用移出确认，喜欢则转发待听切换。 */
const props = defineProps<{
  playlists?: readonly MusicPlaylist[]
  track?: Track
  context?: 'queue' | 'favorites'
  queued?: boolean
  pinLabel: string
  canMoveUp: boolean
  canMoveDown: boolean
  suspended?: boolean
  favorite: boolean
  invalid: boolean
  customTags: readonly string[]
  downloadBusy: boolean
}>()
const emit = defineEmits<{
  addToPlaylist: [track: Track, playlistId: string]
  close: []
  play: [id: string]
  queue: [track: Track]
  pin: [id: string]
  remove: [id: string]
  shift: [id: string, direction: -1 | 1]
  favorite: [track: Track]
  compose: [track: Track]
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
  rename: [track: Track, name: string]
  download: [tracks: readonly Track[]]
}>()
</script>
<template>
  <CatalogTrackActionsDialog
    :playlists="playlists"
    @add-to-playlist="(track, id) => emit('addToPlaylist', track, id)"
    :open="Boolean(track)"
    :track="track"
    :queued="props.context !== 'favorites' || props.queued"
    :favorite="favorite"
    :invalid="invalid"
    :download-busy="downloadBusy"
    :custom-tags="customTags"
    :suspended="props.suspended"
    @close="emit('close')"
    @play="emit('play', $event.id)"
    @queue="props.context === 'favorites' ? emit('queue', $event) : emit('remove', $event.id)"
    @favorite="emit('favorite', $event)"
    @download="emit('download', [$event])"
    @compose="emit('compose', $event)"
    @add-tag="(track, tag) => emit('addTag', track, tag)"
    @remove-tag="(track, tag) => emit('removeTag', track, tag)"
    @rename="(track, name) => emit('rename', track, name)"
  >
    <template #queue-actions>
      <div
        v-if="track"
        class="queue-track-actions"
        role="group"
        :aria-label="props.context === 'favorites' ? '喜欢歌曲顺序操作' : '待听顺序操作'"
      >
        <TrackActionButton
          icon="arrow-down"
          label="后移一首"
          inline
          :disabled="!canMoveDown"
          @click="emit('shift', track.id, 1)"
        />
        <TrackActionButton
          icon="arrow-up"
          label="前移一首"
          inline
          :disabled="!canMoveUp"
          @click="emit('shift', track.id, -1)"
        />
        <TrackActionButton
          icon="arrow-up"
          :label="pinLabel"
          inline
          :disabled="!canMoveUp"
          @click="emit('pin', track.id)"
        />
      </div>
    </template>
  </CatalogTrackActionsDialog>
</template>
<style scoped>
.queue-track-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--am-space-2);
}
</style>
