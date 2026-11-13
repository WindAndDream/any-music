<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { CatalogTrackDisplayMode, MobileTrackColumns } from '@any-music/ui/library'
import { onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'

import CatalogDisplayModeDialog from './CatalogDisplayModeDialog.vue'

/** 排列入口在各宽度直接可达；展示偏好复用歌曲列表的同一弹窗。 */
defineProps<{
  arrangementMode: 'flat' | 'platform'
  collectionTitle?: string
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  overlayTarget: HTMLElement | null
  suspended: boolean
  hideDisplay?: boolean
  flatLabel?: string
  platformHint?: string
}>()
const emit = defineEmits<{
  updateArrangementMode: [mode: 'flat' | 'platform']
  updateDisplayMode: [mode: CatalogTrackDisplayMode]
  updateMobileColumns: [columns: MobileTrackColumns]
  modalOpenChange: [open: boolean]
}>()
// 平台详情替换工具栏结构，继续复用同一展示弹窗和受控偏好。
defineSlots<{
  default?: (props: { openDisplay: () => void }) => unknown
  navigation?: () => unknown
  actions?: () => unknown
}>()
const isDisplayOpen = shallowRef(false)
watch(isDisplayOpen, (open) => emit('modalOpenChange', open))
onDeactivated(() => {
  isDisplayOpen.value = false
})
onScopeDispose(() => emit('modalOpenChange', false))

function openDisplay(): void {
  isDisplayOpen.value = true
}

function selectArrangement(mode: 'flat' | 'platform'): void {
  emit('updateArrangementMode', mode)
}
</script>

<template>
  <div class="queue-view-controls-shell">
    <slot :open-display="openDisplay">
      <div class="queue-view-controls" :class="{ 'queue-view-controls--compact': hideDisplay }">
        <div class="queue-view-controls__arrangement">
          <slot name="navigation" />
          <div
            class="queue-view-controls__segments"
            role="group"
            :aria-label="`${collectionTitle ?? '待听'}排列方式`"
          >
            <button
              type="button"
              :aria-pressed="arrangementMode === 'flat'"
              @click="selectArrangement('flat')"
            >
              <AppIcon name="list" :size="16" />{{ flatLabel ?? '全部歌曲' }}
            </button>
            <button
              type="button"
              :aria-pressed="arrangementMode === 'platform'"
              :title="platformHint ?? '按平台整理会调整实际播放顺序'"
              @click="selectArrangement('platform')"
            >
              <AppIcon name="music" :size="16" />按平台
            </button>
          </div>
        </div>
        <div v-if="!hideDisplay || $slots.actions" class="queue-view-controls__actions">
          <button
            v-if="!hideDisplay"
            class="queue-view-controls__trigger"
            type="button"
            aria-haspopup="dialog"
            aria-label="选择歌曲展示方式"
            title="展示方式"
            @click="openDisplay"
          >
            <AppIcon name="list" :size="16" /><span class="queue-view-controls__trigger-label"
              >展示方式</span
            >
          </button>
          <slot name="actions" />
        </div>
      </div>
    </slot>
    <Teleport v-if="overlayTarget" :to="overlayTarget">
      <CatalogDisplayModeDialog
        :open="isDisplayOpen"
        :display-mode="displayMode"
        :mobile-columns="mobileColumns"
        :suspended="suspended"
        @close="isDisplayOpen = false"
        @update-display-mode="emit('updateDisplayMode', $event)"
        @update-mobile-columns="emit('updateMobileColumns', $event)"
      />
    </Teleport>
  </div>
</template>

<style scoped>
.queue-view-controls-shell {
  /* 工具栏直接参与列表布局，不被短父盒限制吸顶范围。 */
  display: contents;
}
.queue-view-controls {
  position: sticky;
  z-index: var(--am-z-sticky);
  inset-block-start: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-inline-size: 0;
  max-inline-size: 100%;
  align-items: center;
  gap: var(--am-space-2);
  margin-block-end: var(--am-space-4);
  padding-block: var(--am-space-2);
  border-block-end: 1px solid var(--am-color-border);
  background: var(--am-color-surface-subtle);
}
.queue-view-controls__arrangement {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
  min-inline-size: 0;
  justify-self: start;
}
.queue-view-controls__actions {
  display: flex;
  align-items: center;
  gap: var(--am-space-2);
}
.queue-view-controls--compact {
  grid-template-columns: minmax(0, 1fr);
}
.queue-view-controls__segments {
  display: flex;
  gap: var(--am-space-1);
  padding: var(--am-space-1);
  border: 0;
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  box-shadow: inset 0 0 0 1px var(--am-color-border);
}
.queue-view-controls button {
  display: flex;
  min-block-size: 44px;
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
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    color var(--am-motion-fast) var(--am-ease-standard);
  touch-action: manipulation;
}
.queue-view-controls__segments button {
  border: 0;
  background: transparent;
  color: var(--am-color-text-secondary);
  min-block-size: 44px;
}
.queue-view-controls button[aria-pressed='true'] {
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}
.queue-view-controls button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.queue-view-controls button:is(:hover, :focus-visible) {
  background: var(--am-color-surface-hover);
  color: var(--am-color-text);
}
.queue-view-controls button[aria-pressed='true']:is(:hover, :focus-visible) {
  color: var(--am-color-primary);
}
@container am-listen-queue (max-width: 760px) {
  .queue-view-controls {
    gap: var(--am-space-1);
  }
  .queue-view-controls__arrangement {
    inline-size: 100%;
  }
  .queue-view-controls__segments {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  }
  .queue-view-controls button {
    min-inline-size: 0;
    gap: var(--am-space-1);
    padding-inline: var(--am-space-1);
  }
  .queue-view-controls button :deep(svg) {
    flex-shrink: 0;
  }
  .queue-view-controls .queue-view-controls__trigger {
    inline-size: 44px;
    min-inline-size: 44px;
    padding-inline: 0;
  }
  .queue-view-controls__trigger-label {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .queue-view-controls button {
    transition: none;
  }
}
</style>
