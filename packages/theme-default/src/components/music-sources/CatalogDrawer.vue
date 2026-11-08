<script setup lang="ts">
import type { UiCatalogDrawerProps, UiCatalogDrawerEmits } from '@any-music/ui/catalog'
import { useFilterDraft } from '@any-music/ui/catalog'
import { useCatalogListControls } from '@any-music/ui/catalog'
import {
  cloneCatalogTrackFilterState,
  countCatalogTrackFilters,
  filterCatalogTracks,
  useCatalogTrackFilters,
} from '@any-music/ui/catalog'
import { useTrackBatchActions } from '@any-music/ui/catalog'
import { useTrackNames } from '@any-music/ui/catalog'
import { useActionFeedback } from '@any-music/ui/catalog'
import { useEditingSession, provideEditingSession } from '@any-music/ui/catalog'
import { getSelectionFeedbackMessage } from '@any-music/ui/catalog'
import type { CatalogTrackListSummary } from '@any-music/ui/catalog'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import CatalogErrorNotice from './CatalogErrorNotice.vue'
import CatalogPlaylistPickerDialog from './CatalogPlaylistPickerDialog.vue'
import CatalogTrackFilterPanel from './CatalogTrackFilterPanel.vue'
import CatalogTrackOperatorPanel from './CatalogTrackOperatorPanel.vue'
import TrackList from './TrackList.vue'

// 歌曲页容器拥有筛选、多选和确认编排；来源请求与资料库写入仍通过事件上抛。
const props = withDefaults(defineProps<UiCatalogDrawerProps>(), {
  active: true,
  queuedTrackIds: () => new Set(),
  downloadedTrackIds: () => new Set(),
  downloadBusy: false,
  errorNoticeVisible: true,
  filterOpen: false,
  operatorOpen: false,
  operatorAutoFocus: true,
  panelsSuspended: false,
  overlayTarget: null,
  operatorOverlayTarget: null,
})

const emit = defineEmits<UiCatalogDrawerEmits>()
const showFeedback = useActionFeedback()
const { customNamesByTrackId, getDisplayName } = useTrackNames()
const editing = useEditingSession(`catalog:${props.drawer.id}`)
provideEditingSession(editing)

const { filters, filterCounts, visibleTracks, tagStats, userTagsEnabled } = useCatalogTrackFilters(
  () => props.drawer.tracks,
  () => props.customTagsByTrackId,
  customNamesByTrackId,
  editing,
)
const {
  draft: filterDraft,
  preview: filterPreview,
  resetDraft: resetFilterDraft,
  applyDraft: commitFilterDraft,
} = useFilterDraft({
  editing,
  applied: filters,
  open: () => props.filterOpen,
  clone: cloneCatalogTrackFilterState,
  apply: (value) => {
    filters.value = value
  },
})
const previewTracks = computed(() =>
  filterCatalogTracks(
    props.drawer.tracks,
    props.customTagsByTrackId,
    filterPreview.value,
    customNamesByTrackId.value,
    userTagsEnabled.value,
  ),
)
const previewFilterCounts = computed(() => countCatalogTrackFilters(filterDraft.value))
const trackControls = useCatalogListControls({
  editing,
  items: visibleTracks,
  getId: (track) => track.id,
  getName: (track) => [getDisplayName(track), track.title].join('\n'),
})
const summary = computed<CatalogTrackListSummary>(() => ({
  selectedCount: trackControls.selectedCount.value,
  visibleCount: trackControls.visibleItems.value.length,
  totalCount: props.drawer.tracks.length,
}))
const tracksById = computed(() => new Map(props.drawer.tracks.map((track) => [track.id, track])))
const selectedTracksInSelectionOrder = computed(() => {
  // Set 的插入顺序就是勾选顺序；取消后重选会排到末尾，全选只追加尚未勾选项。
  return [...trackControls.selectedIds.value].flatMap((id) => {
    const track = tracksById.value.get(id)
    return track ? [track] : []
  })
})
// 只有批量待听消费勾选顺序；歌单、下载和喜欢保留现有列表顺序契约。
const selectedTracks = computed(() =>
  props.drawer.tracks.filter((track) => trackControls.selectedIds.value.has(track.id)),
)
const selectedCustomNamedIds = computed(() =>
  selectedTracks.value
    .filter((track) => customNamesByTrackId.value.has(track.id))
    .map((track) => track.id),
)
const batchActions = useTrackBatchActions({
  tracks: selectedTracks,
  queueTracks: selectedTracksInSelectionOrder,
  queuedTrackIds: () => props.queuedTrackIds,
  favoriteTrackIds: () => props.favoriteTrackIds,
  downloadedTrackIds: () => props.downloadedTrackIds,
  playlists: () => props.playlists,
  downloadBusy: () => props.downloadBusy,
  active: () => props.active,
  clearSelection: trackControls.clearSelection,
  addToQueue: (tracks) => emit('addSelectedToQueue', tracks),
  addToFavorites: (tracks) => emit('addSelectedToFavorites', tracks),
  download: (tracks) => emit('downloadSelected', tracks, props.drawer.id),
  addToPlaylist: (id, tracks) => emit('addSelectedToPlaylist', id, tracks),
})
const { areAllSelectedFavorited, areAllSelectedQueued, isPlaylistPickerOpen } = batchActions
const isFilterDetailOpen = shallowRef(false)

