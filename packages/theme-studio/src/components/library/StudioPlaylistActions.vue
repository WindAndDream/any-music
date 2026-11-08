<script setup lang="ts">
import type { MusicPlaylist } from '@any-music/core'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import DialogPages from '@any-music/ui/components/DialogPages.vue'
import ImagePreviewDialog from '@any-music/ui/components/ImagePreviewDialog.vue'
import RemoteImage from '@any-music/ui/components/music-sources/RemoteImage.vue'
import PlaylistCoverCropDialog from '@any-music/ui/components/PlaylistCoverCropDialog.vue'
import {
  PLAYLIST_COVER_ACCEPT,
  playlistNameError,
  playlistEditorErrorMessage,
  usePlaylistCoverUpload,
  usePlaylistEditorDraft,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, shallowRef } from 'vue'

import { useStudioActivity } from '../../composables/use-studio-activity'

type PlaylistFeature = UiThemeFeatureMap['playlists']
type PlaylistActionsFeature = Pick<PlaylistFeature, 'availability' | 'status'> & {
  state: Pick<
    PlaylistFeature['state'],
    | 'nameDraft'
    | 'coverUrls'
    | 'playlists'
    | 'playlistTagsAvailable'
    | 'customTagsByPlaylistId'
    | 'downloadBusy'
    | 'transferBusy'
  >
  actions: Pick<
    PlaylistFeature['actions'],
    | 'favoritePlaylist'
    | 'downloadPlaylist'
    | 'exportFile'
    | 'saveDetails'
    | 'setNameDraft'
    | 'addPlaylistTag'
    | 'removePlaylistTag'
  >
}
const props = defineProps<{ playlist: MusicPlaylist; feature: PlaylistActionsFeature }>()
const emit = defineEmits<{ close: []; remove: [id: string] }>()
const draft = usePlaylistEditorDraft()
const field = draft.field
const open = shallowRef(true)
const returning = shallowRef(false)
const lastField = shallowRef('name')
const busy = shallowRef(false)
const error = shallowRef('')
const previewOpen = shallowRef(false)
const cover = usePlaylistCoverUpload(
  () =>
    props.playlist.coverId ? props.feature.state.coverUrls[props.playlist.coverId] : undefined,
  draft.cover,
)
const nameError = computed(() =>
  playlistNameError(
    props.feature.state.nameDraft,
    props.feature.state.playlists,
    props.playlist.id,
  ),
)
const tags = computed(
  () => props.feature.state.customTagsByPlaylistId?.get(props.playlist.id) ?? [],
)
const activity = useStudioActivity(() => props.feature.availability)
function openField(value: NonNullable<typeof field.value>) {
  lastField.value = value
  returning.value = false
  field.value = value
}
function back() {
  returning.value = true
  field.value = null
}
function close() {
  cover.cancelCrop()
  open.value = false
}
async function perform(action: () => void | Promise<void>, after?: () => void) {
  if (!activity.available() || !open.value || busy.value) return
  const current = activity.checkpoint()
  busy.value = true
  error.value = ''
  try {
    await action()
    if (current() && open.value) after?.()
  } catch (cause) {
    if (current()) error.value = playlistEditorErrorMessage(cause)
  } finally {
    if (current()) busy.value = false
  }
}
function addTag() {
  if (!props.feature.state.playlistTagsAvailable || !draft.tag.value.trim()) return
  void perform(() => {
    props.feature.actions.addPlaylistTag(props.playlist.id, draft.tag.value)
    draft.tag.value = ''
  })
}
function save() {
  if (
    nameError.value ||
    !props.feature.state.nameDraft.trim() ||
    cover.busy.value ||
    cover.source.value
  )
    return
  void perform(
    () =>
      props.feature.actions.saveDetails(
        props.playlist.id,
        props.feature.state.nameDraft,
        draft.description.value,
        draft.cover.value,
      ),
    back,
  )
}
function selectCover(event: Event) {
  const input = event.target as HTMLInputElement
  void cover.select(input.files?.[0])
  input.value = ''
}
</script>

