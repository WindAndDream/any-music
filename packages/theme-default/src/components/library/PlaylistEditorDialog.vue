<script setup lang="ts">
import type { MusicPlaylist } from '@any-music/core'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import DialogPages from '@any-music/ui/components/DialogPages.vue'
import ImagePreviewDialog from '@any-music/ui/components/ImagePreviewDialog.vue'
import RemoteImage from '@any-music/ui/components/music-sources/RemoteImage.vue'
import PlaylistCoverCropDialog from '@any-music/ui/components/PlaylistCoverCropDialog.vue'
import {
  usePlaylistCoverUpload,
  usePlaylistEditorDraft,
  playlistNameError,
  playlistEditorErrorMessage,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'

import { usePresentationActivity } from '../../composables/use-presentation-activity'
import TrackActionButton from '../music-sources/TrackActionButton.vue'
import TrackTagList from '../music-sources/TrackTagList.vue'
import PlaylistCoverField from './PlaylistCoverField.vue'

const props = defineProps<{ feature: UiThemeFeatureMap['playlists']; playlist?: MusicPlaylist }>()
const emit = defineEmits<{ close: []; remove: [id: string] }>()
const name = computed({
  get: () => props.feature.state.nameDraft,
  set: (value: string) => props.feature.actions.setNameDraft(value),
})
const editorDraft = usePlaylistEditorDraft()
const description = editorDraft.description
const cover = usePlaylistCoverUpload(
  () =>
    props.playlist?.coverId ? props.feature.state.coverUrls[props.playlist.coverId] : undefined,
  editorDraft.cover,
)
const busy = shallowRef(false)
const actionBusy = shallowRef(false)
const previewOpen = shallowRef(false)
const tagDetailsOpen = shallowRef(false)
const exportOpen = shallowRef(false)
const exportError = shallowRef('')
const message = shallowRef('')
const field = editorDraft.field
const tagDraft = editorDraft.tag
const open = shallowRef(true)
const returning = shallowRef(false)
const lastField = shallowRef('name')
const tags = computed(
  () => props.feature.state.customTagsByPlaylistId?.get(props.playlist?.id ?? '') ?? [],
)
const tagInput = useTemplateRef<HTMLInputElement>('tagInput')
const tagInputId = useId()
const entries = computed(() => [
  {
    id: 'name' as const,
    icon: 'edit' as const,
    title: '歌单名称',
    detail: '修改歌单名称，保留歌曲和排列顺序',
  },
  {
    id: 'description' as const,
    icon: 'info' as const,
    title: '歌单简介',
    detail: '记录歌单的心情、主题或故事',
  },
  {
    id: 'cover' as const,
    icon: 'image' as const,
    title: '歌单封面',
    detail: cover.preview.value ? '更换或移除封面' : '上传封面',
  },
  ...(props.feature.state.playlistTagsAvailable
    ? [
        {
          id: 'tags' as const,
          icon: 'tags' as const,
          title: '管理标签',
          detail: '查看、添加和移除这个歌单的标签',
        },
      ]
    : []),
])
const focusSelector = computed(() =>
  field.value
    ? field.value === 'description'
      ? '.playlist-editor__back'
      : field.value === 'tags'
        ? '[name=playlist-tag]'
        : 'input[type="text"], textarea'
    : `[data-playlist-field=${lastField.value}]`,
)
function openField(value: NonNullable<typeof field.value>) {
  lastField.value = value
  returning.value = false
  field.value = value
}
function back() {
  // Returning from artwork editing cancels the draft and any late image preparation.
  if (field.value === 'cover') cover.reset()
  returning.value = true
  field.value = null
}
function close() {
  cover.cancelCrop()
  open.value = false
}
function changeTag(tag: string, remove = false) {
  const value = tag.trim()
  if (
    !value ||
    !props.playlist ||
    !open.value ||
    busy.value ||
    actionBusy.value ||
    props.feature.availability.status !== 'available' ||
    !props.feature.state.playlistTagsAvailable
  )
    return
  error.value = ''
  try {
    if (remove) props.feature.actions.removePlaylistTag(props.playlist.id, value)
    else {
      props.feature.actions.addPlaylistTag(props.playlist.id, value)
      tagDraft.value = ''
      void nextTick(() => tagInput.value?.focus({ preventScroll: true }))
    }
  } catch (cause) {
    error.value = playlistEditorErrorMessage(cause)
  }
}
function openExport() {
  exportError.value = ''
  exportOpen.value = true
}
const favoriteIds = computed(() => new Set(props.feature.state.favoriteTrackIds))
const allFavorite = computed(
  () =>
    Boolean(props.playlist?.trackIds.length) &&
    props.playlist!.trackIds.every((id) => favoriteIds.value.has(id)),
)
const primaryActions = computed(() => [
  {
    id: 'favoritePlaylist' as const,
    icon: 'heart' as const,
    title: allFavorite.value ? '已全部喜欢' : '全部喜欢',
    label: allFavorite.value ? '已喜欢' : '喜欢',
    disabled: !props.playlist?.trackIds.length || allFavorite.value,
  },
  {
    id: 'downloadPlaylist' as const,
    icon: 'download' as const,
    title: '下载歌单',
    label: '下载',
    disabled: !props.playlist?.trackIds.length || props.feature.state.downloadBusy,
  },
  {
    id: 'export' as const,
    icon: 'arrow-up' as const,
    title: '导出歌单',
    label: '导出',
    disabled: props.feature.state.transferBusy,
  },
])
async function perform(action: 'favoritePlaylist' | 'downloadPlaylist') {
  if (
    !props.playlist ||
    busy.value ||
    actionBusy.value ||
    props.feature.availability.status !== 'available'
  )
    return
  const current = activity.checkpoint()
  actionBusy.value = true
  error.value = ''
  try {
    await props.feature.actions[action](props.playlist.id)
  } catch (cause) {
    if (current()) error.value = playlistEditorErrorMessage(cause)
  } finally {
    if (current()) actionBusy.value = false
  }
}
async function exportFile() {
  if (
    !props.playlist ||
    props.feature.state.transferBusy ||
    props.feature.availability.status !== 'available'
  )
    return
  const current = activity.checkpoint()
  exportError.value = ''
  try {
    await props.feature.actions.exportFile(props.playlist.id)
    if (current()) {
      exportOpen.value = false
      message.value = '歌单文件已导出。'
    }
  } catch (cause) {
    if (current()) exportError.value = playlistEditorErrorMessage(cause)
  }
}
watch(cover.preview, (url) => {
  if (!url) previewOpen.value = false
})
watch(tags, (value) => {
  if (!value.length) tagDetailsOpen.value = false
})
const error = shallowRef('')
const errorId = useId()
const activity = usePresentationActivity()
const nameError = computed(() =>
  // A successful write publishes the new name before the dialog finishes closing.
  busy.value || !open.value
    ? ''
    : playlistNameError(name.value, props.feature.state.playlists, props.playlist?.id),
)
const hasChanges = computed(
  () =>
    !props.playlist ||
    name.value.trim() !== props.playlist.name ||
    description.value !== (props.playlist.description ?? '') ||
    (cover.cover.value !== undefined &&
      (cover.cover.value !== null || Boolean(props.playlist.coverId))),
)
const canSave = computed(
  () =>
    open.value &&
    (!props.playlist || (field.value !== null && field.value !== 'tags')) &&
    !busy.value &&
    !actionBusy.value &&
    !cover.busy.value &&
    !cover.source.value &&
    !nameError.value &&
    Boolean(name.value.trim()) &&
    hasChanges.value &&
    props.feature.availability.status === 'available',
)
function selectCover(event: Event) {
  const input = event.target as HTMLInputElement
  void cover.select(input.files?.[0])
  input.value = ''
}
async function submit() {
  if (!canSave.value) return
  const current = activity.checkpoint()
  busy.value = true
  error.value = ''
  try {
    if (props.playlist)
      await props.feature.actions.saveDetails(
        props.playlist.id,
        name.value.trim(),
        description.value,
        cover.cover.value,
      )
    else
      await props.feature.actions.create(
        name.value.trim(),
        description.value,
        cover.cover.value ?? undefined,
      )
    if (current()) close()
  } catch (cause) {
    if (current()) error.value = playlistEditorErrorMessage(cause)
  } finally {
    if (current()) busy.value = false
  }
}
</script>

<template>
  <AppDialog
    class="playlist-editor-dialog"
    appear
    :open="open"
    :title="playlist?.name ?? '创建歌单'"
    size="compact"
    :initial-focus-selector="playlist ? undefined : 'input[type=text]'"
    :suspended="previewOpen || exportOpen || tagDetailsOpen || Boolean(cover.source.value)"
    :back-action="playlist && field ? back : close"
    @close="close"
    @after-leave="emit('close')"
  >
    <form
      class="playlist-editor"
      @submit.prevent="field === 'tags' ? changeTag(tagDraft) : submit()"
    >
      <fieldset
        :disabled="!open || busy || actionBusy || feature.availability.status !== 'available'"
      >
        <div v-if="playlist" class="playlist-editor__summary-card">
          <button
            class="playlist-editor__preview"
            type="button"
            aria-label="预览歌单封面"
            :disabled="!cover.preview.value"
            @click="previewOpen = true"
          >
            <RemoteImage
              v-if="cover.preview.value"
              :src="cover.preview.value"
              :alt="`${playlist.name}封面`"
              loading="eager"
            />
            <AppIcon v-else name="playlist" :size="32" />
          </button>
          <div class="playlist-editor__metadata">
            <p>{{ playlist.trackIds.length }} 首歌曲</p>
            <p title="根据本地保留的播放记录，统计歌单内歌曲的听歌次数">
              听歌次数
              {{
                (feature.state.playCountByPlaylistId?.get(playlist.id) ?? 0).toLocaleString('zh-CN')
              }}
              次
            </p>
            <p>创建于 {{ new Date(playlist.createdAtMs).toLocaleDateString('zh-CN') }}</p>
          </div>
        </div>
        <button
          v-if="playlist && tags.length"
          class="playlist-editor__tag-details"
          type="button"
          aria-label="查看全部歌单标签"
          aria-haspopup="dialog"
          :aria-expanded="tagDetailsOpen"
          @click="tagDetailsOpen = true"
        >
          <TrackTagList :tags="tags" label="歌单标签" single-line />
        </button>
        <DialogPages
          :page="playlist ? (field ?? 'actions') : 'create'"
          :returning="returning"
          :focus-selector="focusSelector"
        >
          <template v-if="playlist && !field">
            <div class="playlist-editor__primary-actions" role="group" aria-label="歌单常用操作">
              <TrackActionButton
                v-for="action in primaryActions"
                :key="action.id"
                :icon="action.icon"
                :label="action.label"
                :aria-label="action.title"
                :pressed="action.id === 'favoritePlaylist' ? allFavorite : undefined"
                :disabled="action.disabled"
                @click="action.id === 'export' ? openExport() : perform(action.id)"
              />
            </div>
            <div class="playlist-editor__items">
              <button
                v-for="entry in entries"
                :key="entry.id"
                class="track-action-option playlist-editor__item-trigger"
                type="button"
                :data-playlist-field="entry.id"
                @click="openField(entry.id)"
              >
                <AppIcon :name="entry.icon" :size="20" />
                <span class="playlist-editor__item-copy"
                  ><strong>{{ entry.title }}</strong
                  ><small>{{ entry.detail }}</small></span
                >
                <AppIcon class="playlist-editor__chevron" name="arrow-right" :size="17" />
              </button>
            </div>
          </template>
          <label v-if="!playlist || field === 'name'" class="playlist-editor__field"
            >歌单名称 <span class="playlist-editor__required">必填</span>
            <span class="playlist-editor__name-control">
              <input
                v-model="name"
                type="text"
                maxlength="80"
                required
                placeholder="给歌单起个名字"
                :aria-invalid="Boolean(nameError)"
                :aria-describedby="nameError ? errorId : undefined"
              />
            </span>
          </label>
          <label v-if="!playlist || field === 'description'" class="playlist-editor__field"
            >歌单简介 <small>选填</small>
            <textarea
              v-model="description"
              maxlength="500"
              rows="3"
              placeholder="记录歌单的心情、主题或故事"
            />
            <span class="playlist-editor__counter">{{ description.length }} / 500</span>
          </label>
          <PlaylistCoverField
            v-if="!playlist || field === 'cover'"
            :preview-url="cover.preview.value"
            :busy="cover.busy.value"
            :show-preview="!playlist"
            @preview="previewOpen = true"
            @select="selectCover"
            @remove="cover.remove"
          />
          <template v-if="playlist && field === 'tags'">
            <div class="playlist-editor__tags">
              <strong>已有标签</strong>
              <p v-if="!tags.length">还没有标签，添加一个方便识别歌单主题。</p>
              <div v-else class="playlist-editor__tag-list">
                <button
                  v-for="tag in tags"
                  :key="tag"
                  type="button"
                  :aria-label="`移除标签 ${tag}`"
                  :disabled="!feature.state.playlistTagsAvailable"
                  @click="changeTag(tag, true)"
                >
                  #{{ tag }}<AppIcon name="close" :size="14" />
                </button>
              </div>
            </div>
            <div class="playlist-editor__tag-form">
              <label :for="tagInputId">添加标签</label>
              <div>
                <span class="playlist-editor__tag-control">
                  <input
                    :id="tagInputId"
                    ref="tagInput"
                    v-model="tagDraft"
                    name="playlist-tag"
                    maxlength="32"
                    autocomplete="off"
                    placeholder="输入标签名称…"
                    :disabled="!feature.state.playlistTagsAvailable"
                  />
                </span>
                <button
                  type="submit"
                  :disabled="!tagDraft.trim() || !feature.state.playlistTagsAvailable"
                >
                  添加
                </button>
              </div>
            </div>
            <p v-if="!feature.state.playlistTagsAvailable" role="status">
              标签功能已停用，请启用后继续操作。
            </p>
          </template>
          <p v-if="nameError" :id="errorId" class="playlist-editor__error" role="alert">
            {{ nameError }}
          </p>
          <p v-if="cover.error.value" class="playlist-editor__error" role="alert">
            {{ cover.error.value }}
          </p>
          <p v-if="error" class="playlist-editor__error" role="alert">{{ error }}</p>
          <p v-if="message" role="status">{{ message }}</p>
          <div class="playlist-editor__footer">
            <TrackActionButton
              v-if="playlist && !field"
              icon="trash"
              label="删除歌单"
              inline
              danger
              @click="emit('remove', playlist.id)"
            />
            <template v-else>
              <button v-if="!playlist" class="playlist-editor__button" type="button" @click="close">
                取消
              </button>
              <button
                v-else
                class="playlist-editor__button playlist-editor__back"
                type="button"
                aria-label="返回歌单操作"
                @click="back"
              >
                <AppIcon name="arrow-left" :size="18" /> 返回
              </button>
              <button
                v-if="!playlist || (field && field !== 'tags')"
                class="playlist-editor__button playlist-editor__primary"
                type="submit"
                :disabled="!canSave"
              >
                {{ busy ? '保存中…' : playlist ? '保存' : '创建歌单' }}
              </button>
            </template>
          </div>
        </DialogPages>
      </fieldset>
    </form>
  </AppDialog>
  <AppDialog
    :open="open && tagDetailsOpen && Boolean(tags.length)"
    title="歌单标签"
    size="compact"
    return-focus-selector=".playlist-editor__tag-details"
    @close="tagDetailsOpen = false"
  >
    <TrackTagList :tags="tags" label="歌单标签" />
  </AppDialog>
  <AppDialog :open="exportOpen" title="导出歌单" size="compact" @close="exportOpen = false">
    <div class="playlist-editor playlist-export">
      <p>将“{{ playlist?.name }}”导出为 JSON 文件，可在另一台设备的“我的歌单”中导入。</p>
      <p>包含歌曲顺序、名称、简介和自定义歌曲配方；不包含音频文件、本地封面和账号数据。</p>
      <p v-if="exportError" class="playlist-editor__error" role="alert">{{ exportError }}</p>
      <button
        class="playlist-editor__button playlist-editor__primary"
        type="button"
        :disabled="feature.state.transferBusy || feature.availability.status !== 'available'"
        @click="exportFile"
      >
        <AppIcon name="download" :size="16" />{{
          feature.state.transferBusy ? '导出中…' : '导出 JSON 文件'
        }}
      </button>
    </div>
  </AppDialog>
  <ImagePreviewDialog
    :open="previewOpen"
    :src="cover.preview.value ?? ''"
    :title="`${name || '歌单'}封面预览`"
    @close="previewOpen = false"
  />
  <PlaylistCoverCropDialog
    v-if="cover.source.value"
    :source="cover.source.value"
    :busy="cover.busy.value"
    :error="cover.error.value"
    :suspended="!open || feature.availability.status !== 'available'"
    @cancel="cover.cancelCrop"
    @confirm="cover.confirmCrop"
  />
</template>

<style scoped lang="scss">
@use '../../styles/track-action-option';
@include track-action-option.rows;
.playlist-editor-dialog :deep(.app-dialog__header > div) {
  min-inline-size: 0;
  flex: 1;
}
.playlist-editor-dialog :deep(.app-dialog__header h2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.playlist-editor :deep(.dialog-pages) {
  /* Short editing pages size to their fields instead of reserving the actions page's height. */
  min-block-size: 0;
}
.playlist-editor :deep(.dialog-pages__view) {
  gap: var(--am-space-2);
}
.playlist-editor fieldset {
  display: grid;
  gap: var(--am-space-4);
  min-inline-size: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.playlist-editor__preview {
  display: grid;
  flex: 0 0 144px;
  inline-size: 144px;
  aspect-ratio: 8 / 5;
  place-items: center;
  overflow: hidden;
  border-radius: var(--am-radius-sm);
  color: var(--am-color-primary);
  background: linear-gradient(
    135deg,
    var(--am-color-primary-container),
    var(--am-color-surface-subtle)
  );
  padding: 0;
  border: 0;
  cursor: zoom-in;
}
.playlist-editor__preview img {
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}
.playlist-editor__preview:disabled {
  cursor: default;
}
.playlist-editor small,
.playlist-editor__required,
.playlist-editor__counter {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-weight: 400;
}
.playlist-editor__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  box-sizing: border-box;
  min-inline-size: 0;
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  font-size: var(--am-font-size-sm);
  font-weight: 650;
  cursor: pointer;
}
.playlist-editor__field {
  display: block;
  color: var(--am-color-text);
  font-size: var(--am-font-size-sm);
  font-weight: 650;
}
.playlist-editor__field input,
.playlist-editor__field textarea {
  display: block;
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  margin-block-start: var(--am-space-2);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  font-weight: 400;
}
.playlist-editor__field textarea {
  resize: vertical;
  min-block-size: 88px;
  max-block-size: 240px;
}
.playlist-editor__name-control {
  position: relative;
  display: block;
  margin-block-start: var(--am-space-2);
}
.playlist-editor__name-control::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 3px;
  background: var(--am-color-primary);
  pointer-events: none;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--am-motion-slow) var(--am-ease-standard);
}
.playlist-editor__name-control:focus-within::after {
  transform: scaleX(1);
}
@starting-style {
  .playlist-editor__name-control:focus-within::after {
    transform: scaleX(0);
  }
}
.playlist-editor__field .playlist-editor__name-control input {
  margin: 0;
  /* Retain the original field dimensions while replacing the boxed border with a baseline. */
  border: 1px solid transparent;
  border-block-end-color: var(--am-color-border-strong);
  border-radius: 0;
  background: transparent;
}
.playlist-editor__field .playlist-editor__name-control input:focus-visible {
  outline: none;
  box-shadow: none;
}
.playlist-editor__counter {
  display: block;
  margin-block-start: var(--am-space-1);
  text-align: end;
}
.playlist-editor__error {
  margin: 0;
  color: var(--am-color-danger);
  font-size: var(--am-font-size-sm);
}
.playlist-editor__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-3);
  padding-block-start: var(--am-space-4);
  border-block-start: 1px solid var(--am-color-border);
}
.playlist-editor .playlist-editor__primary {
  min-inline-size: 96px;
  border-color: var(--am-color-primary);
  color: var(--am-color-on-primary);
  background: var(--am-color-primary);
}
.playlist-editor__button:disabled,
.playlist-editor__item-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.playlist-editor button:focus-visible,
.playlist-editor input:focus-visible,
.playlist-editor textarea:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.playlist-editor__field :is(input, textarea):focus-visible {
  outline-offset: -3px;
}
.playlist-editor__summary-card {
  display: grid;
  grid-template-columns: 116px minmax(0, 1fr);
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
}
.playlist-editor__summary-card .playlist-editor__preview {
  inline-size: 116px;
}
.playlist-editor__metadata {
  min-inline-size: 0;
}
.playlist-editor__metadata p {
  margin: 2px 0 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.5;
}
.playlist-editor__primary-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--am-space-2);
}
.playlist-editor__items {
  display: grid;
  gap: var(--am-space-2);
  margin-block-start: var(--am-space-2);
  padding-block-start: var(--am-space-4);
  border-block-start: 1px solid var(--am-color-border);
}
.playlist-editor__item-trigger:focus-visible {
  outline-offset: -3px;
}
.playlist-editor__item-trigger > .app-icon {
  transition: transform var(--am-motion-fast) var(--am-ease-emphasized);
}
.playlist-editor__item-copy {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}
.playlist-editor__item-copy small {
  overflow-wrap: anywhere;
}
.playlist-editor__button:is(:hover, :focus-visible):not(:disabled),
.playlist-editor__item-trigger:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-surface-hover);
}
.playlist-editor .playlist-editor__primary:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-primary-hover);
}
.playlist-export {
  display: grid;
  gap: var(--am-space-4);
}
.playlist-export p {
  margin: 0;
  font-size: var(--am-font-size-sm);
  line-height: 1.7;
}
.playlist-export button {
  justify-self: center;
  gap: var(--am-space-2);
}
.playlist-editor__back {
  justify-self: start;
}
.playlist-editor__tags {
  display: grid;
  gap: var(--am-space-2);
  padding: var(--am-space-3);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
}
.playlist-editor__tags p {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.playlist-editor__tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--am-space-2);
}
.playlist-editor__tag-list button,
.playlist-editor__tag-form button,
.playlist-editor__tag-form input {
  min-inline-size: 0;
  min-block-size: 36px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}
