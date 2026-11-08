<script setup lang="ts">
import type { CatalogFilterHistoryPreferencesDraft } from '@any-music/ui'
import type { FilterHistorySettingsRegion } from '@any-music/ui'
import AppDialog from '@any-music/ui/components/AppDialog.vue'
import BottomSheet from '@any-music/ui/components/BottomSheet.vue'
import { useId } from 'vue'

import CatalogFilterHistoryRegionSettings from './CatalogFilterHistoryRegionSettings.vue'

/** 同一区域表单在 PC 弹窗与手机非全屏底部面板中复用，保存只提交当前区域。 */
const props = defineProps<{
  open: boolean
  region: FilterHistorySettingsRegion | null
  modelValue?: CatalogFilterHistoryPreferencesDraft
  isMobileLayout?: boolean
  suspended?: boolean
  hasUnsavedChanges: boolean
  statusMessage: string
  errorMessage: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: CatalogFilterHistoryPreferencesDraft]
  save: []
  close: []
}>()
const formId = useId()
</script>

<template>
  <component
    :is="props.isMobileLayout ? BottomSheet : AppDialog"
    class="filter-history-dialog"
    :open="props.open"
    :suspended="props.suspended"
    :title="props.region?.title ?? '筛选历史配置'"
    :description="props.region?.description"
    size="compact"
    close-label="返回筛选历史"
    @close="emit('close')"
  >
    <form
      v-if="props.region && props.modelValue"
      :id="formId"
      class="settings-form filter-history-dialog__form"
      novalidate
      @submit.prevent="emit('save')"
    >
      <CatalogFilterHistoryRegionSettings
        :region="props.region"
        :model-value="props.modelValue"
        :described-by="props.errorMessage ? `${formId}-hint ${formId}-error` : `${formId}-hint`"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <p :id="`${formId}-hint`" class="settings-form__hint filter-history-dialog__hint">
        仅保存当前区域，超出上限的最旧记录将移除。
      </p>
      <p
        v-if="props.errorMessage"
        :id="`${formId}-error`"
        class="settings-form__error"
        role="alert"
      >
        {{ props.errorMessage }}
      </p>
    </form>
    <template #footer>
      <div class="settings-form__footer filter-history-dialog__footer">
        <span
          v-if="props.statusMessage || props.hasUnsavedChanges"
          class="settings-form__hint filter-history-dialog__status"
          role="status"
          >{{ props.statusMessage || '有未保存的修改，返回后保留草稿' }}</span
        >
        <div class="filter-history-dialog__actions">
          <button class="filter-history-dialog__back" type="button" @click="emit('close')">
            返回
          </button>
          <button class="settings-form__save" type="submit" :form="formId">保存设置</button>
        </div>
      </div>
    </template>
  </component>
</template>

<style scoped>
.filter-history-dialog__form {
  container: am-filter-history-settings / inline-size;
  min-inline-size: 0;
}
.filter-history-dialog__footer {
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-2) var(--am-space-3);
}
.filter-history-dialog__status {
  flex: 1 1 12rem;
}
.filter-history-dialog__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-3);
  margin-inline-start: auto;
}
.filter-history-dialog__hint {
  padding: var(--am-space-3) var(--am-space-4);
  border-inline-start: 2px solid var(--am-color-border-strong);
  background: var(--am-color-surface-subtle);
}
.filter-history-dialog__back {
  min-block-size: 44px;
  padding: var(--am-space-2) var(--am-space-4);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  font: inherit;
  cursor: pointer;
}
.filter-history-dialog__back:focus-visible,
.filter-history-dialog__footer .settings-form__save:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
/* 只调整此配置浮层，其他 compact 弹窗继续使用各自既有布局。 */
.filter-history-dialog :deep(.app-dialog__header),
.filter-history-dialog :deep(.bottom-sheet__header) {
  align-items: flex-start;
  padding-block: var(--am-space-5);
}
.filter-history-dialog :deep(.app-dialog__header p),
.filter-history-dialog :deep(.bottom-sheet__header p) {
  max-inline-size: 42ch;
  margin-block-start: var(--am-space-2);
  line-height: 1.7;
}
.filter-history-dialog :deep(.app-dialog__content),
.filter-history-dialog :deep(.bottom-sheet__content) {
  padding-block: var(--am-space-5);
}
/* 内容决定高度，较矮屏幕只滚动表单，标题与保存按钮始终可达。 */
.filter-history-dialog :deep(.bottom-sheet__panel--compact) {
  min-block-size: 0;
  max-block-size: min(80vh, 640px);
  max-block-size: min(80dvh, 640px);
}
.filter-history-dialog :deep(.bottom-sheet__footer) {
  padding-block-end: max(var(--am-space-4), env(safe-area-inset-bottom));
}
</style>
