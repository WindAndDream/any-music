<script setup lang="ts">
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import { provideTrackNames } from '@any-music/ui/library'
import type {
  UiThemeAvailability,
  UiThemeTrackListActions,
  UiThemeTrackListState,
} from '@any-music/ui/theme'
import { computed } from 'vue'
import type { DeepReadonly } from 'vue'

import { usePresentationActivity } from '../../composables/use-presentation-activity'
import CatalogTrackActionsDialog from '../music-sources/CatalogTrackActionsDialog.vue'

/** Bind ordinary collection song actions; task scheduling remains with download controls. */
const props = defineProps<{
  open: boolean
  trackId: string
  state: DeepReadonly<Omit<UiThemeTrackListState, 'selectedTrackIds'>>
  actions: Readonly<
    Omit<UiThemeTrackListActions, 'select' | 'download'> &
      Partial<Pick<UiThemeTrackListActions, 'download'>>
  >
  availability: UiThemeAvailability
}>()
const emit = defineEmits<{ close: []; queue: [trackId: string]; afterLeave: [trackId: string] }>()
const track = computed(() => props.state.tracks.find(({ id }) => id === props.trackId))
provideTrackNames(computed(() => props.state.customNamesByTrackId))
const activity = usePresentationActivity()
const isCurrent = activity.checkpoint()
function available() {
  return isCurrent() && props.availability.status === 'available' && Boolean(track.value)
}
</script>

<template>
  <AppDialog
    v-if="!track"
    :open="open"
    appear
    title="歌曲操作"
    @close="emit('close')"
    @after-leave="emit('afterLeave', props.trackId)"
  >
    <p>歌曲已不在当前列表。</p>
  </AppDialog>
  <CatalogTrackActionsDialog
    :playlists="state.playlists"
    @add-to-playlist="(track, id) => available() && actions.addToPlaylist(id, [track.id])"
    v-else
    :open="open"
    appear
    :track="track"
    :editing-scope="`track-actions:${trackId}`"
    :suspended="availability.status !== 'available'"
    :favorite="state.favoriteTrackIds.includes(trackId)"
    :queued="state.queuedTrackIds.includes(trackId)"
    :invalid="state.invalidTrackIds.includes(trackId)"
    :custom-tags="state.customTagsByTrackId.get(trackId) ?? []"
    :download-busy="Boolean(state.downloadBusy)"
    @close="isCurrent() && emit('close')"
    @after-leave="emit('afterLeave', props.trackId)"
    @play="
      available() &&
      actions.play(
        trackId,
        state.tracks.map(({ id }) => id),
      )
    "
    @queue="available() && emit('queue', trackId)"
    @favorite="available() && actions.toggleFavorite(trackId)"
    @download="available() && actions.download?.([trackId])"
    @rename="(_track, name) => available() && actions.rename(trackId, name)"
    @add-tag="(_track, tag) => available() && actions.addTag([trackId], tag)"
    @remove-tag="(_track, tag) => available() && actions.removeTag(trackId, tag)"
    @compose="available() && actions.useAsMaterial([trackId])"
  >
    <template v-if="!actions.download" #download-action></template>
  </CatalogTrackActionsDialog>
</template>
