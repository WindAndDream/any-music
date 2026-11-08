<script setup lang="ts">
import type { Track } from '@any-music/core'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import CollectionGrid from '@any-music/ui/components/CollectionGrid.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import { useQueueListControls } from '@any-music/ui/library'
import { useQueueReorder } from '@any-music/ui/library'
import { useTrackBatchActions } from '@any-music/ui/library'
import { useActionFeedback } from '@any-music/ui/library'
import { useAnimatedScrollToTop } from '@any-music/ui/library'
import { useCollectionNavigation } from '@any-music/ui/library'
import { useConfirmAction } from '@any-music/ui/library'
import { useEditingSession, provideEditingSession } from '@any-music/ui/library'
import { getSelectionFeedbackMessage } from '@any-music/ui/library'
import type { TrackCollectionProps, TrackCollectionEvents } from '@any-music/ui/library'
import type { TrackPlaybackState } from '@any-music/ui/library'
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onScopeDispose,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'

import CatalogPlaylistPickerDialog from './CatalogPlaylistPickerDialog.vue'
import CatalogTrackFilterPanel from './CatalogTrackFilterPanel.vue'
import CatalogTrackOperatorPanel from './CatalogTrackOperatorPanel.vue'
import QueuePlatformGroup from './QueuePlatformGroup.vue'
import QueuePlatformHeading from './QueuePlatformHeading.vue'
import QueueTrackActionsDialog from './QueueTrackActionsDialog.vue'
import QueueTrackGrid from './QueueTrackGrid.vue'
import QueueViewControls from './QueueViewControls.vue'

