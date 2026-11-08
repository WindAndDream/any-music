<script setup lang="ts">
import type { UiCatalogDrawerListProps, UiCatalogDrawerListEmits } from '@any-music/ui/catalog'
import { useCatalogDrawerList } from '@any-music/ui/catalog'
import { useCatalogDrawerReorder } from '@any-music/ui/catalog'
import { useActionFeedback } from '@any-music/ui/catalog'
import { useConfirmAction } from '@any-music/ui/catalog'
import { provideEditingSession, useEditingSession } from '@any-music/ui/catalog'
import { getSelectionFeedbackMessage } from '@any-music/ui/catalog'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import MusicListEmptyState from '@any-music/ui/components/music-sources/MusicListEmptyState.vue'
import SidePanel from '@any-music/ui/components/SidePanel.vue'
import { shallowRef, useTemplateRef, watch } from 'vue'

import CatalogDrawerCard from './CatalogDrawerCard.vue'
import CatalogDrawerListHeader from './CatalogDrawerListHeader.vue'
import CatalogDrawerOperatorPanel from './CatalogDrawerOperatorPanel.vue'
import CatalogTrackFilterPanel from './CatalogTrackFilterPanel.vue'

/** 音乐列表仅组合卡片、状态分组和受控底部面板；筛选、多选与确认由 headless 状态管理。 */
const props = withDefaults(defineProps<UiCatalogDrawerListProps>(), {
  active: true,
  filterOpen: false,
  discoveryInHeader: false,
  operatorOpen: false,
  operatorAutoFocus: true,
  panelsSuspended: false,
  overlayTarget: null,
  operatorOverlayTarget: null,
})
const emit = defineEmits<UiCatalogDrawerListEmits>()
defineSlots<{
  /** 会话由运行端投影，列表不读取平台状态。 */
  session?: () => unknown
  'title-actions'?: () => unknown
}>()
provideEditingSession(useEditingSession('catalog-lists'))
const {
  stateFilter,
  filterDraft,
  filterPreview,
  draftFilterCount,
  availableCount,
  unavailableCount,
  attentionCount,
  stateFilteredDrawers,
  platformStats,
  previewDrawers,
  controls,
  summary,
  hasSelectedCustomNames,
  applyFilterDraft,
  requestRemoveSelectedDrawers,
  requestRestoreSelectedNames,
} = useCatalogDrawerList({
  drawers: () => props.drawers,
  invalidTrackIds: () => props.invalidTrackIds,
  filterOpen: () => props.filterOpen,
  confirm: useConfirmAction(),
  removeMany: (drawerIds) => emit('removeMany', drawerIds),
  restoreNames: (drawerIds) => emit('restoreNames', drawerIds),
})
const isFilterDetailOpen = shallowRef(false)
const grid = useTemplateRef<HTMLElement>('grid')
const orderAnnouncement = shallowRef('')
const stateTransition = shallowRef('catalog-state-forward')
const stateOrder = ['all', 'available', 'unavailable', 'attention']
const reorder = useCatalogDrawerReorder({
  drawers: controls.visibleItems,
  element: grid,
  suspended: () => props.filterOpen || props.panelsSuspended,
  move: (id, target, ids) => {
    orderAnnouncement.value = `已调整「${props.drawers.find((drawer) => drawer.id === id)?.title ?? '音乐列表'}」的顺序。`
    emit('move', id, target, ids)
  },
})
watch(
  () => props.operatorOpen,
  (open) => {
    if (!open) controls.clearSelection()
  },
)
watch(
  stateFilter,
  (next, previous) => {
    reorder.cancel()
    stateTransition.value =
      stateOrder.indexOf(next) > stateOrder.indexOf(previous)
        ? 'catalog-state-forward'
        : 'catalog-state-back'
  },
  { flush: 'sync' },
)
watch(() => props.operatorOpen, reorder.cancel)
const showFeedback = useActionFeedback()
function toggleAllVisible(): void {
  controls.toggleAllVisible()
  emit('toggleAllVisible', controls.selectedCount.value)
  showFeedback({
    status: 'success',
    message: getSelectionFeedbackMessage(controls.selectedCount.value, '个音乐列表'),
  })
}
watch(summary, (value) => emit('summaryChange', value), { immediate: true })
function applyFilters(): void {
  applyFilterDraft()
  emit('closeFilter')
}
function requestDiscovery(): void {
  emit('closeOperator')
  emit('discover')
}
function deactivateResults(element: Element): void {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function activateResults(element: Element): void {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
</script>

<template>
  <div
    class="catalog-drawers"
    :class="{ 'catalog-drawers--empty': controls.visibleItems.value.length === 0 }"
  >
    <CatalogDrawerListHeader
      v-model:state-filter="stateFilter"
      :total-count="props.drawers.length"
      :available-count="availableCount"
      :unavailable-count="unavailableCount"
      :attention-count="attentionCount"
      :discovery-label="props.discoveryLabel"
      :discovery-in-header="props.discoveryInHeader"
      @discover="requestDiscovery"
    >
      <template v-if="$slots.session" #session><slot name="session" /></template>
      <template v-if="$slots['title-actions']" #title-actions
        ><slot name="title-actions"
      /></template>
    </CatalogDrawerListHeader>
    <div class="catalog-drawers__stage">
      <Transition
        :name="stateTransition"
        @before-leave="deactivateResults"
        @before-enter="activateResults"
        @leave-cancelled="activateResults"
      >
        <div :key="stateFilter" class="catalog-drawers__results">
          <MusicListEmptyState
            v-if="props.drawers.length === 0"
            icon="search"
            title="还没有音乐列表"
          >
            {{ props.discoveryInHeader ? '点击顶部的' : '打开底部“操作器”，点击' }}“{{
              props.discoveryLabel
            }}”查找歌曲、作者或导入来源链接。
          </MusicListEmptyState>
          <MusicListEmptyState
            v-else-if="controls.visibleItems.value.length === 0"
            icon="search"
            title="没有匹配的音乐列表"
          >
            在筛选器中调整文本、平台、命名或搜索时间，或切换“全部 / 可用 / 不可用 / 错误”状态。
          </MusicListEmptyState>
          <div
            v-else
            ref="grid"
            class="catalog-drawers__grid"
            :class="{
              'catalog-drawers__grid--dragging': reorder.draggedId.value,
              'catalog-drawers__grid--settling': reorder.isSettling.value,
            }"
          >
            <!-- 卡片按实际网格单元宽度适配，不依赖整页或工作台断点。 -->
            <div
              v-for="drawer in controls.visibleItems.value"
              :key="drawer.id"
              class="catalog-drawers__cell"
              :class="{ 'catalog-drawers__cell--dragging': reorder.draggedId.value === drawer.id }"
              data-catalog-drop-kind="drawer"
              :data-catalog-drop-id="drawer.id"
            >
              <CatalogDrawerCard
                :selectable="props.operatorOpen"
                :drawer="drawer"
                :selected="controls.selectedIds.value.has(drawer.id)"
                :dragging="reorder.draggedId.value === drawer.id"
                :reorder-style="reorder.getItemStyle('drawer', drawer.id)"
                @press-start="reorder.startPress"
                @shift="(id, direction) => reorder.shift('drawer', id, direction)"
                @drag-cancel="reorder.cancel"
                @view="emit('view', $event)"
                @show-error="emit('showError', $event)"
                @show-actions="emit('showActions', $event)"
                @select="controls.toggleItem"
              />
            </div>
          </div>
        </div>
      </Transition>
    </div>
    <p class="am-sr-only" role="status" aria-live="polite">{{ orderAnnouncement }}</p>

    <!-- 筛选为模态草稿，操作器为播放器上方的非模态区域，宿主及层级与歌曲页一致。 -->
    <Teleport v-if="props.overlayTarget" :to="props.overlayTarget" :disabled="!props.active">
      <BottomSheet
        :open="props.filterOpen"
        title="音乐列表筛选器"
        description="筛选已有列表，不会重新搜索或导入。"
        size="full"
        :suspended="!props.active || props.panelsSuspended"
        @close="emit('closeFilter')"
      >
        <CatalogTrackFilterPanel
          v-model:filters="filterDraft"
          history-scope="catalog:drawers"
          filter-context="drawers"
          :tag-stats="[]"
          :platform-stats="platformStats"
          :result-count="previewDrawers.length"
          :total-count="stateFilteredDrawers.length"
          @detail-open-change="isFilterDetailOpen = $event"
          @preview-change="filterPreview = $event"
        />
        <template v-if="!isFilterDetailOpen" #footer>
          <div class="catalog-list-filter-footer">
            <span
              >草稿 {{ draftFilterCount }} 项 · 匹配 {{ previewDrawers.length }} /
              {{ stateFilteredDrawers.length }} 个列表</span
            >
            <div class="catalog-list-filter-footer__actions">
              <button
                class="catalog-list-filter-footer__cancel"
                type="button"
                @click="emit('closeFilter')"
              >
                取消
              </button>
              <button type="button" @click="applyFilters">应用筛选</button>
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
        title="音乐列表操作器"
        stacked-actions
        :description="`已选 ${summary.selectedCount} 个 · 匹配 ${summary.visibleCount} 个列表`"
        :suspended="!props.active || props.panelsSuspended"
        @close="emit('closeOperator')"
      >
        <CatalogDrawerOperatorPanel
          :selected-count="summary.selectedCount"
          :has-selected-custom-names="hasSelectedCustomNames"
          :visible-count="summary.visibleCount"
          :are-all-visible-selected="controls.areAllVisibleSelected.value"
          :are-some-visible-selected="controls.areSomeVisibleSelected.value"
          :discovery-label="props.discoveryLabel"
          :show-discovery="!props.discoveryInHeader"
          @toggle-all-visible="toggleAllVisible"
          @remove-selected="requestRemoveSelectedDrawers"
          @restore-names="requestRestoreSelectedNames"
          @discover="requestDiscovery"
        />
      </SidePanel>
    </Teleport>
  </div>
</template>

<style scoped>
.catalog-drawers__stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-inline-size: 0;
  flex: 1;
  overflow-x: clip;
}
.catalog-drawers__results {
  grid-area: 1 / 1;
  inline-size: 100%;
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  min-block-size: 0;
  flex: 1;
}
.catalog-state-forward-enter-active,
.catalog-state-forward-leave-active,
.catalog-state-back-enter-active,
.catalog-state-back-leave-active {
  transition:
    transform var(--am-motion-slow) var(--am-ease-emphasized),
    opacity var(--am-motion-slow) var(--am-ease-standard);
}
.catalog-state-forward-enter-from,
.catalog-state-back-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
.catalog-state-forward-leave-to,
.catalog-state-back-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}
.catalog-drawers__results[aria-hidden='true'] {
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .catalog-state-forward-enter-active,
  .catalog-state-forward-leave-active,
  .catalog-state-back-enter-active,
  .catalog-state-back-leave-active {
    transition: none;
  }
}
.catalog-drawers {
  container: am-catalog-list / inline-size;
  min-inline-size: 0;
  /* Fill short lists as well as empty states; the outer page keeps the bottom spacing. */
  flex: 1 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: max-content;
  gap: var(--am-space-4);
  padding: var(--am-space-4) var(--am-space-3);
  background: var(--am-color-surface-subtle);
}
.catalog-drawers--empty {
  /* 空态内容沿弹性链铺满；有列表时仍按网格固有行高排列。 */
  display: flex;
  flex-direction: column;
}
.catalog-list-filter-footer button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.catalog-drawers__grid {
  display: grid;
  /* 保留空列，宽屏不设列数上限，窄容器的单项始终不超过可用宽度。 */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: var(--am-space-4);
}
.catalog-drawers__cell {
  container: am-catalog-card / inline-size;
  min-inline-size: 0;
  position: relative;
}
.catalog-drawers__cell--dragging {
  z-index: 2;
}
/* 网格持有指针捕获，空隙与卡片子控件都使用同一个排序光标。 */
.catalog-drawers__grid--dragging,
.catalog-drawers__grid--dragging .catalog-drawers__cell,
.catalog-drawers__grid--dragging :deep(.catalog-card),
.catalog-drawers__grid--dragging :deep(.catalog-card *) {
  cursor: move;
  user-select: none;
}
.catalog-drawers__grid--settling :deep(.catalog-card) {
  transition: none;
}
.catalog-list-filter-footer,
.catalog-list-filter-footer__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
}
.catalog-list-filter-footer {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
}
.catalog-list-filter-footer button {
  min-block-size: 44px;
  padding-inline: var(--am-space-4);
  border: 1px solid var(--am-color-primary);
  border-radius: var(--am-radius-control);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
.catalog-list-filter-footer button.catalog-list-filter-footer__cancel {
  border-color: var(--am-color-border-strong);
  background: var(--am-color-surface);
  color: var(--am-color-text);
}
@container am-catalog-list (max-width: 680px) {
  .catalog-drawers__grid {
    gap: var(--am-space-3);
  }
}
@media (max-width: 600px) {
  .catalog-drawers:not(.catalog-drawers--empty) {
    /* 空态与待听、喜欢共用表面内边距；有列表时才增加滚动尾部空间。 */
    padding-block-end: var(--am-space-8);
  }
  .catalog-list-filter-footer {
    align-items: stretch;
    flex-direction: column;
  }
  .catalog-list-filter-footer__actions {
    justify-content: flex-end;
  }
}
</style>
