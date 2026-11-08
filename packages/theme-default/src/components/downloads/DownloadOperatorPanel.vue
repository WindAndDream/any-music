<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'

import CatalogOperatorActions from '../music-sources/CatalogOperatorActions.vue'

withDefaults(
  defineProps<{
    selectedCount: number
    visibleCount: number
    allSelected: boolean
    someSelected: boolean
    actionLabel: string
    canResume: boolean
    canRetry?: boolean
    canPause: boolean
    canCancel: boolean
    canRemove: boolean
  }>(),
  { canRetry: undefined },
)
const emit = defineEmits<{
  toggleAll: []
  resume: []
  pause: []
  cancel: []
  remove: []
  retry: []
}>()
</script>

<template>
  <div class="download-operator">
    <div class="download-operator__manage">
      <label class="download-operator__selection">
        <input
          type="checkbox"
          :checked="allSelected"
          :indeterminate="someSelected"
          :disabled="!visibleCount"
          aria-label="全选当前匹配下载任务"
          @change="emit('toggleAll')"
        />
        <span>全选</span>
        <strong>已选 {{ selectedCount }} 首</strong>
      </label>
    </div>
    <CatalogOperatorActions>
      <button type="button" :disabled="!canResume" @click="emit('resume')">
        <AppIcon name="download" :size="18" /><span>{{ actionLabel }}</span>
      </button>
      <button
        v-if="canRetry !== undefined"
        type="button"
        :disabled="!canRetry"
        @click="emit('retry')"
      >
        <AppIcon name="refresh" :size="18" /><span>重试已选</span>
      </button>
      <button type="button" :disabled="!canPause" @click="emit('pause')">
        <AppIcon name="pause" :size="18" /><span>暂停下载</span>
      </button>
      <button type="button" :disabled="!canCancel" @click="emit('cancel')">
        <AppIcon name="close" :size="18" /><span>取消下载</span>
      </button>
      <button
        class="download-operator__remove"
        type="button"
        :disabled="!canRemove"
        @click="emit('remove')"
      >
        <AppIcon name="trash" :size="18" /><span>移除记录</span>
      </button>
    </CatalogOperatorActions>
  </div>
</template>

<style scoped>
.download-operator {
  display: grid;
  inline-size: 100%;
  min-inline-size: 0;
  grid-template-rows: repeat(2, 44px);
  align-content: center;
  gap: var(--am-space-2);
}
.download-operator__manage {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  justify-content: flex-end;
  padding-inline-start: 52px;
}
.download-operator__selection {
  display: inline-flex;
  min-block-size: 44px;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface-subtle);
  cursor: pointer;
  font: 650 var(--am-font-size-sm) var(--am-font-family);
  white-space: nowrap;
  transition: background-color var(--am-motion-fast) var(--am-ease-standard);
}
.download-operator__selection input {
  inline-size: 20px;
  block-size: 20px;
  margin: 0;
  accent-color: var(--am-color-primary);
  cursor: pointer;
}
.download-operator__selection strong {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
  white-space: nowrap;
}
.download-operator__selection:is(:hover, :focus-within):not(:has(input:disabled)) {
  background: var(--am-color-surface-hover);
}
.download-operator__selection:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}
.download-operator__selection:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
.download-operator :deep(.catalog-operator-actions__content button) {
  display: inline-flex;
  min-block-size: 44px;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--am-space-2);
  padding: var(--am-space-2) var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: 650 var(--am-font-size-sm) var(--am-font-family);
  white-space: nowrap;
}
.download-operator :deep(button.download-operator__remove) {
  color: var(--am-color-danger);
}
.download-operator :deep(button:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}
.download-operator :deep(button:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: 2px;
}
@container am-side-panel (max-width: 768px) {
  .download-operator__selection {
    padding-inline: var(--am-space-2);
    font-size: var(--am-font-size-xs);
  }
  .download-operator__selection strong {
    font-size: var(--am-font-size-xs);
  }
}
@container am-side-panel (max-width: 360px) {
  .download-operator__selection strong {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .download-operator__selection {
    transition: none;
  }
}
</style>
