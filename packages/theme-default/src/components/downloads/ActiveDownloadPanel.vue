<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import TrackCardGrid from '@any-music/ui/components/music-sources/TrackCardGrid.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import { useDownloadListControls, type DownloadListFilter } from '@any-music/ui/library'
import { useConfirmAction } from '@any-music/ui/library'
import { provideEditingSession, useEditingSession } from '@any-music/ui/library'
import type { ActiveDownloadProps, ActiveDownloadEmits } from '@any-music/ui/theme'
import { computed, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'

import CatalogOperatorActions from '../music-sources/CatalogOperatorActions.vue'
import CatalogTrackFilterPanel from '../music-sources/CatalogTrackFilterPanel.vue'
import QueueViewControls from '../music-sources/QueueViewControls.vue'
import DownloadCollectionHeading from './DownloadCollectionHeading.vue'
import DownloadOperatorPanel from './DownloadOperatorPanel.vue'
import DownloadTrackActionsDialog from './DownloadTrackActionsDialog.vue'
import DownloadTrackRow from './DownloadTrackRow.vue'

/** Controlled task collection: runtime orchestration owns bytes, admission and persistence. */
const props = withDefaults(defineProps<ActiveDownloadProps>(), { operatorAutoFocus: true })
const emit = defineEmits<ActiveDownloadEmits>()
provideEditingSession(useEditingSession('downloads'))
const controls = useDownloadListControls({
  batches: () => props.batches,
  filterOpen: () => props.filterOpen,
  platformNames: () => props.platformNames,
  customTags: () => props.customTagsByTrackId,
})
const {
  status,
  counts,
  visibleEntries,
  scopedEntries,
  previewEntries,
  selection,
  draft,
  actionLabel,
  resumableIds,
  pausableIds,
  cancellableIds,
  removableIds,
  summary,
  platformStats,
  tagStats,
} = controls
const states: readonly { id: DownloadListFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'downloading', label: '下载中' },
  { id: 'paused', label: '已暂停' },
  { id: 'succeeded', label: '已下载' },
  { id: 'failed', label: '下载失败' },
]
const active = shallowRef(true)
const filterDetailOpen = shallowRef(false)
const displayOpen = shallowRef(false)
const actionId = shallowRef<string>()
const actionEntry = computed(() =>
  actionId.value
    ? controls.entries.value.find(({ item }) => item.id === actionId.value)
    : undefined,
)
const confirm = useConfirmAction()
let generation = 0
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
  generation += 1
  displayOpen.value = false
  actionId.value = undefined
  emit('modalOpenChange', false)
})
onScopeDispose(() => {
  generation += 1
  emit('modalOpenChange', false)
})
watch(
  () => props.operatorOpen,
  (open) => {
    if (!open) selection.clearSelection()
  },
)
watch(summary, (value) => emit('summaryChange', value), { immediate: true })
watch([displayOpen, actionEntry], ([display, entry]) =>
  emit('modalOpenChange', display || Boolean(entry)),
)
const suspended = computed(() => !active.value || props.panelsSuspended)
const emptyTitle = computed(() =>
  !controls.entries.value.length
    ? '当前没有下载任务'
    : status.value === 'all'
      ? '没有匹配的下载任务'
      : `没有${states.find(({ id }) => id === status.value)?.label}任务`,
)
function toggleAll(): void {
  selection.toggleAllVisible()
  emit('selectAllChange', selection.selectedCount.value)
}
function applyFilterDraft(): void {
  draft.applyDraft()
  emit('closeFilter')
}
async function removeSelected(): Promise<void> {
  await removeItems([...removableIds.value])
}
async function removeItems(ids: readonly string[]): Promise<void> {
  const revision = generation
  if (
    !ids.length ||
    !(await confirm({
      title: '移除下载记录',
      message: `移除已选的 ${ids.length} 条下载记录？已保存的文件会保留。`,
      confirmLabel: '移除记录',
      tone: 'danger',
    })) ||
    revision !== generation
  )
    return
  emit('remove', ids)
}
</script>

