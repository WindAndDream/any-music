<script setup lang="ts">
import { CoverPlaylistCard } from '@any-music/card-styles/vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import PlaylistValidationNotice from '@any-music/ui/components/PlaylistValidationNotice.vue'
import {
  playlistEditorErrorMessage,
  reorderVisiblePlaylists,
  usePlaylistEditorDraft,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef, useTemplateRef } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'
import StudioPageOverlays from '../overlays/StudioPageOverlays.vue'
import StudioFeatureStatus from '../StudioFeatureStatus.vue'
import StudioCollection from './StudioCollection.vue'
import StudioDisplayControls from './StudioDisplayControls.vue'
import StudioPlaylistActions from './StudioPlaylistActions.vue'
const props = defineProps<{ feature: UiThemeFeatureMap['playlists'] }>()
const state = computed(() => props.feature.state)
const active = computed(() =>
  state.value.playlists.find((item) => item.id === state.value.activePlaylistId),
)
const visible = computed(() =>
  state.value.playlists.filter((item) =>
    item.name
      .normalize('NFKC')
      .toLocaleLowerCase()
      .includes(state.value.query.normalize('NFKC').trim().toLocaleLowerCase()),
  ),
)
const { confirmAction } = useStudioActivity(() => props.feature.availability)
const editor = usePlaylistEditorDraft()
const editorPlaylist = computed(() =>
  state.value.playlists.find(({ id }) => id === editor.id.value),
)
function edit(id: string) {
  const playlist = state.value.playlists.find((item) => item.id === id)
  if (!playlist) return
  props.feature.actions.setNameDraft(playlist.name)
  editor.description.value = playlist.description ?? ''
  editor.cover.value = undefined
  editor.field.value = null
  editor.tag.value = ''
  editor.id.value = id
}
const createError = shallowRef('')
const transferMessage = shallowRef('')
const importInput = useTemplateRef<HTMLInputElement>('importInput')
function shiftPlaylist(id: string, direction: -1 | 1) {
  const ids = visible.value.map((item) => item.id)
  const index = ids.indexOf(id),
    target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return
  props.feature.actions.reorderPlaylists(
    reorderVisiblePlaylists(
      state.value.playlists.map((item) => item.id),
      id,
      ids[target]!,
      ids,
    ),
  )
}
async function importPlaylist(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || state.value.transferBusy) return
  transferMessage.value = ''
  try {
    await props.feature.actions.importFile(file)
    transferMessage.value = '歌单已导入。'
  } catch (cause) {
    transferMessage.value = playlistEditorErrorMessage(cause)
  }
}
async function exportPlaylist() {
  if (!active.value || state.value.transferBusy) return
  transferMessage.value = ''
  try {
    await props.feature.actions.exportFile(active.value.id)
    transferMessage.value = '歌单文件已导出。'
  } catch (cause) {
    transferMessage.value = playlistEditorErrorMessage(cause)
  }
}
async function create() {
  if (!state.value.nameDraft.trim()) return
  createError.value = ''
  try {
    await props.feature.actions.create(state.value.nameDraft.trim())
  } catch (cause) {
    createError.value = playlistEditorErrorMessage(cause)
  }
}
function remove(id = active.value?.id) {
  const playlist = state.value.playlists.find((item) => item.id === id)
  if (playlist)
    void confirmAction(
      '删除歌单',
      `确定删除歌单“${playlist.name}”吗？歌曲和喜欢会保留。`,
      async () => {
        await props.feature.actions.remove(playlist.id)
        if (editor.id.value === playlist.id) editor.id.value = null
      },
      () => active.value?.id === playlist.id || editor.id.value === playlist.id,
    )
}
</script>
<template>
  <section class="studio-library" aria-label="我的歌单">
    <h1>我的歌单</h1>
    <StudioFeatureStatus :availability="feature.availability" :status="feature.status" />
    <fieldset :disabled="feature.availability.status !== 'available'">
      <div class="studio-split">
        <aside>
          <div class="studio-actions">
            <StudioDisplayControls subject="歌单" :state="state" :actions="feature.actions" />
          </div>
          <label class="studio-field"
            >搜索歌单名称<input
              type="search"
              :value="state.query"
              @input="feature.actions.setQuery(($event.target as HTMLInputElement).value)"
          /></label>
          <form @submit.prevent="create">
            <label
              >新歌单名称<input
                :value="state.nameDraft"
                maxlength="80"
                @input="
                  feature.actions.setNameDraft(($event.target as HTMLInputElement).value)
                " /></label
            ><button type="submit" :disabled="!state.nameDraft.trim()">创建歌单</button>
          </form>
          <button type="button" :disabled="state.transferBusy" @click="importInput?.click()">
            导入歌单
          </button>
          <input
            ref="importInput"
            hidden
            type="file"
            accept=".json,application/json"
            aria-label="选择歌单 JSON 文件"
            @change="importPlaylist"
          />
          <p v-if="transferMessage" role="status">{{ transferMessage }}</p>
          <p v-if="createError" role="alert">{{ createError }}</p>
          <p v-if="!visible.length">没有匹配的歌单。</p>
          <TrackCardGrid :display-mode="state.displayMode" :mobile-columns="state.mobileColumns">
            <div
              v-for="(playlist, index) in visible"
              :key="playlist.id"
              class="studio-playlist-card"
            >
              <CoverPlaylistCard
                :id="playlist.id"
                :name="playlist.name"
                :tags="state.customTagsByPlaylistId?.get(playlist.id)"
                :count="playlist.trackIds.length"
                :cover-url="playlist.coverId ? state.coverUrls[playlist.coverId] : undefined"
                :index="index"
                @open="feature.actions.open(playlist.id)"
                @actions="edit(playlist.id)"
                @shift="shiftPlaylist(playlist.id, $event)"
              />
            </div>
          </TrackCardGrid>
        </aside>
        <div v-if="active">
          <PlaylistValidationNotice
            :validation="state.validation"
            @retry="feature.actions.retryValidation?.()"
          />
          <button type="button" @click="feature.actions.open(null)">返回我的歌单</button>
          <div role="group" aria-label="歌单常用操作">
            <button
              type="button"
              :disabled="!active.trackIds.length"
              @click="feature.actions.favoritePlaylist(active.id)"
            >
              喜欢
            </button>
            <button
              type="button"
              :disabled="!active.trackIds.length || state.downloadBusy"
              @click="feature.actions.downloadPlaylist(active.id)"
            >
              下载
            </button>
            <button type="button" :disabled="state.transferBusy" @click="exportPlaylist">
              导出 JSON 文件
            </button>
          </div>
          <form
            @submit.prevent="
              state.nameDraft.trim() &&
              feature.actions.renamePlaylist(active.id, state.nameDraft.trim())
            "
          >
            <label
              >歌单名称<input
                :value="state.nameDraft"
                maxlength="80"
                @input="
                  feature.actions.setNameDraft(($event.target as HTMLInputElement).value)
                " /></label
            ><button type="submit" :disabled="!state.nameDraft.trim()">重命名歌单</button
            ><button type="button" @click="remove()">删除歌单</button>
          </form>
          <StudioCollection
            :key="active.id"
            :title="active.name"
            :scope="`playlist:${active.id}`"
            :state="state"
            :actions="feature.actions"
            :availability="feature.availability"
            :status="feature.status"
            :remove="(ids) => feature.actions.removeTracks(active!.id, ids)"
            :reorder="(ids) => feature.actions.reorderTracks(active!.id, ids)"
          />
        </div>
        <p v-else>选择一个歌单开始整理音乐。</p>
      </div>
    </fieldset>
    <StudioPageOverlays :open="Boolean(editorPlaylist)">
      <StudioPlaylistActions
        v-if="editorPlaylist"
        :key="editorPlaylist.id"
        :playlist="editorPlaylist"
        :feature="feature"
        @close="editor.id.value = null"
        @remove="remove"
      />
    </StudioPageOverlays>
  </section>
</template>

<style scoped>
.studio-playlist-card {
  min-inline-size: 0;
  padding: var(--am-space-2);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
}
</style>
