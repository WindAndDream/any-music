<script setup lang="ts">
import type { Track } from '@any-music/core'
import type {
  UiCatalogTrackActionsDialogProps,
  UiCatalogTrackActionsDialogEmits,
} from '@any-music/ui/catalog'
import { createTrackActionEditingState, trackActionEditingKey } from '@any-music/ui/catalog'
import { useTrackName } from '@any-music/ui/catalog'
import { useEditingSession, provideEditingSession } from '@any-music/ui/catalog'
import { useUiContributionAvailability } from '@any-music/ui/catalog'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import TrackCardSummary from '@any-music/ui/components/tracks/TrackCardSummary.vue'
import TrackNameEditor from '@any-music/ui/components/tracks/TrackNameEditor.vue'
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'

import PlaylistPickerPanel from '../library/PlaylistPickerPanel.vue'
import CatalogOperatorActions from './CatalogOperatorActions.vue'
import TrackActionButton from './TrackActionButton.vue'
import TrackTagList from './TrackTagList.vue'

/** 单曲二级操作共用一个弹窗；标签编辑作为子视图横向推进，避免把低频表单塞回卡片。 */
const props = withDefaults(
  defineProps<
    UiCatalogTrackActionsDialogProps & {
      editingScope?: string
      appear?: boolean
      scrollPrimaryActions?: boolean
    }
  >(),
  {
    suspended: false,
    showQueueAction: true,
    queued: false,
    downloadBusy: false,
  },
)
defineSlots<{
  'primary-action'?: () => unknown
  'download-action'?: () => unknown
  'queue-actions'?: () => unknown
  'secondary-actions'?: (context: { track: Track }) => unknown
  details?: (context: { track: Track }) => unknown
}>()

const pickerModalTarget = shallowRef<HTMLElement | null>(null)
const emit = defineEmits<UiCatalogTrackActionsDialogEmits & { afterLeave: [] }>()

const { customName, displayName } = useTrackName(() => props.track)
const contributions = useUiContributionAvailability('track.actions.secondary', () => ({
  hasTrack: !!props.track,
  selectionCount: 1,
  selectedTracks: props.track ? [props.track] : [],
}))
// Existing choices include unused definitions and tags on other songs, not source metadata.
const tagOptions = computed(
  () =>
    contributions.items.value.find((entry) => entry.implementationId === 'manage-tags')
      ?.inputOptions ?? props.customTags.map((value) => ({ value, selected: true })),
)
const details = useUiContributionAvailability('track.details', () => ({
  hasTrack: !!props.track,
  selectionCount: 1,
}))
const editing = useEditingSession(props.editingScope ?? 'track-actions')
provideEditingSession(editing)
const { activeView, lastEditor, tagDraft } = editing.state(
  trackActionEditingKey,
  createTrackActionEditingState,
)
const isReturning = shallowRef(false)
const isTagDetailsOpen = shallowRef(false)
const isPlaylistModalOpen = shallowRef(false)
const playlistTrigger = useTemplateRef<HTMLButtonElement>('playlistTrigger')
const playlistView = useTemplateRef<HTMLElement>('playlistView')
const hasTagDetails = computed(
  () => !!props.track && details.allows('tag-details') && props.customTags.length > 0,
)
const tagsTrigger = useTemplateRef<HTMLButtonElement>('tagsTrigger')
const tagInput = useTemplateRef<HTMLInputElement>('tagInput')
const nameTrigger = useTemplateRef<HTMLButtonElement>('nameTrigger')
const nameView = useTemplateRef<HTMLElement>('nameView')
const detailLines = computed(() => {
  if (!props.track) return []
  const published = props.track.publishedAtMs
    ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(props.track.publishedAtMs)
    : '时间未知'
  return [
    `发布于 ${published}`,
    `播放 ${props.track.statistics?.playCount?.toLocaleString() ?? '—'} · 弹幕 ${props.track.statistics?.danmakuCount?.toLocaleString() ?? '—'}`,
  ]
})

watch(
  () => contributions.allows('manage-tags'),
  (available) => {
    if (!available && activeView.value === 'tags') returnToActions()
  },
  { flush: 'sync' },
)

watch([() => props.open, () => props.track?.id], () => {
  editing.clearScope('name-editor')
  activeView.value = 'actions'
  tagDraft.value = ''
  isTagDetailsOpen.value = false
  isPlaylistModalOpen.value = false
  editing.clearScope('playlist-picker')
  editing.clearScope('playlist-picker-panel')
})

