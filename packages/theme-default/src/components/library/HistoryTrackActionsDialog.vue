<script setup lang="ts">
import type { PlaybackHistoryEntry, Track } from '@any-music/core'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

import { usePresentationActivity } from '../../composables/use-presentation-activity'
import CatalogTrackActionsDialog from '../music-sources/CatalogTrackActionsDialog.vue'
import TrackActionButton from '../music-sources/TrackActionButton.vue'
import { formatHistoryRecord } from './history-record-presentation'

const props = defineProps<{
  row?: { entry: PlaybackHistoryEntry; track: Track }
  feature: UiThemeFeatureMap['history']
}>()
const emit = defineEmits<{ close: []; play: [trackId: string]; clear: [] }>()
const activity = usePresentationActivity()
const isCurrent = activity.checkpoint()
function available() {
  return isCurrent() && props.feature.availability.status === 'available' && Boolean(props.row)
}
function clear() {
  if (!available()) return
  emit('close')
  emit('clear')
}
</script>

<template>
  <CatalogTrackActionsDialog
    :playlists="feature.state.playlists"
    @add-to-playlist="(track, id) => available() && feature.actions.addToPlaylist(id, [track.id])"
    :open="Boolean(row)"
    :track="row?.track"
    :editing-scope="`history:track-actions:${row?.entry.id ?? ''}`"
    :suspended="feature.availability.status !== 'available'"
    :favorite="Boolean(row && feature.state.favoriteTrackIds.includes(row.track.id))"
    :queued="Boolean(row && feature.state.queuedTrackIds.includes(row.track.id))"
    :invalid="Boolean(row && feature.state.invalidTrackIds.includes(row.track.id))"
    :custom-tags="row ? (feature.state.customTagsByTrackId.get(row.track.id) ?? []) : []"
    :download-busy="Boolean(feature.state.downloadBusy)"
    scroll-primary-actions
    @close="emit('close')"
    @play="available() && emit('play', $event.id)"
    @queue="available() && feature.actions.toggleQueue($event.id)"
    @favorite="available() && feature.actions.toggleFavorite($event.id)"
    @download="available() && feature.actions.download([$event.id])"
    @rename="(track, name) => available() && feature.actions.rename(track.id, name)"
    @add-tag="(track, tag) => available() && feature.actions.addTag([track.id], tag)"
    @remove-tag="(track, tag) => available() && feature.actions.removeTag(track.id, tag)"
    @compose="available() && feature.actions.useAsMaterial([$event.id])"
  >
    <template #details
      ><p v-if="row" class="history-track-actions__record">
        {{ formatHistoryRecord(row.entry) }}
      </p></template
    >
    <template #primary-action
      ><TrackActionButton
        icon="trash"
        label="清空历史"
        danger
        :disabled="feature.availability.status !== 'available' || !feature.state.entries.length"
        @click="clear"
    /></template>
  </CatalogTrackActionsDialog>
</template>

<style scoped>
.history-track-actions__record {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
</style>