<template>
  <section
    class="download-collection"
    :class="{ 'download-collection--empty': !visibleEntries.length }"
    aria-label="下载任务"
  >
    <div class="download-collection__surface">
      <DownloadCollectionHeading
        :concurrency="concurrency"
        :downloaded-count="counts.succeeded"
        :mobile-layout="mobileLayout"
      />
      <QueueViewControls
        collection-title="下载"
        arrangement-mode="flat"
        :display-mode="displayMode"
        :mobile-columns="mobileColumns"
        :overlay-target="overlayTarget"
        :suspended="suspended"
        @update-display-mode="emit('updateDisplayMode', $event)"
        @update-mobile-columns="emit('updateMobileColumns', $event)"
        @modal-open-change="displayOpen = $event"
      >
        <template #default="{ openDisplay }">
          <div class="download-collection__toolbar">
            <CatalogOperatorActions
              class="download-collection__tabs"
              role="group"
              aria-label="下载状态"
              align="start"
              forward-label="查看更多下载状态"
              back-label="返回前面的下载状态"
            >
              <div
                class="download-collection__status-options"
                :style="{
                  '--am-state-tab-index': states.findIndex(({ id }) => id === status),
                }"
              >
                <button
                  v-for="state in states"
                  :key="state.id"
                  type="button"
                  class="download-collection__tab"
                  :aria-pressed="status === state.id"
                  @click="status = state.id"
                >
                  {{ state.label }} <span>{{ counts[state.id] }}</span>
                </button>
              </div>
            </CatalogOperatorActions>
            <button
              class="download-collection__display"
              type="button"
              aria-haspopup="dialog"
              aria-label="选择歌曲展示方式"
              title="展示方式"
              @click="openDisplay"
            >
              <AppIcon name="list" :size="16" /><span class="download-collection__display-label"
                >展示方式</span
              >
            </button>
          </div>
        </template>
      </QueueViewControls>
      <p v-if="errorMessage" class="download-collection__error" role="alert">{{ errorMessage }}</p>
      <p v-if="statusMessage" class="download-collection__status" role="status">
        {{ statusMessage }}
      </p>
      <MusicListEmptyState v-if="!visibleEntries.length" icon="download" :title="emptyTitle">{{
        controls.entries.value.length
          ? '切换下载状态或调整筛选条件，找到需要的歌曲。'
          : '在发现、待听、我的喜欢或歌单中选择歌曲，即可开始下载。'
      }}</MusicListEmptyState>
      <TrackCardGrid v-else :display-mode="displayMode" :mobile-columns="mobileColumns">
        <DownloadTrackRow
          :selectable="props.operatorOpen"
          v-for="entry in visibleEntries"
          :key="entry.item.id"
          :entry="entry"
          :custom-tags="props.customTagsByTrackId.get(entry.item.track.id)"
          :selected="selection.selectedIds.value.has(entry.item.id)"
          :context-label="
            platformNames.get(entry.item.track.source.pluginId) ?? entry.item.track.source.pluginId
          "
          :display-mode="displayMode"
          :active="currentTrackId === entry.item.track.id"
          :favorite="favoriteTrackIds.has(entry.item.track.id)"
          :invalid="invalidTrackIds.has(entry.item.track.id)"
          @select="selection.toggleItem"
          @pause="emit('pause', [$event])"
          @resume="emit('resume', [$event])"
          @play="emit('play', $event)"
          @favorite="emit('favorite', $event)"
          @show-actions="actionId = $event"
        />
      </TrackCardGrid>
    </div>
    <Teleport v-if="overlayTarget" :to="overlayTarget" :disabled="!active">
      <DownloadTrackActionsDialog
        :playlists="playlists"
        @add-to-playlist="(track, id) => emit('addToPlaylist', id, [track])"
        :entry="actionEntry"
        :favorite="favoriteTrackIds.has(actionEntry?.item.track.id ?? '')"
        :queued="queuedTrackIds.has(actionEntry?.item.track.id ?? '')"
        :invalid="invalidTrackIds.has(actionEntry?.item.track.id ?? '')"
        :custom-tags="customTagsByTrackId.get(actionEntry?.item.track.id ?? '') ?? []"
        :cancelling="cancelling"
        :suspended="suspended"
        @close="actionId = undefined"
        @pause="emit('pause', [$event])"
        @resume="emit('resume', [$event])"
        @cancel="emit('cancel', [$event])"
        @remove="removeItems([$event])"
        @play="emit('play', $event)"
        @queue="emit('queue', $event)"
        @favorite="emit('favorite', $event)"
        @compose="emit('compose', $event)"
        @add-tag="(track, tag) => emit('addTag', track, tag)"
        @remove-tag="(track, tag) => emit('removeTag', track, tag)"
        @rename="(track, name) => emit('rename', track, name)"
      />
      <BottomSheet
        :open="filterOpen"
        title="下载筛选器"
        description="按文本、标签、歌曲时长、来源平台与任务日期筛选。"
        size="full"
        :suspended="suspended"
        @close="emit('closeFilter')"
      >
        <CatalogTrackFilterPanel
          v-if="filterOpen"
          v-model:filters="draft.draft.value"
          history-scope="downloads:tracks"
          filter-context="downloads"
          :tag-stats="tagStats"
          :platform-stats="platformStats"
          :result-count="previewEntries.length"
          :total-count="scopedEntries.length"
          @detail-open-change="filterDetailOpen = $event"
          @preview-change="draft.preview.value = $event"
        />
        <template v-if="!filterDetailOpen" #footer
          ><div class="download-collection__filter-footer">
            <span>匹配 {{ previewEntries.length }} / 共 {{ scopedEntries.length }} 首</span
            ><button type="button" @click="emit('closeFilter')">取消</button
            ><button type="button" @click="applyFilterDraft">应用筛选</button>
          </div></template
        >
      </BottomSheet>
    </Teleport>
    <Teleport v-if="operatorOverlayTarget" :to="operatorOverlayTarget" :disabled="!active">
      <SidePanel
        :open="operatorOpen"
        :auto-focus="operatorAutoFocus"
        title="下载操作器"
        :description="`已选 ${selection.selectedCount.value} 首`"
        stacked-actions
        :suspended="suspended || displayOpen || Boolean(actionEntry)"
        @close="emit('closeOperator')"
      >
        <DownloadOperatorPanel
          :selected-count="selection.selectedCount.value"
          :visible-count="visibleEntries.length"
          :all-selected="selection.areAllVisibleSelected.value"
          :some-selected="selection.areSomeVisibleSelected.value"
          :action-label="actionLabel"
          :can-resume="resumableIds.length > 0 && !cancelling"
          :can-pause="pausableIds.length > 0 && !cancelling"
          :can-cancel="cancellableIds.length > 0 && !cancelling"
          :can-remove="removableIds.length > 0"
          @toggle-all="toggleAll"
          @resume="emit('resume', resumableIds)"
          @pause="emit('pause', pausableIds)"
          @cancel="emit('cancel', cancellableIds)"
          @remove="removeSelected"
        />
      </SidePanel>
    </Teleport>
  </section>