watch(hasTagDetails, (available) => {
  if (!available) isTagDetailsOpen.value = false
})

function openTagDetails(): void {
  if (!props.open || props.suspended || !hasTagDetails.value) return
  isTagDetailsOpen.value = true
}

function openTags(): void {
  if (!contributions.allows('manage-tags') || props.suspended) return
  lastEditor.value = 'tags'
  isReturning.value = false
  activeView.value = 'tags'
}

function openName(): void {
  editing.clearScope('name-editor')
  lastEditor.value = 'name'
  isReturning.value = false
  activeView.value = 'name'
}

function openPlaylists(): void {
  if (!props.open || props.suspended || props.invalid) return
  lastEditor.value = 'playlists'
  isReturning.value = false
  activeView.value = 'playlists'
}

function addToPlaylists(ids: readonly string[]): void {
  if (
    activeView.value !== 'playlists' ||
    !props.open ||
    props.suspended ||
    props.invalid ||
    !props.track
  )
    return
  for (const id of new Set(ids)) {
    if (props.playlists?.some((playlist) => playlist.id === id))
      emit('addToPlaylist', props.track, id)
  }
  returnToActions()
}

function saveName(name: string): void {
  if (!props.track) return
  emit('rename', props.track, name)
  returnToActions()
}

function returnToActions(): void {
  if (activeView.value === 'playlists') {
    editing.clearScope('playlist-picker')
    editing.clearScope('playlist-picker-panel')
  }
  isReturning.value = true
  activeView.value = 'actions'
}

async function handleViewEntered(): Promise<void> {
  await nextTick()
  if (activeView.value === 'tags') tagInput.value?.focus({ preventScroll: true })
  else if (activeView.value === 'name')
    nameView.value
      ?.querySelector<HTMLElement>('[name="track-custom-name"]')
      ?.focus({ preventScroll: true })
  else if (activeView.value === 'playlists')
    playlistView.value?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  else
    (lastEditor.value === 'playlists'
      ? playlistTrigger.value
      : lastEditor.value === 'name'
        ? nameTrigger.value
        : tagsTrigger.value
    )?.focus({
      preventScroll: true,
    })
}

function submitTag(): void {
  if (!contributions.allows('manage-tags') || props.suspended) return
  const tag = tagDraft.value.trim()
  if (!tag || !props.track) return
  emit('addTag', props.track, tag)
  tagDraft.value = ''
  tagInput.value?.focus({ preventScroll: true })
}

function toggleTag(value: string): void {
  if (!props.open || !props.track || props.suspended || !contributions.allows('manage-tags')) return
  const option = tagOptions.value.find((entry) => entry.value === value)
  if (!option) return
  if (option.selected) emit('removeTag', props.track, value)
  else emit('addTag', props.track, value)
}

function requestCompose(): void {
  if (!contributions.allows('compose') || props.suspended) return
  if (!props.track || props.invalid) return
  emit('close')
  emit('compose', props.track)
}

function requestPrimaryAction(action: 'play' | 'queue' | 'favorite' | 'download'): void {
  if (!props.track || props.suspended) return
  const isRemoval =
    (action === 'favorite' && props.favorite) || (action === 'queue' && props.queued)
  if (props.invalid && !isRemoval) return
  if (action === 'queue' && !props.showQueueAction) return
  if (action === 'download' && props.downloadBusy) return
  emit('close')
  if (action === 'play') emit('play', props.track)
  else if (action === 'queue') emit('queue', props.track)
  else if (action === 'download') emit('download', props.track)
  else emit('favorite', props.track)
}

/** 离场视图仍在 DOM 中播放动画，须先移出焦点序列并把焦点交给弹窗关闭按钮。 */
function deactivateLeavingView(element: Element): void {
  const root = element.getRootNode()
  const activeElement = root instanceof ShadowRoot ? root.activeElement : document.activeElement
  if (activeElement && element.contains(activeElement)) {
    element.closest('.app-dialog__panel')?.querySelector<HTMLElement>('.app-dialog__close')?.focus({
      preventScroll: true,
    })
  }
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}

