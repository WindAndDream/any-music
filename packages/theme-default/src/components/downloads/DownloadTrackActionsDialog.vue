<script setup lang="ts">
import type { MusicPlaylist, Track } from '@any-music/core'
import type { DownloadListEntry } from '@any-music/ui/library'
import { computed } from 'vue'

import CatalogTrackActionsDialog from '../music-sources/CatalogTrackActionsDialog.vue'
import TrackActionButton from '../music-sources/TrackActionButton.vue'
import { getDownloadTrackAction, getDownloadTrackStatus } from './download-track-presentation'

/** Extend the shared song actions with task control and confirmed record removal. */
const props = defineProps<{
  playlists?: readonly MusicPlaylist[]
  entry?: DownloadListEntry
  favorite: boolean
  queued: boolean
  invalid: boolean
  customTags: readonly string[]
  cancelling: boolean
  suspended: boolean
}>()
const emit = defineEmits<{
  addToPlaylist: [track: Track, playlistId: string]
  close: []
  pause: [id: string]
  resume: [id: string]
  cancel: [id: string]
  remove: [id: string]
  play: [track: Track]
  queue: [track: Track]
  favorite: [track: Track]
  compose: [track: Track]
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
  rename: [track: Track, name: string]
}>()
const action = computed(() => (props.entry ? getDownloadTrackAction(props.entry) : undefined))
const statusMessage = computed(() => (props.entry ? getDownloadTrackStatus(props.entry) : ''))

function controlTask(): void {
  if (!props.entry || !action.value || props.suspended || props.cancelling || action.value.disabled)
    return
  if (props.invalid && action.value.event === 'resume') return
  const id = props.entry.item.id
  const event = action.value.event
  emit('close')
  if (event === 'pause') emit('pause', id)
  else emit('resume', id)
}
function removeTask(): void {
  if (!props.entry || props.suspended || props.cancelling) return
  const id = props.entry.item.id
  emit('close')
  emit('remove', id)
}
function cancelTask(): void {
  if (
    !props.entry ||
    props.suspended ||
    props.cancelling ||
    props.entry.saving ||
    (props.entry.state !== 'downloading' && props.entry.item.status !== 'paused')
  )
    return
  const id = props.entry.item.id
  emit('close')
  emit('cancel', id)
}
</script>

<template>
  <CatalogTrackActionsDialog
    :playlists="playlists"
    @add-to-playlist="(track, id) => emit('addToPlaylist', track, id)"
    :open="Boolean(entry)"
    :track="entry?.item.track"
    :favorite="favorite"
    :queued="queued"
    :invalid="invalid"
    :custom-tags="customTags"
    :suspended="suspended"
    scroll-primary-actions
    @close="emit('close')"
    @play="emit('play', $event)"
    @queue="emit('queue', $event)"
    @favorite="emit('favorite', $event)"
    @compose="emit('compose', $event)"
    @add-tag="(track, tag) => emit('addTag', track, tag)"
    @remove-tag="(track, tag) => emit('removeTag', track, tag)"
    @rename="(track, name) => emit('rename', track, name)"
  >
    <template #download-action>
      <TrackActionButton
        v-if="action"
        :icon="action.icon"
        :label="action.label"
        :aria-label="action.ariaLabel"
        :disabled="action.disabled || cancelling || (invalid && action.event === 'resume')"
        @click="controlTask"
      />
    </template>
    <template #primary-action>
      <TrackActionButton
        icon="trash"
        label="移除下载记录"
        danger
        :disabled="cancelling"
        @click="removeTask"
      />
    </template>
    <template #details>
      <p
        class="download-track-actions__status"
        :data-error="entry?.state === 'failed'"
        role="status"
      >
        {{ statusMessage }}
      </p>
    </template>
    <template #secondary-actions>
      <TrackActionButton
        v-if="
          entry &&
          !entry.saving &&
          (entry.state === 'downloading' || entry.item.status === 'paused')
        "
        icon="close"
        label="取消下载"
        inline
        :disabled="cancelling"
        @click="cancelTask"
      />
    </template>
  </CatalogTrackActionsDialog>
</template>

<style scoped>
.download-track-actions__status {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  overflow-wrap: anywhere;
}
.download-track-actions__status[data-error='true'] {
  color: var(--am-color-danger);
}
</style>