</template>

<style scoped lang="scss">
@use '../../styles/collection-chrome';
.download-collection {
  --am-catalog-page-padding: clamp(var(--am-space-4), 2.2cqi, var(--am-space-7));
  container: am-download-collection / inline-size;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  inline-size: 100%;
  min-block-size: 0;
  min-inline-size: 0;
  overflow-x: clip;
  padding: var(--am-catalog-page-padding);
  background: var(--am-color-background);
}
.download-collection__surface {
  min-inline-size: 0;
  padding: var(--am-space-4) var(--am-space-3);
  background: var(--am-color-surface-subtle);
}
.download-collection--empty .download-collection__surface {
  /* Carry the available content height through to the shared empty state. */
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
}
.download-collection__toolbar {
  position: sticky;
  z-index: var(--am-z-sticky);
  inset-block-start: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--am-space-2);
  margin-block-end: var(--am-space-4);
  padding-block: var(--am-space-2);
  border-block-end: 1px solid var(--am-color-border);
  background: var(--am-color-surface-subtle);
}
.download-collection__tabs {
  --am-operator-actions-background: var(--am-color-surface-subtle);
  min-inline-size: 0;
}
.download-collection__tabs :deep(.catalog-operator-actions__content) {
  gap: var(--am-space-1);
}
.download-collection__status-options {
  @include collection-chrome.state-tabs(5);
}
.download-collection__display,
.download-collection__filter-footer button {
  display: inline-flex;
  min-block-size: 44px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  white-space: nowrap;
  cursor: pointer;
  touch-action: manipulation;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard);
}
.download-collection__display:is(:hover, :focus-visible),
.download-collection__filter-footer button:is(:hover, :focus-visible) {
  background: var(--am-color-surface-hover);
}
.download-collection__display:focus-visible,
.download-collection__filter-footer button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.download-collection__status {
  margin-block: 0 var(--am-space-3);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.download-collection__error {
  color: var(--am-color-danger);
}
.download-collection__filter-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-2);
  font-size: var(--am-font-size-sm);
}
.download-collection__filter-footer span {
  flex: 1 1 auto;
}
@container am-download-collection (max-width: 760px) {
  .download-collection__display {
    inline-size: 44px;
    min-inline-size: 44px;
    padding-inline: 0;
  }
  .download-collection__display-label {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .download-collection__display,
  .download-collection__filter-footer button {
    transition: none;
  }
}
</style>