function activateView(element: Element): void {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
</script>

<template>
  <AppDialog
    :open="props.open"
    :appear="props.appear"
    :suspended="props.suspended || isTagDetailsOpen || isPlaylistModalOpen"
    :back-action="activeView === 'actions' ? () => emit('close') : returnToActions"
    title="歌曲操作"
    :description="displayName"
    :size="activeView === 'playlists' ? 'wide' : 'compact'"
    :initial-focus-selector="
      props.invalid
        ? '.track-actions-dialog__tags-trigger'
        : '.track-actions-dialog__primary button'
    "
    @close="emit('close')"
    @after-leave="emit('afterLeave')"
  >
    <div v-if="props.track" class="track-actions-dialog">
      <TrackCardSummary
        :track="props.track"
        :detail-lines="detailLines"
        :badge-label="props.invalid ? '已失效' : ''"
        badge-tone="danger"
      />
      <button
        v-if="hasTagDetails"
        class="track-actions-dialog__tag-details"
        type="button"
        aria-label="查看全部标签"
        aria-haspopup="dialog"
        :aria-expanded="isTagDetailsOpen"
        @click="openTagDetails"
      >
        <TrackTagList :tags="props.customTags" single-line />
      </button>
      <slot name="details" :track="props.track" />
      <div class="track-actions-dialog__stage">
        <Transition
          :name="isReturning ? 'track-actions-back' : 'track-actions-forward'"
          @after-enter="handleViewEntered"
          @before-enter="activateView"
          @before-leave="deactivateLeavingView"
          @leave-cancelled="activateView"
        >
          <div v-if="activeView === 'actions'" key="actions" class="track-actions-dialog__view">
            <!-- 窄卡片只保留“操作”入口时，这里提供所有一级动作的完整键盘与触摸路径。 -->
            <component
              :is="props.scrollPrimaryActions ? CatalogOperatorActions : 'div'"
              class="track-actions-dialog__primary"
              :class="{
                'track-actions-dialog__primary--scrollable': props.scrollPrimaryActions,
                'track-actions-dialog__primary--without-queue':
                  !props.showQueueAction && !$slots['primary-action'],
              }"
              role="group"
              aria-label="歌曲常用操作"
            >
              <TrackActionButton
                icon="play"
                label="播放"
                :disabled="props.invalid"
                @click="requestPrimaryAction('play')"
              />
              <TrackActionButton
                v-if="props.showQueueAction"
                icon="queue"
                :label="props.queued ? '已待听' : '待听'"
                :pressed="props.queued"
                :aria-label="props.queued ? '取消待听' : '添加待听'"
                :disabled="props.invalid && !props.queued"
                @click="requestPrimaryAction('queue')"
              />
              <TrackActionButton
                icon="heart"
                :label="props.favorite ? '已喜欢' : '喜欢'"
                :pressed="props.favorite"
                :aria-label="props.favorite ? '取消喜欢' : '喜欢'"
                :disabled="props.invalid && !props.favorite"
                @click="requestPrimaryAction('favorite')"
              />
              <slot name="download-action">
                <TrackActionButton
                  icon="download"
                  label="下载"
                  :disabled="props.invalid || props.downloadBusy"
                  @click="requestPrimaryAction('download')"
                />
              </slot>
              <slot name="primary-action" />
            </component>
            <div v-if="$slots['queue-actions']" class="track-actions-dialog__section">
              <slot name="queue-actions" />
            </div>
            <div class="track-actions-dialog__section track-actions-dialog__details">
              <slot name="secondary-actions" :track="props.track" />
              <button
                ref="nameTrigger"
                class="track-action-option track-actions-dialog__option"
                type="button"
                @click="openName"
              >
                <AppIcon name="edit" :size="20" />
                <span
                  ><strong>自定义名称</strong
                  ><small>{{
                    customName ? '修改名称或恢复来源原名' : '给这首歌起一个方便识别的名称'
                  }}</small></span
                >
                <AppIcon name="arrow-right" :size="17" />
              </button>
              <button
                ref="playlistTrigger"
                class="track-action-option track-actions-dialog__option"
                type="button"
                :disabled="props.invalid"
                @click="openPlaylists"
              >
                <AppIcon name="playlist" :size="20" />
                <span><strong>添加歌单</strong><small>选择歌单，收录这首音乐</small></span>
                <AppIcon name="arrow-right" :size="17" />
              </button>
              <button
                v-if="contributions.allows('manage-tags')"
                ref="tagsTrigger"
                class="track-action-option track-actions-dialog__option track-actions-dialog__tags-trigger"
                type="button"
                @click="openTags"
              >
                <AppIcon name="tags" :size="20" />
                <span><strong>管理标签</strong><small>查看、添加和移除这首歌的标签</small></span>
                <AppIcon name="arrow-right" :size="17" />
              </button>
              <button
                v-if="contributions.allows('compose')"
                class="track-action-option track-actions-dialog__option"
                type="button"
                :disabled="props.invalid"
                @click="requestCompose"
              >
                <AppIcon name="segments" :size="20" />
                <span><strong>截取片段</strong><small>进入片段创作并选择范围</small></span>
                <AppIcon name="arrow-right" :size="17" />
              </button>
              <a
                v-if="props.track.source.pageUrl"
                class="track-action-option track-actions-dialog__option"
                :href="props.track.source.pageUrl"
                target="_blank"
                rel="noopener noreferrer"
                @click="emit('close')"
              >
                <AppIcon name="link" :size="20" />
                <span><strong>打开来源原页</strong><small>在新标签页查看原始内容</small></span>
                <AppIcon name="arrow-right" :size="17" />
              </a>
            </div>
          </div>
          <div
            v-else-if="activeView === 'tags' && contributions.allows('manage-tags')"
            key="tags"
            class="track-actions-dialog__view"
          >
            <div class="track-actions-dialog__tags">
              <strong>已有标签</strong>
              <p v-if="tagOptions.length === 0">还没有标签，添加一个方便以后筛选。</p>
              <div v-else class="track-actions-dialog__tag-list">
                <button
                  v-for="option in tagOptions"
                  :key="option.value"
                  type="button"
                  :aria-label="`${option.selected ? '移除' : '添加'}标签 ${option.value}`"
                  :aria-pressed="option.selected"
                  :disabled="props.suspended"
                  @click="toggleTag(option.value)"
                >
                  #{{ option.value }}
                  <AppIcon :name="option.selected ? 'close' : 'plus'" :size="14" />
                </button>
              </div>
            </div>
            <form class="track-actions-dialog__tag-form" @submit.prevent="submitTag">
              <label for="am-track-tag-input">添加标签</label>
              <div>
                <input
                  id="am-track-tag-input"
                  ref="tagInput"
                  v-model="tagDraft"
                  maxlength="32"
                  name="catalog-track-tag"
                  autocomplete="off"
                  placeholder="输入标签名称…"
                />
                <button type="submit" :disabled="!tagDraft.trim()">添加</button>
              </div>
            </form>
            <div class="track-actions-dialog__footer">
              <button class="track-actions-dialog__back" type="button" @click="returnToActions">
                <AppIcon name="arrow-left" :size="18" /> 返回
              </button>
            </div>
          </div>
          <div
            v-else-if="activeView === 'playlists'"
            key="playlists"
            ref="playlistView"
            class="track-actions-dialog__view"
          >
            <PlaylistPickerPanel
              :overlay-target="pickerModalTarget"
              :open="props.open && activeView === 'playlists'"
              :playlists="props.playlists ?? []"
              :selected-count="1"
              :suspended="props.suspended"
              @select="addToPlaylists"
              @back="returnToActions"
              @modal-open-change="isPlaylistModalOpen = $event"
            />
          </div>
          <div v-else key="name" ref="nameView" class="track-actions-dialog__view">
            <TrackNameEditor
              :original-name="props.track.title"
              :custom-name="customName"
              @back="returnToActions"
              @save="saveName"
            />
          </div>
        </Transition>
      </div>
    </div>
    <template #overlays><div ref="pickerModalTarget" /></template>
  </AppDialog>
  <AppDialog
    :open="props.open && hasTagDetails && isTagDetailsOpen"
    :suspended="props.suspended"
    title="歌曲标签"
    size="compact"
    return-focus-selector=".track-actions-dialog__tag-details"
    @close="isTagDetailsOpen = false"
  >
    <TrackTagList :tags="props.customTags" />
  </AppDialog>
