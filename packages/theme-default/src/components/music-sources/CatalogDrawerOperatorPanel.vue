<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'

import CatalogOperatorActions from './CatalogOperatorActions.vue'

/** 全选和删除组成集合管理组；发现入口由容器决定放在标题还是操作器。 */
const props = withDefaults(
  defineProps<{
    selectedCount: number
    visibleCount: number
    areAllVisibleSelected: boolean
    areSomeVisibleSelected: boolean
    discoveryLabel: string
    showDiscovery?: boolean
    hasSelectedCustomNames: boolean
  }>(),
  { showDiscovery: true },
)
const emit = defineEmits<{
  toggleAllVisible: []
  removeSelected: []
  restoreNames: []
  discover: []
}>()
</script>

<template>
  <div class="catalog-list-actions">
    <div class="catalog-list-actions__manage">
      <label class="catalog-list-actions__select-all">
        <input
          type="checkbox"
          :checked="props.areAllVisibleSelected"
          :indeterminate="props.areSomeVisibleSelected"
          :disabled="props.visibleCount === 0"
          :aria-label="`全选当前 ${props.visibleCount} 个匹配音乐列表`"
          @change="emit('toggleAllVisible')"
        />
        <span>全选</span>
        <strong>已选 {{ props.selectedCount }}</strong>
      </label>
    </div>
    <CatalogOperatorActions class="catalog-list-actions__buttons">
      <button
        v-if="props.showDiscovery"
        class="catalog-list-actions__discover"
        type="button"
        @click="emit('discover')"
      >
        <AppIcon name="search" :size="18" />
        <span>{{ props.discoveryLabel }}</span>
      </button>
      <button
        class="catalog-list-actions__remove"
        type="button"
        :disabled="props.selectedCount === 0"
        @click="emit('removeSelected')"
      >
        <AppIcon name="trash" :size="18" />
        <span>删除已选列表</span>
      </button>
      <button
        v-if="props.hasSelectedCustomNames"
        type="button"
        aria-label="恢复已选音乐列表的原名"
        @click="emit('restoreNames')"
      >
        <AppIcon name="refresh" :size="18" />
        <span>恢复原名</span>
      </button>
    </CatalogOperatorActions>
  </div>
</template>

<style scoped>
.catalog-list-actions__manage {
  display: flex;
  align-items: center;
  gap: var(--am-space-3);
  min-inline-size: 0;
}
.catalog-list-actions {
  display: grid;
  inline-size: 100%;
  min-inline-size: 0;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: repeat(2, 44px);
  align-content: center;
  gap: var(--am-space-2);
}
.catalog-list-actions__manage {
  justify-content: flex-end;
  padding-inline-start: 52px;
}
.catalog-list-actions__buttons {
  min-inline-size: 0;
}
.catalog-list-actions button,
.catalog-list-actions__select-all {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  min-block-size: 44px;
  block-size: 44px;
  align-self: center;
  flex: 0 0 auto;
  padding-inline: var(--am-space-3);
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-control);
  color: var(--am-color-text);
  background: var(--am-color-surface-subtle);
  cursor: pointer;
  font: 650 var(--am-font-size-sm) var(--am-font-family);
  white-space: nowrap;
  transition:
    background-color var(--am-motion-fast) var(--am-ease-standard),
    border-color var(--am-motion-fast) var(--am-ease-standard);
}
.catalog-list-actions__select-all input {
  inline-size: 20px;
  block-size: 20px;
  margin: 0;
  accent-color: var(--am-color-primary);
}
.catalog-list-actions__select-all strong {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.catalog-list-actions button.catalog-list-actions__remove {
  color: var(--am-color-danger);
  background: var(--am-color-danger-container);
  border-color: var(--am-color-danger);
}
.catalog-list-actions button.catalog-list-actions__discover {
  color: var(--am-color-on-primary);
  background: var(--am-color-primary);
  border-color: var(--am-color-primary);
}
.catalog-list-actions button:disabled,
.catalog-list-actions__select-all:has(input:disabled) {
  opacity: 0.48;
  cursor: not-allowed;
}
.catalog-list-actions button:is(:hover, :focus-visible):not(:disabled),
.catalog-list-actions__select-all:is(:hover, :focus-within):not(:has(input:disabled)) {
  background: var(--am-color-surface-hover);
}
.catalog-list-actions
  button.catalog-list-actions__discover:is(:hover, :focus-visible):not(:disabled) {
  border-color: var(--am-color-primary-hover);
  background: var(--am-color-primary-hover);
}
.catalog-list-actions
  button.catalog-list-actions__remove:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-surface-hover);
}
@supports (background: color-mix(in srgb, white, black)) {
  .catalog-list-actions
    button.catalog-list-actions__remove:is(:hover, :focus-visible):not(:disabled) {
    /* 少量加深红底，保留浅色主题下小字号危险文字的对比度。 */
    background: color-mix(in srgb, var(--am-color-danger) 2%, var(--am-color-danger-container));
  }
}
.catalog-list-actions__discover .app-icon {
  transition: transform var(--am-motion-fast) var(--am-ease-emphasized);
}
@media (prefers-reduced-motion: no-preference) {
  .catalog-list-actions__discover:is(:hover, :focus-visible):not(:disabled) .app-icon {
    transform: scale(1.12) rotate(-8deg);
  }
}
.catalog-list-actions button:focus-visible,
.catalog-list-actions__select-all:has(input:focus-visible) {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
/* 上排避让关闭按钮，下排按统一高度横向滚动，不压缩或折行按钮。 */
@container am-side-panel (max-width: 768px) {
  .catalog-list-actions__manage {
    gap: var(--am-space-1);
  }
  .catalog-list-actions button,
  .catalog-list-actions__select-all {
    padding-inline: var(--am-space-2);
    font-size: var(--am-font-size-xs);
  }
  .catalog-list-actions__buttons button {
    min-inline-size: 112px;
  }
}

@container am-side-panel (max-width: 360px) {
  /* 选择总数仍在入口左侧可见，最窄宽度把首行空间留给完整操作名称。 */
  .catalog-list-actions__select-all strong {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .catalog-list-actions button,
  .catalog-list-actions__select-all,
  .catalog-list-actions__discover .app-icon {
    transition: none;
  }
}
</style>
