<script setup lang="ts">
import type { AppErrorState } from '@any-music/core'
import { useEditingSession } from '@any-music/ui'
import type { CatalogFilterHistorySettings } from '@any-music/ui'
import { useCatalogFilterHistorySettings } from '@any-music/ui'
import { FILTER_HISTORY_SETTINGS_GROUPS, type FilterHistorySettingsRegion } from '@any-music/ui'
import type { ProductViewId } from '@any-music/ui'
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import { onMounted, onScopeDispose, shallowRef, useId } from 'vue'

import CatalogFilterHistoryRegionDialog from './CatalogFilterHistoryRegionDialog.vue'
import { expandedGroupKey, selectedRegionKey, regionOpenKey } from './settings-editing-state'

/** 只展示板块和区域摘要；输入表单按需打开，草稿保留到本次设置会话结束。 */
const props = defineProps<{
  isMobileLayout?: boolean
  overlayTarget?: HTMLElement | null
  suspended?: boolean
  settings?: CatalogFilterHistorySettings
  setSettings?: (settings: CatalogFilterHistorySettings) => AppErrorState | void
}>()
const emit = defineEmits<{ detailOpenChange: [isOpen: boolean] }>()
const accessibleId = useId()
const editing = useEditingSession('settings')
const expandedGroupId = editing.state(expandedGroupKey, () =>
  shallowRef<ProductViewId | null>(null),
)
const selectedRegion = editing.state(selectedRegionKey, () =>
  shallowRef<FilterHistorySettingsRegion | null>(null),
)
const isRegionDialogOpen = editing.state(regionOpenKey, () => shallowRef(false))
const {
  regions,
  feedbackByContext,
  hasUnsavedChangesByContext,
  summariesByContext,
  submitSettings,
} = useCatalogFilterHistorySettings(
  props.settings && props.setSettings
    ? {
        settings: () => props.settings,
        save: (settings) => props.setSettings?.(settings),
      }
    : undefined,
)

function toggleGroup(id: ProductViewId): void {
  expandedGroupId.value = expandedGroupId.value === id ? null : id
}

function openRegion(region: FilterHistorySettingsRegion): void {
  selectedRegion.value = region
  isRegionDialogOpen.value = true
  emit('detailOpenChange', true)
}

function closeRegion(): void {
  // 离场转场仍展示当前区域，真正卸载表单由浮层的 Transition 负责。
  isRegionDialogOpen.value = false
  emit('detailOpenChange', false)
}

onScopeDispose(() => emit('detailOpenChange', false))
onMounted(() => {
  if (isRegionDialogOpen.value) emit('detailOpenChange', true)
})
</script>

<template>
  <div class="filter-history-settings">
    <p class="settings-form__hint">选择筛选区域，调整历史数量。</p>
    <section
      v-for="group in FILTER_HISTORY_SETTINGS_GROUPS"
      :key="group.id"
      class="settings-form__card filter-history-settings__group"
      :aria-labelledby="`${accessibleId}-${group.id}-title`"
    >
      <h4 class="filter-history-settings__heading">
        <button
          class="filter-history-settings__toggle"
          type="button"
          :aria-expanded="expandedGroupId === group.id"
          :aria-controls="`${accessibleId}-${group.id}-regions`"
          @click="toggleGroup(group.id)"
        >
          <AppIcon name="list" :size="20" />
          <span class="filter-history-settings__copy">
            <strong :id="`${accessibleId}-${group.id}-title`">{{ group.title }}</strong>
            <small>{{ group.regions.length }} 个区域</small>
          </span>
          <AppIcon class="filter-history-settings__chevron" name="arrow-right" :size="18" />
        </button>
      </h4>
      <div
        :id="`${accessibleId}-${group.id}-regions`"
        class="filter-history-settings__regions"
        :aria-hidden="expandedGroupId !== group.id"
        :inert="expandedGroupId !== group.id ? true : undefined"
      >
        <div class="filter-history-settings__regions-clip">
          <div class="filter-history-settings__region-list">
            <button
              v-for="region in group.regions"
              :key="region.context"
              :data-am-focus-key="`settings:filter-history:${region.context}`"
              class="filter-history-settings__entry"
              type="button"
              aria-haspopup="dialog"
              :aria-label="`配置${region.title}`"
              @click="openRegion(region)"
            >
              <span class="filter-history-settings__copy">
                <strong>{{ region.title }}</strong>
                <small>
                  {{ summariesByContext[region.context].dimensionCount }} 项筛选 · 默认显示
                  {{ summariesByContext[region.context].collapseAfter }} 组
                </small>
              </span>
              <span class="filter-history-settings__trailing">
                <span
                  v-if="hasUnsavedChangesByContext[region.context]"
                  class="filter-history-settings__draft"
                  >未保存</span
                >
                <AppIcon name="arrow-right" :size="18" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
  <!-- 留在产品 Shadow Root 的浮层宿主，避开设置子页的滚动裁切与移动端 transform。 -->
  <Teleport :to="props.overlayTarget ?? 'body'" :disabled="!props.overlayTarget">
    <CatalogFilterHistoryRegionDialog
      :open="isRegionDialogOpen"
      :region="selectedRegion"
      :model-value="selectedRegion ? regions[selectedRegion.context] : undefined"
      :is-mobile-layout="props.isMobileLayout"
      :suspended="props.suspended"
      :has-unsaved-changes="
        selectedRegion ? hasUnsavedChangesByContext[selectedRegion.context] : false
      "
      :status-message="
        selectedRegion ? feedbackByContext[selectedRegion.context].statusMessage : ''
      "
      :error-message="selectedRegion ? feedbackByContext[selectedRegion.context].errorMessage : ''"
      @update:model-value="selectedRegion && (regions[selectedRegion.context] = $event)"
      @save="selectedRegion && submitSettings(selectedRegion.context)"
      @close="closeRegion"
    />
  </Teleport>