</template>

<style scoped lang="scss">
@use '../../styles/track-action-option';
@include track-action-option.rows;
.track-actions-dialog {
  display: grid;
  gap: var(--am-space-4);
}

.track-actions-dialog__tag-details {
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

.track-actions-dialog__tag-details:hover {
  background: var(--am-color-surface-hover);
}

.track-actions-dialog__tag-details:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: 2px;
}

.track-actions-dialog :deep(.track-card-summary) {
  grid-template-columns: 116px minmax(0, 1fr);
  align-items: center;
  padding: var(--am-space-3);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
}

.track-actions-dialog :deep(.track-card-summary__cover) {
  inline-size: 116px;
  border-radius: var(--am-radius-sm);
}

/* 操作详情保留完整名称；卡片自身仍省略过长文字，窄屏不会横向溢出。 */
.track-actions-dialog :deep(.track-card-summary__title),
.track-actions-dialog :deep(.track-card-summary__original-text) {
  overflow-wrap: anywhere;
  white-space: normal;
}

.track-actions-dialog__stage {
  position: relative;
  min-block-size: 220px;
  overflow: hidden;
}

.track-actions-dialog__view {
  display: grid;
  gap: var(--am-space-2);
}

.track-actions-dialog__primary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--am-space-2);
}
.track-actions-dialog__primary--without-queue {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.track-actions-dialog__primary--scrollable {
  container: am-track-actions / inline-size;
  grid-template-columns: minmax(0, 1fr);
}
.track-actions-dialog__primary--scrollable.catalog-operator-actions--overflow {
  grid-template-columns: minmax(0, 1fr) 44px;
}
.track-actions-dialog__primary--scrollable :deep(.catalog-operator-actions__content) {
  justify-content: flex-start;
  gap: var(--am-space-2);
}
.track-actions-dialog__primary--scrollable :deep(.track-action-button) {
  /* 长标签保持单行，按钮按内容加宽，由操作行承接横向溢出。 */
  min-inline-size: max-content;
  flex: 0 0 max(68px, calc((100cqi - 3 * var(--am-space-2)) / 4));
  padding-inline: var(--am-space-2);
  white-space: nowrap;
}

.track-actions-dialog__section {
  margin-block-start: var(--am-space-2);
  padding-block-start: var(--am-space-4);
  border-block-start: 1px solid var(--am-color-border);
}
.track-actions-dialog__details {
  display: grid;
  gap: var(--am-space-2);
}

.track-actions-dialog__back,
.track-actions-dialog__tag-list button,
.track-actions-dialog__tag-form button {
  min-block-size: 36px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
}

.track-actions-dialog__back,
.track-actions-dialog__tag-list button {
  display: inline-flex;
  align-items: center;
  gap: var(--am-space-2);
}

.track-actions-dialog__footer {
  display: flex;
  justify-content: flex-end;
  margin-block-start: var(--am-space-2);
}

.track-actions-dialog__back {
  min-block-size: 44px;
}

.track-actions-dialog__back:hover {
  background: var(--am-color-surface-hover);
}

.track-actions-dialog__back:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}