interface QueuePlatformGroup {
  id: string
  name: string
  tracks: readonly Track[]
  totalCount: number
  isCustom: boolean
  playbackStatus?: TrackPlaybackState['status']
}
/** 待听和喜欢复用整套集合界面；业务数据、排序与持久化由各自工作台维护。 */
const props = withDefaults(defineProps<TrackCollectionProps>(), {
  context: 'queue',
  playlists: () => [],
  queuedTrackIds: () => new Set(),
  downloadedTrackIds: () => new Set(),
  addedAtMsByTrackId: () => new Map(),
  displayMode: 'standard',
  mobileColumns: 1,
  mobileLayout: false,
  filterOpen: false,
  operatorOpen: false,
  operatorAutoFocus: true,
  panelsSuspended: false,
  overlayTarget: null,
  operatorOverlayTarget: null,
  favoriteTrackIds: () => new Set(),
  invalidTrackIds: () => new Set(),
  customTagsByTrackId: () => new Map(),
})
const emit = defineEmits<TrackCollectionEvents>()
const editing = useEditingSession(props.context)
provideEditingSession(editing)
// KeepAlive 不会自动隐藏 Teleport 的目标内容；停用时把浮层移回缓存树，保留编辑草稿。
const isActive = shallowRef(true)
onActivated(() => {
  isActive.value = true
})
const collectionTitle = computed(() => (props.context === 'favorites' ? '我的喜欢' : '待听'))
const arrangementMode = defineModel<'flat' | 'platform'>('arrangementMode', { required: true })
const scrollElement = useTemplateRef<HTMLElement>('scrollElement')
const navigation = useCollectionNavigation({
  editing,
  enabled: () => arrangementMode.value === 'platform',
  entryIds: () => [...new Set(props.items.map((track) => track.source.pluginId))],
  scrollContainer: () =>
    scrollElement.value?.closest<HTMLElement>('.music-app-shell__content') ?? null,
})
const { activeId: activePlatformId } = navigation
const controls = useQueueListControls({
  editing,
  customTags: () => props.customTagsByTrackId,
  items: () => props.items,
  addedAtMsByTrackId: () => props.addedAtMsByTrackId,
  platformNames: () => props.platformNames,
  filterOpen: () => props.filterOpen,
  platformId: activePlatformId,
})
const {
  selection,
  visibleTracks,
  displayedTracks,
  scopedItems,
  filters,
  filterCounts,
  draft,
  previewTracks,
  platformStats,
  tagStats,
  selectedTracks,
} = controls
// 待听自身就是入队事实；喜欢页则消费工作台的待听 ID 集合。
const queuedTrackIds = computed(() =>
  props.context === 'queue' ? new Set(props.items.map((track) => track.id)) : props.queuedTrackIds,
)
const selectedTracksInSelectionOrder = computed(() => {
  const byId = new Map(selectedTracks.value.map((track) => [track.id, track]))
  return [...selection.selectedIds.value].flatMap((id) => byId.get(id) ?? [])
})
const batchActions = useTrackBatchActions({
  tracks: selectedTracks,
  queueTracks: selectedTracksInSelectionOrder,
  queuedTrackIds,
  favoriteTrackIds: () => props.favoriteTrackIds,
  downloadedTrackIds: () => props.downloadedTrackIds,
  playlists: () => props.playlists,
  downloadBusy: () => props.downloadBusy,
  active: isActive,
  clearSelection: selection.clearSelection,
  addToQueue: (tracks) => emit('queueMany', tracks),
  addToFavorites: (tracks) => emit('favoriteMany', tracks),
  download: (tracks) => emit('download', tracks),
  addToPlaylist: (id, tracks) => emit('addToPlaylist', id, tracks),
})
const { isPlaylistPickerOpen } = batchActions
const confirm = useConfirmAction()
const showFeedback = useActionFeedback()
const scrollToTop = useAnimatedScrollToTop({
  container: () => scrollElement.value?.closest<HTMLElement>('.music-app-shell__content') ?? null,
  content: scrollElement,
})
defineExpose({ scrollToTop: scrollToTop.start })
const orderAnnouncement = shallowRef('')
const activeActionTrackId = shallowRef<string>()
const isViewDialogOpen = shallowRef(false)
const isFilterDetailOpen = shallowRef(false)
const visibleIds = computed(() => displayedTracks.value.map((track) => track.id))
const transitionDirection = computed(() =>
  arrangementMode.value === 'flat' ? 'back' : navigation.direction.value,
)
const platformIdByTrackId = computed(
  () => new Map(props.items.map((track) => [track.id, track.source.pluginId])),
)
const groupIds = computed(() => [
  ...new Set(visibleTracks.value.map((track) => track.source.pluginId)),
])
const reorder = useQueueReorder({
  arrangementMode,
  trackIds: visibleIds,
  platformIds: groupIds,
  scrollElement,
  getPlatformId: (id) => platformIdByTrackId.value.get(id),
  moveTrack: (id, target, ids) => {
    orderAnnouncement.value = `已调整《${props.items.find((track) => track.id === id)?.title ?? '歌曲'}》的顺序。`
    emit('move', id, target, ids)
  },
  movePlatform: (id, target, ids) => {
    orderAnnouncement.value = `已调整「${props.platformNames.get(id) ?? id}」分组的顺序。`
    emit('movePlatform', id, target, ids)
  },
})
const positions = computed(() => new Map(props.items.map((track, index) => [track.id, index + 1])))
const platformGroups = computed<readonly QueuePlatformGroup[]>(() => {
  const playbackPlatformId = props.items.find((track) => track.id === props.playbackState?.trackId)
    ?.source.pluginId
  const groups = new Map(
    platformStats.value.map((stat) => [
      stat.id,
      {
        id: stat.id,
        name: stat.name,
        totalCount: stat.count,
        isCustom: stat.isCustom,
        tracks: [] as Track[],
        playbackStatus: stat.id === playbackPlatformId ? props.playbackState?.status : undefined,
      },
    ]),
  )
  for (const track of visibleTracks.value) {
    const group = groups.get(track.source.pluginId)
    if (!group) continue
    group.tracks.push(track)
  }
  return platformStats.value.flatMap(({ id }) => {
    const group = groups.get(id)
    return group ? [group] : []
  })
})
const activePlatform = computed(() =>
  platformGroups.value.find((group) => group.id === activePlatformId.value),
)
const matchingPlatforms = computed(() =>
  platformGroups.value.filter((group) => group.tracks.length),
)
const isFiltered = computed(() => filterCounts.value.total > 0)
const activeActionTrack = computed(() =>
  visibleTracks.value.find((track) => track.id === activeActionTrackId.value),
)
const actionTrackIds = computed(() =>
  visibleTracks.value
    .filter(
      (track) =>
        arrangementMode.value === 'flat' ||
        track.source.pluginId === activeActionTrack.value?.source.pluginId,
    )
    .map((track) => track.id),
)
const actionTrackIndex = computed(() =>
  actionTrackIds.value.indexOf(activeActionTrackId.value ?? ''),
)
const pinLabel = computed(() => (arrangementMode.value === 'platform' ? '组内置顶' : '置顶'))
let generation = 0
watch(
  () => props.operatorOpen,
  (open) => {
    if (!open) selection.clearSelection()
  },
)
watch(controls.summary, (summary) => emit('summaryChange', summary), { immediate: true })
// 平台概览也使用歌曲选择与批量操作，操作器在所有待听视图均可用。
emit('operatorAvailableChange', true)
watch(
  () => Boolean(activeActionTrack.value) || isViewDialogOpen.value || isPlaylistPickerOpen.value,
  (open) => {
    reorder.clearDrag()
    emit('modalOpenChange', open)
  },
)
watch(activePlatformId, () => {
  reorder.clearDrag()
  scrollToTop.cancel()
  activeActionTrackId.value = undefined
})
watch(
  [
    () => props.filterOpen,
    () => props.operatorOpen,
    () => props.panelsSuspended,
    () => props.displayMode,
    () => props.mobileColumns,
    filters,
  ],
  () => {
    reorder.clearDrag()
  },
)
watch(
  () => props.filterOpen,
  () => {
    activeActionTrackId.value = undefined
  },
)
onDeactivated(() => {
  isActive.value = false
  generation += 1
  reorder.clearDrag()
  scrollToTop.cancel()
  activeActionTrackId.value = undefined
  emit('modalOpenChange', false)
})
onScopeDispose(() => {
  generation += 1
  emit('modalOpenChange', false)
})

