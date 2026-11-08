<script setup lang="ts">
import {
  useEditingSession,
  provideEditingSession,
  useUiContributionAvailability,
} from '@any-music/ui/catalog'
import ContributionActions from '@any-music/ui/components/plugins/ContributionActions.vue'
import { usePlaylistPickerOpen } from '@any-music/ui/library'
import type { UiThemeTrackListState, UiThemeTrackListActions } from '@any-music/ui/theme'
import type { UiThemeAvailability } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'
import type { DeepReadonly } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
import { useStudioOverlays } from '../../composables/use-studio-overlays'
import StudioPlaylistPickerDialog from './StudioPlaylistPickerDialog.vue'

const props = defineProps<{
  state: DeepReadonly<UiThemeTrackListState>
  actions: UiThemeTrackListActions
  scope: string
  availability: UiThemeAvailability
}>()
const editing = useEditingSession(props.scope.startsWith('catalog:') ? undefined : props.scope)
provideEditingSession(editing)
const playlistOpen = usePlaylistPickerOpen(editing)
const valid = computed(() =>
  props.state.selectedTrackIds.filter(
    (id) =>
      props.state.tracks.some((track) => track.id === id) &&
      !props.state.invalidTrackIds.includes(id),
  ),
)
const selectedTracks = computed(() =>
  valid.value.flatMap((id) => props.state.tracks.find((track) => track.id === id) ?? []),
)
const tagDialogOpen = shallowRef(false)
const overlays = useStudioOverlays(() => tagDialogOpen.value || playlistOpen.value)
const creation = useUiContributionAvailability('track.actions.secondary', () => ({
  selectionCount: valid.value.length,
  hasTrack: valid.value.length > 0,
}))
const { available, confirmAction } = useStudioActivity(() => props.availability)
function confirmBatch(kind: 'queue' | 'download' | 'favorites') {
  const ids = [...valid.value],
    scope = props.scope
  if (!ids.length || (kind === 'download' && props.state.downloadBusy)) return
  const key = JSON.stringify(ids)
  const title =
    kind === 'queue' ? '添加到待听' : kind === 'download' ? '下载已选歌曲' : '添加到我的喜欢'
  void confirmAction(
    title,
    `确定对已选的 ${ids.length} 首歌曲执行此操作吗？`,
    () => {
      if (kind === 'queue') {
        props.actions.enqueue(ids)
      } else if (kind === 'download') {
        if (!props.state.downloadBusy) return props.actions.download(ids)
      } else
        for (const id of ids)
          if (!props.state.favoriteTrackIds.includes(id)) void props.actions.toggleFavorite(id)
    },
    () => props.scope === scope && JSON.stringify(valid.value) === key,
    'default',
  )
}
function addToPlaylists(ids: readonly string[]) {
  if (!playlistOpen.value || !available() || !valid.value.length) return
  for (const id of new Set(ids)) {
    if (props.state.playlists?.some((playlist) => playlist.id === id))
      props.actions.addToPlaylist(id, valid.value)
  }
  playlistOpen.value = false
}
</script>
<template>
  <div class="studio-batch studio-actions" role="group" aria-label="歌曲批量操作">
    <button type="button" :disabled="!valid.length" @click="confirmBatch('queue')">添加待听</button>
    <button
      type="button"
      :disabled="!valid.length || state.downloadBusy"
      @click="confirmBatch('download')"
    >
      下载已选
    </button>
    <button type="button" :disabled="!valid.length" @click="confirmBatch('favorites')">
      添加喜欢
    </button>
    <button
      v-if="creation.allows('compose')"
      type="button"
      :disabled="!valid.length"
      @click="available() && creation.allows('compose') && actions.useAsMaterial(valid)"
    >
      加入创作素材
    </button>
    <button type="button" :disabled="!valid.length" @click="playlistOpen = true">加入歌单</button>
    <StudioPlaylistPickerDialog
      :open="playlistOpen"
      :playlists="state.playlists ?? []"
      :selected-count="valid.length"
      :suspended="!available()"
      :overlay-target="overlays?.target.value"
      @close="playlistOpen = false"
      @select="addToPlaylists"
    />
    <ContributionActions
      point="trackList.operator.actions"
      :context="{ selectionCount: valid.length, selectedTracks }"
      :disabled="!valid.length || availability.status !== 'available'"
      :overlay-target="overlays?.target.value"
      @dialog-open-change="tagDialogOpen = $event"
    />
  </div>
</template>