<template>
  <AppDialog
    appear
    :open="open"
    title="歌单操作"
    size="compact"
    :suspended="previewOpen || Boolean(cover.source.value)"
    :back-action="field ? back : close"
    @close="close"
    @after-leave="emit('close')"
  >
    <fieldset
      :disabled="busy || !open || feature.availability.status !== 'available'"
      class="studio-playlist-actions"
    >
      <div>
        <strong>{{ playlist.name }}</strong>
        <p>{{ playlist.trackIds.length }} 首歌曲</p>
      </div>
      <DialogPages
        :page="field ?? 'actions'"
        :returning="returning"
        :focus-selector="
          field
            ? field === 'tags'
              ? '[name=playlist-tag]'
              : 'input, textarea'
            : `[data-playlist-field=${lastField}]`
        "
      >
        <template v-if="!field">
          <div class="studio-actions" role="group" aria-label="歌单常用操作">
            <button
              type="button"
              :disabled="!playlist.trackIds.length"
              @click="perform(() => feature.actions.favoritePlaylist(playlist.id))"
            >
              喜欢
            </button>
            <button
              type="button"
              :disabled="!playlist.trackIds.length || feature.state.downloadBusy"
              @click="perform(() => feature.actions.downloadPlaylist(playlist.id))"
            >
              下载
            </button>
            <button
              type="button"
              :disabled="feature.state.transferBusy"
              @click="perform(() => feature.actions.exportFile(playlist.id))"
            >
              导出
            </button>
          </div>
          <button
            type="button"
            class="studio-playlist-actions__entry"
            data-playlist-field="name"
            @click="openField('name')"
          >
            歌单名称<AppIcon name="arrow-right" :size="17" />
          </button>
          <button
            type="button"
            class="studio-playlist-actions__entry"
            data-playlist-field="description"
            @click="openField('description')"
          >
            歌单简介<AppIcon name="arrow-right" :size="17" />
          </button>
          <button
            type="button"
            class="studio-playlist-actions__entry"
            data-playlist-field="cover"
            @click="openField('cover')"
          >
            歌单封面<AppIcon name="arrow-right" :size="17" />
          </button>
          <button
            v-if="feature.state.playlistTagsAvailable"
            type="button"
            class="studio-playlist-actions__entry"
            data-playlist-field="tags"
            @click="openField('tags')"
          >
            管理标签<AppIcon name="arrow-right" :size="17" />
          </button>
          <button type="button" @click="emit('remove', playlist.id)">删除歌单</button>
        </template>
        <template v-else>
          <button type="button" @click="back">
            <AppIcon name="arrow-left" :size="17" />返回歌单操作
          </button>
          <form v-if="field !== 'tags'" @submit.prevent="save">
            <label v-if="field === 'name'" class="studio-field"
              >歌单名称<input
                :value="feature.state.nameDraft"
                maxlength="80"
                required
                :aria-invalid="Boolean(nameError)"
                @input="feature.actions.setNameDraft(($event.target as HTMLInputElement).value)"
            /></label>
            <label v-else-if="field === 'description'" class="studio-field"
              >歌单简介<textarea v-model="draft.description.value" maxlength="500" rows="3" />
            </label>
            <div v-else class="studio-playlist-actions__tags">
              <button
                type="button"
                :disabled="!cover.preview.value"
                aria-label="预览歌单封面"
                @click="previewOpen = true"
              >
                <RemoteImage
                  v-if="cover.preview.value"
                  class="studio-playlist-actions__cover"
                  :src="cover.preview.value"
                  :alt="`${playlist.name}封面`"
                /><AppIcon v-else name="playlist" :size="32" />
              </button>
              <label class="studio-field"
                >上传歌单封面<input
                  type="file"
                  :accept="PLAYLIST_COVER_ACCEPT"
                  :disabled="cover.busy.value"
                  @change="selectCover"
              /></label>
              <p>JPG、PNG、WebP，最大 5 MB；保留原图比例。</p>
              <button
                v-if="cover.preview.value"
                type="button"
                :disabled="cover.busy.value"
                @click="cover.remove"
              >
                移除封面
              </button>
            </div>
            <p v-if="nameError" role="alert">{{ nameError }}</p>
            <p v-if="cover.error.value" role="alert">{{ cover.error.value }}</p>
            <button
              type="submit"
              :disabled="!feature.state.nameDraft.trim() || Boolean(nameError) || cover.busy.value"
            >
              保存
            </button>
          </form>
          <div v-else-if="field === 'tags'" class="studio-playlist-actions__tags">
            <p v-if="!tags.length">还没有标签，添加一个方便识别歌单主题。</p>
            <div class="studio-actions">
              <button
                v-for="tag in tags"
                :key="tag"
                type="button"
                :aria-label="`移除标签 ${tag}`"
                :disabled="!feature.state.playlistTagsAvailable"
                @click="
                  feature.state.playlistTagsAvailable &&
                  perform(() => feature.actions.removePlaylistTag(playlist.id, tag))
                "
              >
                {{ tag }}<AppIcon name="close" :size="14" />
              </button>
            </div>
            <form @submit.prevent="addTag">
              <label class="studio-field"
                >添加标签<input
                  v-model="draft.tag.value"
                  name="playlist-tag"
                  maxlength="32"
                  :disabled="!feature.state.playlistTagsAvailable" /></label
              ><button
                type="submit"
                :disabled="!draft.tag.value.trim() || !feature.state.playlistTagsAvailable"
              >
                添加标签
              </button>
            </form>
            <p v-if="!feature.state.playlistTagsAvailable" role="status">
              标签功能已停用，请启用后继续操作。
            </p>
          </div>
        </template>
      </DialogPages>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="button" @click="close">取消</button>
    </fieldset>
  </AppDialog>
  <PlaylistCoverCropDialog
    v-if="cover.source.value"
    :source="cover.source.value"
    :busy="cover.busy.value"
    :error="cover.error.value"
    :suspended="!open || feature.availability.status !== 'available'"
    @cancel="cover.cancelCrop"
    @confirm="cover.confirmCrop"
  />
  <ImagePreviewDialog
    :open="previewOpen"
    :src="cover.preview.value ?? ''"
    :title="`${playlist.name}封面预览`"
    @close="previewOpen = false"
  />
</template>

<style scoped>
.studio-playlist-actions,
.studio-playlist-actions__tags {
  display: grid;
  gap: var(--am-space-3);
}
.studio-playlist-actions {
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.studio-playlist-actions p {
  margin-block: var(--am-space-2);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.studio-playlist-actions__entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
}
.studio-playlist-actions__cover {
  inline-size: 104px;
  block-size: 104px;
  object-fit: cover;
  border-radius: var(--am-radius-artwork);
}
</style>
