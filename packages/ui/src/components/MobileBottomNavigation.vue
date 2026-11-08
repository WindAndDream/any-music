<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import type { NavigationItem } from './navigation'

interface Props {
  items: readonly NavigationItem[]
  activeId: string
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  label: '移动导航',
})

const emit = defineEmits<{
  select: [id: string]
}>()
</script>

<template>
  <nav class="mobile-bottom-navigation" :aria-label="props.label">
    <button
      v-for="item in props.items"
      :key="item.id"
      class="mobile-bottom-navigation__item"
      :class="{ 'mobile-bottom-navigation__item--active': item.id === props.activeId }"
      type="button"
      :aria-current="item.id === props.activeId ? 'page' : undefined"
      @click="emit('select', item.id)"
    >
      <span class="mobile-bottom-navigation__icon-box">
        <AppIcon :name="item.icon" :size="21" aria-hidden="true" />
        <span
          v-if="item.count !== undefined && item.count > 0"
          class="mobile-bottom-navigation__count"
        >
          {{ item.count > 99 ? '99+' : item.count }}
        </span>
      </span>
      <span class="mobile-bottom-navigation__label">{{ item.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-bottom-navigation {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(56px, 1fr));
  min-height: var(--am-mobile-navigation-height);
  padding: var(--am-space-1) max(var(--am-space-2), env(safe-area-inset-right))
    max(var(--am-space-1), env(safe-area-inset-bottom))
    max(var(--am-space-2), env(safe-area-inset-left));
  border-top: 1px solid var(--am-color-border);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-navigation);
}

.mobile-bottom-navigation__item {
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 52px;
  place-content: center;
  justify-items: center;
  gap: 2.4px;
  padding: var(--am-space-1);
  border: 0;
  border-radius: var(--am-radius-sm);
  background: transparent;
  color: var(--am-color-text-secondary);
  font: inherit;
  cursor: pointer;
  transition:
    color var(--am-motion-fast) var(--am-ease-standard),
    background-color var(--am-motion-fast) var(--am-ease-standard),
    transform var(--am-motion-fast) var(--am-ease-standard);
}

.mobile-bottom-navigation__item:active {
  transform: scale(0.96);
}

.mobile-bottom-navigation__item:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: calc(var(--am-focus-offset) * -1);
}

.mobile-bottom-navigation__item--active {
  background: var(--am-color-primary-soft);
  color: var(--am-color-primary);
}

.mobile-bottom-navigation__icon-box {
  position: relative;
}

.mobile-bottom-navigation__count {
  position: absolute;
  top: -5.6px;
  left: 13.6px;
  min-width: 16.8px;
  padding: 0 3.52px;
  border: 2px solid var(--am-color-surface);
  border-radius: var(--am-radius-detail);
  background: var(--am-color-accent);
  color: var(--am-color-on-accent);
  font-size: 9.28px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-align: center;
}

.mobile-bottom-navigation__label {
  max-width: 100%;
  overflow: hidden;
  font-size: var(--am-font-size-xs);
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .mobile-bottom-navigation__item {
    transition: none;
  }

  .mobile-bottom-navigation__item:active {
    transform: none;
  }
}
</style>