</template>

<style scoped>
.filter-history-settings {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-4);
}
.filter-history-settings__group {
  gap: 0;
  min-inline-size: 0;
  padding: 0;
}
.filter-history-settings__heading {
  margin: 0;
  font: inherit;
}
.filter-history-settings__toggle,
.filter-history-settings__entry {
  display: grid;
  inline-size: 100%;
  min-block-size: 64px;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-4);
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
  font-size: var(--am-font-size-sm);
  text-align: start;
  cursor: pointer;
}
.filter-history-settings__toggle {
  grid-template-columns: auto minmax(0, 1fr) auto;
}
.filter-history-settings__toggle > :first-child {
  color: var(--am-color-primary);
}
.filter-history-settings__copy {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
  overflow-wrap: anywhere;
}
.filter-history-settings__copy strong {
  font-weight: 600;
}
.filter-history-settings__copy small {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  line-height: 1.6;
}
.filter-history-settings__draft {
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
  font-size: var(--am-font-size-xs);
  white-space: nowrap;
}
.filter-history-settings__trailing {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
}
.filter-history-settings__regions {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
  transition:
    grid-template-rows var(--am-motion-normal) var(--am-ease-standard),
    opacity var(--am-motion-normal) var(--am-ease-standard),
    visibility 0s linear var(--am-motion-normal);
}
.filter-history-settings__regions[aria-hidden='false'] {
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}
/* 裁切层让任意高度的区域平滑收拢，折叠时由 inert 立即阻止交互。 */
.filter-history-settings__regions-clip {
  min-block-size: 0;
  overflow: hidden;
}
.filter-history-settings__region-list {
  display: grid;
  margin: var(--am-space-3) var(--am-space-4) var(--am-space-4);
  overflow: hidden;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
}
.filter-history-settings__entry {
  grid-template-columns: minmax(0, 1fr) auto;
  padding: var(--am-space-3);
  border-radius: 0;
}
.filter-history-settings__entry + .filter-history-settings__entry {
  border-block-start: 1px solid var(--am-color-border);
}
.filter-history-settings__entry > :last-child,
.filter-history-settings__chevron {
  color: var(--am-color-text-secondary);
}
.filter-history-settings__chevron {
  transition: transform var(--am-motion-fast) var(--am-ease-standard);
}
.filter-history-settings__toggle[aria-expanded='true'] .filter-history-settings__chevron {
  transform: rotate(90deg);
}
.filter-history-settings__toggle:hover,
.filter-history-settings__entry:hover {
  background: var(--am-color-hover);
}
.filter-history-settings__toggle:focus-visible,
.filter-history-settings__entry:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
@media (prefers-reduced-motion: reduce) {
  .filter-history-settings__regions,
  .filter-history-settings__chevron {
    transition: none;
  }
}
</style>