.playlist-editor__tag-list button {
  display: inline-flex;
  align-items: center;
  gap: var(--am-space-2);
  max-inline-size: 100%;
  overflow-wrap: anywhere;
  border-color: transparent;
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}
.playlist-editor__tag-list button > .app-icon {
  flex: 0 0 auto;
}
.playlist-editor__tag-list button:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-primary-container);
}
.playlist-editor__tag-list button,
.playlist-editor__tag-form button {
  cursor: pointer;
}
.playlist-editor__tag-form,
.playlist-editor__tag-form > div {
  display: grid;
  gap: var(--am-space-2);
}
.playlist-editor__tag-form > div {
  grid-template-columns: minmax(0, 1fr) auto;
}
.playlist-editor__tag-control {
  position: relative;
  display: block;
  min-inline-size: 0;
}
.playlist-editor__tag-control::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-end: 0;
  block-size: 3px;
  background: var(--am-color-primary);
  pointer-events: none;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform var(--am-motion-slow) var(--am-ease-standard);
}
.playlist-editor__tag-control:focus-within::after {
  transform: scaleX(1);
}
@starting-style {
  .playlist-editor__tag-control:focus-within::after {
    transform: scaleX(0);
  }
}
.playlist-editor__tag-control input {
  box-sizing: border-box;
  inline-size: 100%;
  border: 0;
  border-block-end: 1px solid var(--am-color-border-strong);
  border-radius: 0;
  background: transparent;
}
.playlist-editor__tag-control input:focus-visible {
  outline: none;
  box-shadow: none;
}
.playlist-editor__tag-form button:hover:not(:disabled) {
  background: var(--am-color-surface-hover);
}
.playlist-editor__tag-form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.playlist-editor__tag-details {
  min-inline-size: 0;
  min-block-size: 44px;
  padding: var(--am-space-3);
  border: 0;
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
  cursor: pointer;
  font: inherit;
  text-align: start;
}
.playlist-editor__tag-details:hover {
  background: var(--am-color-surface-hover);
}
.playlist-editor__tag-details:focus-visible {
  outline-offset: 2px;
}
@media (prefers-reduced-motion: no-preference) {
  .playlist-editor__item-trigger:is(:hover, :focus-visible):not(:disabled) > .app-icon:first-child {
    transform: rotate(-6deg) scale(1.08);
  }
  .playlist-editor__item-trigger:is(:hover, :focus-visible):not(:disabled) > .app-icon:last-child {
    transform: translateX(3px);
  }
}
@container am-dialog (max-width: 480px) {
  .playlist-editor__summary-card {
    grid-template-columns: 80px minmax(0, 1fr);
  }
  .playlist-editor__summary-card .playlist-editor__preview {
    inline-size: 80px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .playlist-editor__item-trigger,
  .playlist-editor__item-trigger > .app-icon,
  .playlist-editor__name-control::after,
  .playlist-editor__tag-control::after {
    transition: none;
  }
}
</style>