.track-actions-dialog__tags {
  display: grid;
  gap: var(--am-space-2);
  padding: var(--am-space-3);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface-subtle);
}

.track-actions-dialog__tags p {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.track-actions-dialog__tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--am-space-2);
}

.track-actions-dialog__tag-list button[aria-pressed='true'] {
  border-color: transparent;
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.track-actions-dialog__tag-list button:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-surface-hover);
}

.track-actions-dialog__tag-list
  button[aria-pressed='true']:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-primary-container);
}

.track-actions-dialog__tag-form,
.track-actions-dialog__tag-form > div {
  display: grid;
  gap: var(--am-space-2);
}

.track-actions-dialog__tag-form > div {
  grid-template-columns: minmax(0, 1fr) auto;
}

.track-actions-dialog__tag-form input {
  min-inline-size: 0;
  min-block-size: 36px;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
}

/* 横向切页需要裁切离场视图；焦点环画在输入框内侧，避免左缘被 stage 裁掉。 */
.track-actions-dialog__tag-form input:focus {
  border-color: var(--am-color-primary);
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}

.track-actions-dialog__tag-form button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.track-actions-forward-enter-active,
.track-actions-forward-leave-active,
.track-actions-back-enter-active,
.track-actions-back-leave-active {
  transition:
    transform var(--am-motion-normal) var(--am-ease-emphasized),
    opacity var(--am-motion-normal) var(--am-ease-standard);
}

.track-actions-forward-leave-active,
.track-actions-back-leave-active {
  position: absolute;
  inset: 0;
}

.track-actions-forward-enter-from,
.track-actions-back-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.track-actions-forward-leave-to,
.track-actions-back-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}

@container am-dialog (max-width: 480px) {
  .track-actions-dialog :deep(.track-card-summary) {
    grid-template-columns: 80px minmax(0, 1fr);
  }

  .track-actions-dialog :deep(.track-card-summary__cover) {
    inline-size: 80px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .track-actions-dialog__option,
  .track-actions-dialog__option > .app-icon {
    transition: none;
  }
  .track-actions-forward-enter-active,
  .track-actions-forward-leave-active,
  .track-actions-back-enter-active,
  .track-actions-back-leave-active {
    transition-duration: 1ms;
  }
}
</style>