watch(
  () => props.operatorOpen,
  (open) => {
    if (!open) trackControls.clearSelection()
  },
)
watch(
  () => props.active,
  (isActive) => {
    if (!isActive) isPlaylistPickerOpen.value = false
  },
)
watch(summary, (value) => emit('summaryChange', value), { immediate: true })
watch(
  () => filterCounts.value.total,
  (count) => emit('filterCountChange', count),
  { immediate: true },
)
watch(isPlaylistPickerOpen, (isOpen) => emit('modalOpenChange', isOpen), { immediate: true })
watch(
  () => trackControls.selectedCount.value,
  (selectedCount) => {
    if (selectedCount === 0) isPlaylistPickerOpen.value = false
  },
)

onScopeDispose(() => {
  emit('modalOpenChange', false)
  emit('filterCountChange', 0)
})

function requestRestoreSelectedNames(): void {
  if (selectedTracks.value.length === 0) return
  emit('restoreNames', selectedCustomNamedIds.value)
  trackControls.clearSelection()
}

function toggleAllVisible(): void {
  trackControls.toggleAllVisible()
  emit('toggleAllVisible', trackControls.selectedCount.value)
  showFeedback({
    status: 'success',
    message: getSelectionFeedbackMessage(trackControls.selectedCount.value, '首歌曲'),
  })
}

function closeFilter(): void {
  resetFilterDraft()
  emit('closeFilter')
}

function applyFilterDraft(): void {
  commitFilterDraft()
  emit('closeFilter')
}
</script>