function pinTrack(id: string): void {
  emit('pin', id, visibleIds.value)
  activeActionTrackId.value = undefined
}
function playTrack(id: string): void {
  if (props.context === 'favorites') {
    const track = displayedTracks.value.find((item) => item.id === id)
    if (track) emit('playCollection', track, displayedTracks.value)
  } else emit('select', id)
  activeActionTrackId.value = undefined
}
function shiftTrack(id: string, direction: -1 | 1): void {
  reorder.shift('track', id, direction)
}
function startTrackDrag(event: PointerEvent, id: string): void {
  reorder.startTrackPress(event, id)
}
function getTrackReorderStyle(id: string) {
  return reorder.getItemStyle('track', id)
}
function deactivateLeavingContent(element: Element): void {
  const root = element.getRootNode()
  const activeElement = root instanceof ShadowRoot ? root.activeElement : document.activeElement
  if (activeElement && element.contains(activeElement)) {
    // 焦点不能留在离场内容；平台导航随后恢复到标题或卡片，排列工具栏保持原位。
    scrollElement.value?.focus({ preventScroll: true })
  }
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function activateContent(element: Element): void {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
function activateView(element: Element): void {
  activateContent(element)
  navigation.prepareTransition(element)
}
async function finishViewTransition(element?: Element): Promise<void> {
  await nextTick()
  if (element?.isConnected && !element.hasAttribute('inert'))
    navigation.finishTransition(element, {
      restoreFocus: !(
        props.filterOpen ||
        props.panelsSuspended ||
        isViewDialogOpen.value ||
        activeActionTrack.value
      ),
    })
}
function applyFilterDraft(): void {
  draft.applyDraft()
  emit('closeFilter')
}
function toggleAllVisible(): void {
  selection.toggleAllVisible()
  emit('selectAllChange', selection.selectedCount.value)
  showFeedback({
    status: 'success',
    message: getSelectionFeedbackMessage(selection.selectedCount.value, '首歌曲'),
  })
}
async function requestRemoveTracks(ids: readonly string[]): Promise<void> {
  if (!ids.length) return
  activeActionTrackId.value = undefined
  const currentGeneration = generation
  const confirmed = await confirm({
    title: props.context === 'favorites' ? '取消喜欢' : '移出待听',
    message:
      props.context === 'favorites'
        ? `确定取消喜欢${ids.length === 1 ? '这首歌曲' : `已选的 ${ids.length} 首歌曲`}吗？歌曲资料和歌单关系仍会保留。`
        : `确定从待听中移出${ids.length === 1 ? '这首歌曲' : `已选的 ${ids.length} 首歌曲`}吗？这不会删除本地资料库中的歌曲。`,
    confirmLabel: props.context === 'favorites' ? '取消喜欢' : '移出歌曲',
    tone: 'danger',
  })
  if (!confirmed || currentGeneration !== generation) return
  emit('removeMany', ids)
  selection.clearSelection()
}
</script>

<template>
  <section
    class="listen-queue"
    :class="{ 'listen-queue--empty': displayedTracks.length === 0 }"
    :aria-label="props.context === 'favorites' ? '我的喜欢' : '待听列表'"
  >
    <p class="am-sr-only" role="status" aria-live="polite">{{ orderAnnouncement }}</p>
    <div
      ref="scrollElement"
      class="listen-queue__content"
      tabindex="-1"
      :class="{
        'listen-queue__content--dragging': reorder.draggedId.value !== undefined,
        'listen-queue__content--settling': reorder.isSettling.value,
      }"
    >
      <Transition
        :name="`queue-view-${transitionDirection}`"
        @before-leave="deactivateLeavingContent"
        @before-enter="activateView"
        @after-enter="finishViewTransition"
        @leave-cancelled="
          (element) => {
            activateView(element)
            finishViewTransition()
          }
        "
      >
        <div
          :key="navigation.viewKey.value"
          class="listen-queue__view"
          :class="{ 'listen-queue__view--detail': activePlatform }"
          :data-queue-platform-view="activePlatformId"
          :data-collection-view="navigation.viewKey.value"
        >
          <div class="listen-queue__surface">
            <header v-if="!props.mobileLayout && !activePlatform" class="listen-queue__header">
              <div class="listen-queue__intro">
                <h2>
                  {{ collectionTitle }}
                  <span class="listen-queue__count"
                    ><strong>{{ props.items.length }}</strong> 首</span
                  >
                </h2>
                <p>
                  {{
                    arrangementMode === 'platform'
                      ? '勾选音乐源批量操作歌曲，长按平台卡片调整顺序。'
                      : isFiltered
                        ? '长按封面拖动排序，只调整匹配歌曲，未匹配歌曲保留原位。'
                        : props.context === 'favorites'
                          ? '收藏每一首心动的音乐，长按封面调整顺序。'
                          : '把喜欢的音乐排进下一段时光，长按封面调整顺序。'
                  }}
                </p>
              </div>
            </header>
            <QueueViewControls
              :collection-title="collectionTitle"
              :arrangement-mode="arrangementMode"
              :display-mode="props.displayMode"
              :mobile-columns="props.mobileColumns"
              :overlay-target="props.overlayTarget"
              :suspended="props.panelsSuspended"
              @update-arrangement-mode="arrangementMode = $event"
              @update-display-mode="emit('updateDisplayMode', $event)"
              @update-mobile-columns="emit('updateMobileColumns', $event)"
              @modal-open-change="isViewDialogOpen = $event"
            >
              <template v-if="activePlatform" #default="{ openDisplay }">
                <QueuePlatformHeading
                  :collection-title="collectionTitle"
                  :name="activePlatform.name"
                  :total-count="activePlatform.totalCount"
                  :visible-count="displayedTracks.length"
                  :filtered="isFiltered"
                  :is-custom="activePlatform.isCustom"
                  :mobile-layout="props.mobileLayout"
                  :playback-status="activePlatform.playbackStatus"
                  @back="navigation.back"
                  @display="openDisplay"
                />
              </template>
            </QueueViewControls>
            <p v-if="props.errorMessage" class="listen-queue__error" role="alert">
              {{ props.errorMessage }}
            </p>
            <!-- 排列只替换列表内容；平台详情才替换包含标题和工具栏的整页。 -->
            <div class="listen-queue__results">
              <Transition
                :name="`queue-view-${arrangementMode === 'flat' ? 'back' : 'forward'}`"
                @before-leave="deactivateLeavingContent"
                @before-enter="activateContent"
                @leave-cancelled="activateContent"
              >
                <div :key="arrangementMode" class="listen-queue__list">
                  <MusicListEmptyState
                    v-if="!displayedTracks.length"
                    :icon="props.context === 'favorites' ? 'heart' : 'queue'"
                    :title="
                      props.items.length
                        ? `没有匹配的${props.context === 'favorites' ? '喜欢' : '待听'}歌曲`
                        : `还没有${props.context === 'favorites' ? '喜欢的' : '待听'}歌曲`
                    "
                    focus-title
                  >
                    {{
                      props.items.length
                        ? activePlatform
                          ? '调整筛选条件，或返回按平台查看其他音乐源。'
                          : '调整筛选条件，找到想听的音乐。'
                        : props.context === 'favorites'
                          ? '在发现、待听、我的歌单或自定义音乐中，喜欢心动的歌曲。'
                          : '在发现、我的喜欢、我的歌单或自定义音乐中，将想听的歌曲加入待听。'
                    }}
                  </MusicListEmptyState>
                  <QueueTrackGrid
                    :selectable="props.operatorOpen"
                    v-else-if="arrangementMode === 'flat' || activePlatform"
                    :animate="!reorder.isSettling.value"
                    :tracks="displayedTracks"
                    :custom-tags-by-track-id="props.customTagsByTrackId"
                    :date-label="props.context === 'favorites' ? '喜欢' : '添加'"
                    :positions="positions"
                    :platform-names="props.platformNames"
                    :added-at-ms-by-track-id="props.addedAtMsByTrackId"
                    :current-track-id="props.currentTrackId"
                    :selected-ids="selection.selectedIds.value"
                    :dragged-id="reorder.draggedId.value"
                    :get-reorder-style="getTrackReorderStyle"
                    :favorite-track-ids="props.favoriteTrackIds"
                    :invalid-track-ids="props.invalidTrackIds"
                    :download-busy="props.downloadBusy"
                    :display-mode="props.displayMode"
                    :mobile-columns="props.mobileColumns"
                    @select="selection.toggleItem"
                    @play="playTrack"
                    @favorite="emit('favorite', $event)"
                    @download="emit('download', [$event])"
                    @show-actions="activeActionTrackId = $event"
                    @drag-start="startTrackDrag"
                    @shift="shiftTrack"
                    @drag-cancel="reorder.clearDrag"
                  />
                  <CollectionGrid v-else class="listen-queue__groups">
                    <TransitionGroup name="queue-group-sort">
                      <QueuePlatformGroup
                        :selectable="props.operatorOpen"
                        v-for="group in matchingPlatforms"
                        :key="group.id"
                        :platform-id="group.id"
                        :name="group.name"
                        :count="group.tracks.length"
                        :total-count="group.totalCount"
                        :filtered="isFiltered"
                        :is-custom="group.isCustom"
                        :selected="
                          controls.platformSelection.value.get(group.id)?.selected ?? false
                        "
                        :indeterminate="
                          controls.platformSelection.value.get(group.id)?.indeterminate ?? false
                        "
                        :playback-status="group.playbackStatus"
                        :dragging="
                          reorder.dragKind.value === 'platform' &&
                          reorder.draggedId.value === group.id
                        "
                        :reorder-style="reorder.getItemStyle('platform', group.id)"
                        @open="navigation.open(group.id)"
                        @select="controls.togglePlatform(group.id)"
                        @drag-start="reorder.startPlatformPress"
                        @shift="(id, direction) => reorder.shift('platform', id, direction)"
                        @drag-cancel="reorder.clearDrag"
                      />
                    </TransitionGroup>
                  </CollectionGrid>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </Transition>
    </div>
    <Teleport v-if="props.overlayTarget" :to="props.overlayTarget" :disabled="!isActive">
      <BottomSheet
        :open="props.filterOpen"
        :title="`${collectionTitle}筛选器`"
        :description="`按文本、标签、歌曲时长、${activePlatformId === undefined ? '平台与' : ''}${props.context === 'favorites' ? '喜欢' : '添加'}日期找到${props.context === 'favorites' ? '喜欢' : '想听'}的歌曲。`"
        size="full"
        :suspended="!isActive || props.panelsSuspended"
        @close="emit('closeFilter')"
      >
        <CatalogTrackFilterPanel
          v-if="props.filterOpen"
          v-model:filters="draft.draft.value"
          :history-scope="`${props.context}:tracks`"
          :filter-context="props.context"
          :tag-stats="tagStats"
          :platform-scoped="activePlatformId !== undefined"
          :platform-stats="platformStats"
          :result-count="previewTracks.length"
          :total-count="scopedItems.length"
          @detail-open-change="isFilterDetailOpen = $event"
          @preview-change="draft.preview.value = $event"
        />
        <template v-if="!isFilterDetailOpen" #footer>
          <div class="listen-queue__filter-footer">
            <span>匹配 {{ previewTracks.length }} / 共 {{ scopedItems.length }} 首</span>
            <div>
              <button type="button" @click="emit('closeFilter')">取消</button
              ><button class="listen-queue__apply" type="button" @click="applyFilterDraft">
                应用筛选
              </button>
            </div>
          </div>
        </template>
      </BottomSheet>
      <QueueTrackActionsDialog
        :playlists="props.playlists"
        @add-to-playlist="(track, id) => emit('addToPlaylist', id, [track])"
        :context="props.context"
        :queued="props.queuedTrackIds.has(activeActionTrack?.id ?? '')"
        :track="activeActionTrack"
        :pin-label="pinLabel"
        :suspended="!isActive || props.panelsSuspended"
        :favorite="props.favoriteTrackIds.has(activeActionTrack?.id ?? '')"
        :invalid="props.invalidTrackIds.has(activeActionTrack?.id ?? '')"
        :custom-tags="props.customTagsByTrackId.get(activeActionTrack?.id ?? '') ?? []"
        :download-busy="props.downloadBusy"
        :can-move-up="actionTrackIndex > 0"
        :can-move-down="actionTrackIndex >= 0 && actionTrackIndex < actionTrackIds.length - 1"
        @close="activeActionTrackId = undefined"
        @play="playTrack"
        @queue="emit('queue', $event)"
        @pin="pinTrack"
        @remove="requestRemoveTracks([$event])"
        @shift="shiftTrack"
        @favorite="emit('favorite', $event)"
        @compose="emit('compose', $event)"
        @add-tag="(track, tag) => emit('addTag', track, tag)"
        @remove-tag="(track, tag) => emit('removeTag', track, tag)"
        @rename="(track, name) => emit('rename', track, name)"
        @download="emit('download', $event)"
      />
    </Teleport>
    <Teleport
      v-if="props.operatorOverlayTarget"
      :to="props.operatorOverlayTarget"
      :disabled="!isActive"
    >
      <SidePanel
        :open="props.operatorOpen"
        :auto-focus="props.operatorAutoFocus"
        :title="`${collectionTitle}操作器`"
        stacked-actions
        :description="`已选 ${selection.selectedCount.value} 首`"
        :suspended="
          !isActive ||
          props.panelsSuspended ||
          Boolean(activeActionTrack) ||
          isViewDialogOpen ||
          isPlaylistPickerOpen
        "
        @close="emit('closeOperator')"
      >
        <CatalogTrackOperatorPanel
          :selected-tracks="selectedTracks"
          :context="props.context"
          :selected-count="selection.selectedCount.value"
          :visible-count="displayedTracks.length"
          :are-all-visible-selected="selection.areAllVisibleSelected.value"
          :are-some-visible-selected="selection.areSomeVisibleSelected.value"
          :download-busy="props.downloadBusy"
          :are-all-selected-queued="batchActions.areAllSelectedQueued.value"
          :are-all-selected-favorited="batchActions.areAllSelectedFavorited.value"
          @toggle-all-visible="toggleAllVisible"
          @download-selected="batchActions.downloadSelected"
          @add-selected-to-queue="batchActions.addSelectedToQueue"
          @add-selected-to-favorites="batchActions.addSelectedToFavorites"
          @add-to-playlist="batchActions.requestAddSelectedToPlaylist"
          @remove-selected="requestRemoveTracks([...selection.selectedIds.value])"
        />
      </SidePanel>
    </Teleport>
    <CatalogPlaylistPickerDialog
      :open="isActive && isPlaylistPickerOpen"
      :playlists="props.playlists"
      :selected-count="selection.selectedCount.value"
      :overlay-target="props.overlayTarget"
      :suspended="props.panelsSuspended"
      @close="isPlaylistPickerOpen = false"
      @select="batchActions.addSelectedToPlaylist"
    />
  </section>
</template>

<style scoped>
.listen-queue {
  --am-queue-padding: clamp(var(--am-space-4), 2.2cqi, var(--am-space-7));
  --am-catalog-page-padding: var(--am-queue-padding);
  container: am-listen-queue / inline-size;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  inline-size: 100%;
  min-block-size: 0;
  min-inline-size: 0;
  background: var(--am-color-background);
  /* 只裁切排序位移溢出，页面竖向滚动仍由壳层负责。 */
  overflow-x: clip;
}
.listen-queue__view {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  inline-size: 100%;
  min-inline-size: 0;
  padding: var(--am-queue-padding);
  padding-block-end: max(var(--am-queue-padding), var(--am-space-6));
  background: var(--am-color-background);
}
.listen-queue__view--detail {
  padding-block-start: 0;
}
.listen-queue__surface {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  inline-size: 100%;
  padding: var(--am-space-4) var(--am-space-3);
  background: var(--am-color-surface-subtle);
}
.listen-queue__view--detail .listen-queue__surface {
  padding-block-start: 0;
}
.listen-queue__header {
  margin-block-end: var(--am-space-3);
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: var(--am-space-4);
}
.listen-queue__intro {
  min-inline-size: 0;
  flex: 1 1 180px;
}
.listen-queue__intro h2 {
  /* 与歌曲页上下文共用标题行尺寸，徽标与标题垂直居中。 */
  display: flex;
  min-block-size: 44px;
  align-items: center;
  gap: var(--am-space-3);
  margin: 0 0 var(--am-space-2);
  color: var(--am-color-text);
  font-size: var(--am-font-size-md);
}
.listen-queue__intro h2 span {
  display: inline-flex;
  align-items: baseline;
  gap: var(--am-space-1);
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-sm);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.listen-queue__count strong {
  font-size: var(--am-font-size-lg);
  font-weight: 750;
}
.listen-queue__intro p {
  margin: 0;
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}
.listen-queue__content {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  min-inline-size: 0;
  position: relative;
  padding-block-end: var(--am-space-2);
  overflow-x: clip;
}
/* 内容容器持有指针捕获，覆盖子控件光标，让歌曲与平台排序保持一致。 */
.listen-queue .listen-queue__content--dragging,
.listen-queue .listen-queue__content--dragging :deep(*) {
  cursor: move;
}
.listen-queue__results {
  position: relative;
  /* 两种排列共享入场视图决定的高度，离场列表不再撑高灰色表面。 */
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-inline-size: 0;
  overflow-x: clip;
}
.listen-queue__list {
  grid-area: 1 / 1;
  inline-size: 100%;
  min-inline-size: 0;
}
.listen-queue--empty .listen-queue__content {
  /* 空态尾部留白统一由 view 保留，与发现页的背景边距对齐。 */
  padding-block-end: 0;
}
.listen-queue--empty .listen-queue__list {
  /* 空态沿壳层可用高度伸展，外层 view 的底部留白始终保留。 */
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
}
.listen-queue--empty .listen-queue__results {
  flex: 1 0 auto;
}
.listen-queue--empty .listen-queue__header {
  flex: none;
}
.listen-queue__error {
  margin: 0;
  padding: var(--am-space-3);
  border-radius: var(--am-radius-control);
  color: var(--am-color-danger);
  background: var(--am-color-surface);
}
.listen-queue__filter-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.listen-queue__filter-footer > div {
  display: flex;
  gap: var(--am-space-2);
}
.listen-queue__filter-footer button {
  min-block-size: 44px;
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.listen-queue__filter-footer .listen-queue__apply {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}
.listen-queue button:focus-visible,
.listen-queue__filter-footer button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
@container am-listen-queue (max-width: 600px) {
  .listen-queue__header {
    gap: var(--am-space-3);
  }
  .listen-queue__groups {
    gap: var(--am-space-2);
  }
}
@media (max-width: 600px) {
  .listen-queue__filter-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .listen-queue__filter-footer > div,
  .listen-queue__filter-footer button {
    flex: 1;
  }
}

.queue-view-forward-enter-active,
.queue-view-forward-leave-active,
.queue-view-back-enter-active,
.queue-view-back-leave-active {
  transition:
    transform var(--am-motion-slow) var(--am-ease-emphasized),
    opacity var(--am-motion-slow) var(--am-ease-standard);
}
.queue-view-forward-leave-active,
.queue-view-back-leave-active {
  position: absolute;
  inset: 0;
  overflow: clip;
}
.queue-view-forward-enter-from,
.queue-view-back-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
.queue-view-forward-leave-to,
.queue-view-back-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}
.listen-queue__view[aria-hidden='true'],
.listen-queue__list[aria-hidden='true'] {
  pointer-events: none;
}

@media (prefers-reduced-motion: no-preference) {
  .queue-group-sort-move {
    transition: transform var(--am-motion-normal) var(--am-ease-emphasized);
  }
}
@media (prefers-reduced-motion: reduce) {
  .queue-view-forward-enter-active,
  .queue-view-forward-leave-active,
  .queue-view-back-enter-active,
  .queue-view-back-leave-active {
    transition: none;
  }
}
/* 拖动时内层已完成让位；提交那一帧只调整稳定外层，避免再播放一次反向位移。 */
.listen-queue__content--settling :deep(.queue-track__surface),
.listen-queue__content--settling .queue-group-sort-move,
.listen-queue__content--settling :deep(.queue-platform-group__surface) {
  transition: none;
}
</style>
