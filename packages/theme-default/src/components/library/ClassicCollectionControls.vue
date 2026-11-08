<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
defineProps<{
  selectedCount: number
  totalCount: number
  operatorOpen: boolean
  filterLabel?: string
  filterActive?: boolean
  canDisplay?: boolean
  iconOnlyDisplay?: boolean
  displayLabel?: string
  disabled?: boolean
}>()
defineEmits<{ filter: []; operator: []; display: [] }>()
defineSlots<{ 'before-display'?: () => unknown }>()
</script>
<template>
  <div class="catalog-operator-launcher classic-collection-controls">
    <span class="catalog-operator-launcher__count"
      >已选 {{ selectedCount }} · 共 {{ totalCount }}</span
    >
    <div class="catalog-operator-launcher__actions">
      <slot name="before-display" />
      <button
        v-if="canDisplay"
        type="button"
        :disabled="disabled"
        class="catalog-operator-launcher__filter classic-collection-controls__display"
        :class="{ 'classic-collection-controls__display--icon': iconOnlyDisplay }"
        :aria-label="displayLabel ?? '歌曲展示方式'"
        title="展示方式"
        aria-haspopup="dialog"
        @click="$emit('display')"
      >
        <AppIcon name="list" :size="18" /><span v-if="!iconOnlyDisplay">展示方式</span>
      </button>
      <button
        type="button"
        :disabled="disabled"
        class="catalog-operator-launcher__filter"
        :class="{ 'classic-collection-controls__filter--active': filterActive }"
        :aria-label="filterLabel ?? '筛选歌曲'"
        :aria-description="filterActive ? '已启用筛选' : undefined"
        @click="$emit('filter')"
      >
        <AppIcon name="filter" :size="18" />筛选器
      </button>
      <button
        type="button"
        :disabled="disabled"
        :aria-label="'操作器 已选 ' + selectedCount"
        :aria-expanded="operatorOpen"
        @click="$emit('operator')"
      >
        <AppIcon name="settings" :size="18" />操作器
      </button>
    </div>
  </div>
</template>
<style scoped>
.classic-collection-controls__filter--active::after {
  inline-size: 6px;
  block-size: 6px;
  border-radius: 50%;
  background: currentColor;
  content: '';
}
.classic-collection-controls
  .classic-collection-controls__display:is(:hover, :focus-visible):not(:disabled) {
  background: var(--am-color-surface-hover);
}
.classic-collection-controls .classic-collection-controls__display--icon {
  inline-size: 36px;
  min-inline-size: 36px;
  min-block-size: 36px;
  padding-inline: 0;
}
@container am-player (max-width: 600px) {
  .classic-collection-controls {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .classic-collection-controls__display span {
    display: none;
  }
}
</style>