<template>
  <article class="catalog-drawer" :data-status="props.drawer.status">
    <div class="catalog-drawer__panel">
      <CatalogErrorNotice
        v-if="props.errorNoticeVisible"
        :drawer="props.drawer"
        @show-error="emit('showError', $event)"
      />
      <TrackList
        :selectable="props.operatorOpen"
        :listing-id="props.drawer.id"
        :tracks="trackControls.visibleItems.value"
        :custom-tags-by-track-id="props.customTagsByTrackId"
        :current-track-id="props.currentTrackId"
        :invalid-track-ids="props.invalidTrackIds"
        :favorite-track-ids="props.favoriteTrackIds"
        :selected-track-ids="trackControls.selectedIds.value"
        :download-busy="props.downloadBusy"
        :display-mode="props.displayMode"
        :mobile-columns="props.mobileColumns"
        :loading="props.drawer.isLoading || props.drawer.status === 'restoring'"
        :has-more="props.active && props.drawer.hasMore && props.drawer.isSourceEnabled"
        :loaded-page-count="props.drawer.loadedPageCount"
        :loaded-track-count="props.drawer.tracks.length"
        :error-message="''"
        @play="emit('play', $event)"
        @download="emit('downloadSelected', [$event], props.drawer.id)"
        @favorite="emit('favorite', $event)"
        @select="trackControls.toggleItem"
        @show-actions="emit('showTrackActions', $event)"
        @load-more="emit('loadMore', props.drawer.id)"
      />
    </div>
  </article>

  <!-- 筛选器与歌单选择属于模态层；操作条使用较低的独立宿主，让系统侧栏始终可覆盖它。 -->
  <Teleport v-if="props.overlayTarget" :to="props.overlayTarget" :disabled="!props.active">
    <BottomSheet
      :open="props.filterOpen"
      title="歌曲筛选器"
      :description="props.drawer.title"
      size="full"
      :suspended="!props.active || props.panelsSuspended"
      @close="closeFilter"
    >
      <CatalogTrackFilterPanel
        v-model:filters="filterDraft"
        :history-scope="`catalog:tracks:${props.drawer.id}`"
        :tag-stats="tagStats"
        :result-count="previewTracks.length"
        :total-count="props.drawer.tracks.length"
        @detail-open-change="isFilterDetailOpen = $event"
        @preview-change="filterPreview = $event"
      />
      <template v-if="!isFilterDetailOpen" #footer>
        <div class="catalog-panel-footer">
          <span>
            草稿 {{ previewFilterCounts.total }} 项 · 匹配 {{ previewTracks.length }} / 已加载
            {{ props.drawer.tracks.length }} 首
          </span>
          <div class="catalog-panel-footer__actions">
            <button class="catalog-panel-footer__secondary" type="button" @click="closeFilter">
              取消
            </button>
            <button type="button" @click="applyFilterDraft">应用筛选</button>
          </div>
        </div>
      </template>
    </BottomSheet>
  </Teleport>

  <Teleport
    v-if="props.operatorOverlayTarget"
    :to="props.operatorOverlayTarget"
    :disabled="!props.active"
  >
    <SidePanel
      :open="props.operatorOpen"
      :auto-focus="props.operatorAutoFocus"
      title="歌曲操作器"
      stacked-actions
      :description="`${props.drawer.title} · 已选 ${trackControls.selectedCount.value} 首`"
      :suspended="!props.active || props.panelsSuspended || isPlaylistPickerOpen"
      @close="emit('closeOperator')"
    >
      <CatalogTrackOperatorPanel
        :selected-tracks="selectedTracks"
        :selected-count="trackControls.selectedCount.value"
        :has-selected-custom-names="selectedCustomNamedIds.length > 0"
        :visible-count="trackControls.visibleItems.value.length"
        :are-all-visible-selected="trackControls.areAllVisibleSelected.value"
        :are-some-visible-selected="trackControls.areSomeVisibleSelected.value"
        :are-all-selected-favorited="areAllSelectedFavorited"
        :are-all-selected-queued="areAllSelectedQueued"
        :download-busy="props.downloadBusy"
        @toggle-all-visible="toggleAllVisible"
        @add-to-playlist="batchActions.requestAddSelectedToPlaylist"
        @add-selected-to-queue="batchActions.addSelectedToQueue"
        @download-selected="batchActions.downloadSelected"
        @add-selected-to-favorites="batchActions.addSelectedToFavorites"
        @restore-names="requestRestoreSelectedNames"
      />
    </SidePanel>
  </Teleport>

  <CatalogPlaylistPickerDialog
    :open="isPlaylistPickerOpen"
    :playlists="props.playlists"
    :selected-count="trackControls.selectedCount.value"
    :overlay-target="props.overlayTarget"
    :suspended="props.panelsSuspended"
    @close="isPlaylistPickerOpen = false"
    @select="batchActions.addSelectedToPlaylist"
  />
</template>

<style scoped>
.catalog-panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}

.catalog-panel-footer button {
  min-block-size: 38px;
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.catalog-panel-footer__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-2);
}

.catalog-panel-footer button.catalog-panel-footer__secondary {
  border-color: var(--am-color-border-strong);
  background: var(--am-color-surface);
  color: var(--am-color-text);
}

@media (max-width: 600px) {
  .catalog-panel-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .catalog-panel-footer__actions,
  .catalog-panel-footer__actions button {
    flex: 1;
  }
}
</style>
