<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { NavigationItem } from './navigation'

interface Props {
  items: readonly NavigationItem[]
  activeId: string
  collapsed?: boolean
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  collapsed: false,
  label: '主导航',
})

const emit = defineEmits<{
  select: [id: string]
}>()
</script>

<template>
  <nav
    class="navigation-rail"
    :class="{ 'navigation-rail--collapsed': props.collapsed }"
    :aria-label="props.label"
  >
    <button
      v-for="item in props.items"
      :key="item.id"
      :data-am-focus-key="`navigation:${item.id}`"
      class="navigation-rail__item"
      :class="{ 'navigation-rail__item--active': item.id === props.activeId }"
      type="button"
      :aria-current="item.id === props.activeId ? 'page' : undefined"
      :aria-label="props.collapsed ? item.label : undefined"
      :title="props.collapsed ? item.label : undefined"
      @click="emit('select', item.id)"
    >
      <span class="navigation-rail__icon-box" aria-hidden="true">
        <AppIcon :name="item.icon" :size="21" />
      </span>
      <span class="navigation-rail__label" :aria-hidden="props.collapsed">{{ item.label }}</span>
      <span
        v-if="item.count !== undefined"
        class="navigation-rail__count"
        aria-label="数量"
        :aria-hidden="props.collapsed"
      >
        {{ item.count > 999 ? '999+' : item.count }}
      </span>
    </button>
  </nav>
</template>

<style scoped>
.navigation-rail {
  display: grid;
  align-content: start;
  gap: var(--am-space-1);
  min-width: 0;
  padding: var(--am-space-2);
}

.navigation-rail__item {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  min-inline-size: 0;
  min-height: 44px;
  align-items: center;
  gap: var(--am-space-2);
  /* 图标与收起后的位置相同，Grid 轨道过渡期间不切换对齐方式。 */
  padding: 0 var(--am-space-3) 0 var(--am-space-2);
  overflow: hidden;
  border: 0;
  border-radius: var(--am-radius-sm);
  background: transparent;
  color: var(--am-color-text-secondary);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition:
    color var(--am-motion-fast) var(--am-ease-standard),
    background-color var(--am-motion-fast) var(--am-ease-standard),
    transform var(--am-motion-fast) var(--am-ease-standard);
}

.navigation-rail__item:hover {
  background: var(--am-color-surface-hover);
  color: var(--am-color-text);
}

.navigation-rail__item:active {
  transform: scale(0.98);
}

.navigation-rail__item:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

.navigation-rail__item--active {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.navigation-rail__icon-box {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
}

.navigation-rail__label {
  overflow: hidden;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.navigation-rail__count {
  min-width: 24px;
  padding: 1.28px var(--am-space-1);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-surface-raised);
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.navigation-rail__label,
.navigation-rail__count {
  transition:
    opacity var(--am-motion-fast) var(--am-ease-standard),
    visibility 0s;
}

.navigation-rail--collapsed .navigation-rail__label,
.navigation-rail--collapsed .navigation-rail__count {
  opacity: 0;
  visibility: hidden;
  transition-delay: 0s, var(--am-motion-fast);
}

@media (prefers-reduced-motion: reduce) {
  .navigation-rail__item,
  .navigation-rail__label,
  .navigation-rail__count {
    transition: none;
  }

  .navigation-rail__item:active {
    transform: none;
  }
}
</style>
