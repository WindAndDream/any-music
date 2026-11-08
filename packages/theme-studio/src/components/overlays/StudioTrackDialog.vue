<script setup lang="ts">
import {
  provideEditingSession,
  useEditingSession,
  createTrackActionEditingState,
  trackActionEditingKey,
  useUiContributionAvailability,
} from '@any-music/ui/catalog'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import TrackNameEditor from '@any-music/ui/components/tracks/TrackNameEditor.vue'
import type {
  UiThemeAvailability,
  UiThemeTrackListActions,
  UiThemeTrackListState,
} from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'
import type { DeepReadonly } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
import StudioPlaylistPicker from '../library/StudioPlaylistPicker.vue'
const props = defineProps<{
  trackId: string
  state: DeepReadonly<
    Pick<UiThemeTrackListState, 'tracks' | 'customNamesByTrackId' | 'customTagsByTrackId'> &
      Partial<
        Pick<
          UiThemeTrackListState,
          'invalidTrackIds' | 'favoriteTrackIds' | 'queuedTrackIds' | 'downloadBusy' | 'playlists'
        >
      >
  >
  actions: Pick<UiThemeTrackListActions, 'rename' | 'addTag' | 'removeTag' | 'useAsMaterial'> &
    Partial<
      Pick<
        UiThemeTrackListActions,
        'play' | 'download' | 'toggleFavorite' | 'enqueue' | 'addToPlaylist'
      >
    >
  availability: UiThemeAvailability
  queueAction?: 'add' | 'toggle'
}>()
const pickerModalTarget = shallowRef<HTMLElement | null>(null)
const emit = defineEmits<{ close: []; queue: [id: string] }>()
defineSlots<{ details?: () => unknown }>()
const invalid = computed(() => props.state.invalidTrackIds?.includes(props.trackId) ?? false)
const favorite = computed(() => props.state.favoriteTrackIds?.includes(props.trackId) ?? false)
const queued = computed(() => props.state.queuedTrackIds?.includes(props.trackId) ?? false)
const editing = useEditingSession(`track-actions:${props.trackId}`)
provideEditingSession(editing)
const track = computed(() => props.state.tracks.find((item) => item.id === props.trackId))
const { tagDraft: tag, activeView } = editing.state(
  trackActionEditingKey,
  createTrackActionEditingState,
)
const playlistModalOpen = shallowRef(false)
function addToPlaylists(ids: readonly string[]) {
  if (activeView.value !== 'playlists' || !available() || invalid.value || !track.value) return
  for (const id of new Set(ids)) {
    if (props.state.playlists?.some((playlist) => playlist.id === id))
      props.actions.addToPlaylist?.(id, [props.trackId])
  }
  returnToActions()
}
function returnToActions() {
  editing.clearScope('playlist-picker')
  editing.clearScope('studio-playlist-picker-panel')
  activeView.value = 'actions'
}
function close() {
  returnToActions()
  emit('close')
}
const contributions = useUiContributionAvailability('track.actions.secondary', () => ({
  hasTrack: !!track.value,
  selectionCount: 1,
}))
const { available } = useStudioActivity(() => props.availability)
</script>
<template>
  <AppDialog
    :open="true"
    title="歌曲操作"
    :suspended="playlistModalOpen"
    :back-action="activeView === 'playlists' ? returnToActions : close"
    @close="close"
    ><p v-if="!track">歌曲已不在当前列表。</p>
    <StudioPlaylistPicker
      :overlay-target="pickerModalTarget"
      v-else-if="activeView === 'playlists'"
      :open="true"
      :playlists="state.playlists ?? []"
      :selected-count="1"
      :suspended="!available()"
      @select="addToPlaylists"
      @back="returnToActions"
      @modal-open-change="playlistModalOpen = $event" />
    <fieldset v-else :disabled="availability.status !== 'available'">
      <h2>{{ track.title }}</h2>
      <div class="studio-actions">
        <button
          v-if="actions.play"
          type="button"
          :disabled="invalid"
          @click="available() && actions.play?.(trackId)"
        >
          播放
        </button>
        <button
          v-if="actions.enqueue"
          type="button"
          :disabled="(invalid && !queued) || (queueAction !== 'toggle' && queued)"
          @click="available() && emit('queue', trackId)"
        >
          {{ queued ? (queueAction === 'toggle' ? '移出待听' : '已在待听') : '加入待听' }}
        </button>
        <button
          v-if="actions.toggleFavorite"
          type="button"
          :disabled="invalid && !favorite"
          @click="available() && actions.toggleFavorite?.(trackId)"
        >
          {{ favorite ? '取消喜欢' : '喜欢' }}
        </button>
        <button
          v-if="actions.download"
          type="button"
          :disabled="invalid || state.downloadBusy"
          @click="available() && actions.download?.([trackId])"
        >
          下载
        </button>
      </div>
      <slot name="details" />
      <TrackNameEditor
        :original-name="track.title"
        :custom-name="state.customNamesByTrackId.get(trackId)"
        @back="emit('close')"
        @save="available() && actions.rename(trackId, $event)"
      />
      <button type="button" :disabled="invalid" @click="available() && (activeView = 'playlists')">
        <AppIcon name="playlist" :size="20" />添加歌单
      </button>
      <form
        v-if="contributions.allows('manage-tags')"
        @submit.prevent="
          available() &&
          contributions.allows('manage-tags') &&
          tag.trim() &&
          actions.addTag([trackId], tag.trim())
        "
      >
        <label>添加标签<input v-model="tag" maxlength="32" /></label
        ><button type="submit" :disabled="!tag.trim()">添加标签</button>
      </form>
      <ul v-if="contributions.allows('manage-tags')">
        <li v-for="name in state.customTagsByTrackId.get(trackId) ?? []" :key="name">
          {{ name }}
          <button
            type="button"
            @click="
              available() && contributions.allows('manage-tags') && actions.removeTag(trackId, name)
            "
          >
            移除标签
          </button>
        </li>
      </ul>
      <button
        v-if="contributions.allows('compose')"
        type="button"
        @click="available() && contributions.allows('compose') && actions.useAsMaterial([trackId])"
      >
        加入创作素材
      </button>
    </fieldset>
    <template #overlays><div ref="pickerModalTarget" /></template
  ></AppDialog>
</template>
