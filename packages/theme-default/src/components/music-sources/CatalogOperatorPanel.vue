<script setup lang="ts">
import CatalogOperatorActions from './CatalogOperatorActions.vue'

/** Shared selection row and scrolling action rail for classic collection operators. */
defineProps<{
  selectedCount: number
  visibleCount: number
  allSelected: boolean
  someSelected: boolean
  selectAllLabel: string
  countUnit?: string
  disabled?: boolean
}>()
defineEmits<{ toggleAll: [] }>()
defineSlots<{ default(): unknown }>()
</script>

<template>
  <div class="catalog-actions">
    <div class="catalog-actions__manage">
      <div class="catalog-actions__selection-group">
        <label class="catalog-actions__selection">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate="someSelected"
            :disabled="!visibleCount || disabled"
            :aria-label="selectAllLabel"
            @change="$emit('toggleAll')"
          />
          <span>全选</span>
          <strong>已选 {{ selectedCount }} {{ countUnit ?? '首' }}</strong>
        </label>
      </div>
    </div>
    <CatalogOperatorActions class="catalog-actions__buttons"><slot /></CatalogOperatorActions>
  </div>
</template>

<style scoped>
.catalog-actions {
  display: grid;
  inline-size: 100%;
  min-inline-size: 0;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: repeat(2, 44px);
  align-content: center;
  gap: var(--am-space-2);
}

.catalog-actions__selection-group {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-3);
}

.catalog-actions__manage {
  display: flex;
  flex: 1 1 auto;
  min-inline-size: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-3);
  /* 关闭按钮只占上排；下排使用整个面板宽度。 */
  padding-inline-start: 52px;
}

.catalog-actions__selection {
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

.catalog-actions__selection input {
  inline-size: 20px;
  block-size: 20px;
  margin: 0;
  accent-color: var(--am-color-primary);
  cursor: pointer;
}

.catalog-actions__selection strong {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-sm);
  white-space: nowrap;
}

.catalog-actions__buttons {
  min-inline-size: 0;
}

/* 扩展动作由子组件渲染，按钮样式穿透到内容区，并保留独立的滚动箭头样式。 */
.catalog-actions :deep(.catalog-operator-actions__content button) {
  display: inline-flex;
  block-size: 44px;
  min-block-size: 44px;
  flex: 0 0 auto;
  align-self: center;
  align-items: center;
  gap: var(--am-space-3);
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  text-align: start;
  white-space: nowrap;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard);
}

.catalog-actions :deep(button.catalog-actions__playlist) {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary);
  color: var(--am-color-on-primary);
}

/* 与音乐列表的删除按钮共用危险色语义，只有集合页提供批量移出。 */
.catalog-actions :deep(button.catalog-actions__remove) {
  border-color: var(--am-color-danger);
  background: var(--am-color-danger-container);
  color: var(--am-color-danger);
}

.catalog-actions
  :deep(.catalog-operator-actions__content button:is(:hover, :focus-visible):not(:disabled)),
.catalog-actions__selection:is(:hover, :focus-within):not(:has(input:disabled)) {
  background: var(--am-color-surface-hover);
}

.catalog-actions :deep(button.catalog-actions__playlist:is(:hover, :focus-visible):not(:disabled)) {
  border-color: var(--am-color-primary-hover);
  background: var(--am-color-primary-hover);
}

.catalog-actions :deep(button.catalog-actions__remove:is(:hover, :focus-visible):not(:disabled)) {
  background: var(--am-color-surface-hover);
}

@supports (background: color-mix(in srgb, white, black)) {
  .catalog-actions :deep(button.catalog-actions__remove:is(:hover, :focus-visible):not(:disabled)) {
    background: color-mix(in srgb, var(--am-color-danger) 2%, var(--am-color-danger-container));
  }
}

.catalog-actions :deep(.catalog-operator-actions__content button:disabled),
.catalog-actions__selection:has(input:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

.catalog-actions :deep(.catalog-operator-actions__content button:focus-visible),
.catalog-actions__selection:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

.catalog-actions__buttons :deep(small) {
  display: none;
}

/* 可用宽度不够放完整动作名时改用短标签，保持每个按钮的图文同排。 */
@container am-side-panel (max-width: 560px) {
  .catalog-actions__buttons :deep(button > span) {
    display: none;
  }

  .catalog-actions__buttons :deep(small) {
    display: block;
    font-size: var(--am-font-size-xs);
    white-space: nowrap;
  }
}

@container am-side-panel (max-width: 768px) {
  .catalog-actions__manage {
    inline-size: 100%;
    gap: var(--am-space-1);
  }

  .catalog-actions__selection {
    min-block-size: 44px;
    padding-inline: var(--am-space-2);
    font-size: var(--am-font-size-xs);
  }

  .catalog-actions__selection strong {
    font-size: var(--am-font-size-xs);
  }

  .catalog-actions__buttons :deep(.catalog-operator-actions__content button) {
    min-inline-size: 112px;
    min-block-size: 44px;
    justify-content: center;
    gap: var(--am-space-2);
    padding-inline: var(--am-space-2);
    font-size: var(--am-font-size-xs);
  }

  .catalog-actions__buttons :deep(small) {
    font-size: var(--am-font-size-xs);
  }
}

@container am-side-panel (max-width: 360px) {
  /* 最窄布局的已选数量由入口摘要保留，首行优先展示完整动作名称。 */
  .catalog-actions__selection strong {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-actions :deep(.catalog-operator-actions__content button),
  .catalog-actions__selection {
    transition: none;
  }
}
</style>
