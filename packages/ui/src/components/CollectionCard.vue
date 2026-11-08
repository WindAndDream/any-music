<script setup lang="ts">
import type { AppIconName } from './app-icon'
import AppIcon from './AppIcon.vue'

/** 集合入口的主按钮和附属操作相互独立，避免歌单/平台复用时嵌套交互控件。 */
withDefaults(
  defineProps<{
    entryId: string
    name: string
    description: string
    icon?: AppIconName
    accented?: boolean
    focusKey?: string
  }>(),
  { icon: 'playlist', accented: false },
)
const emit = defineEmits<{ open: [] }>()
defineSlots<{ description?: () => unknown; meta?: () => unknown; actions?: () => unknown }>()
</script>

<template>
  <div class="collection-card" :class="{ 'collection-card--accented': accented }">
    <button
      class="collection-card__open"
      type="button"
      :data-collection-entry="entryId"
      :data-am-focus-key="focusKey"
      :aria-label="`查看${name}的歌曲`"
      @click="emit('open')"
    >
      <span class="collection-card__icon"><AppIcon :name="icon" :size="24" /></span>
      <span class="collection-card__copy">
        <strong :title="name">{{ name }}</strong>
        <span :title="description"
          ><slot name="description">{{ description }}</slot></span
        >
      </span>
      <AppIcon class="collection-card__arrow" name="arrow-right" :size="18" />
    </button>
    <div v-if="$slots.meta || $slots.actions" class="collection-card__footer">
      <div class="collection-card__meta"><slot name="meta" /></div>
      <div v-if="$slots.actions" class="collection-card__actions"><slot name="actions" /></div>
    </div>
  </div>
</template>

<style scoped>
.collection-card {
  display: flex;
  min-inline-size: 0;
  block-size: 100%;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--am-color-border-strong);
  border-radius: var(--am-radius-card);
  background: var(--am-color-surface);
  box-shadow: var(--am-shadow-control);
  transition: border-color var(--am-motion-fast) var(--am-ease-standard);
}
.collection-card:has(.collection-card__open:is(:hover, :focus-visible)) {
  border-color: var(--am-color-primary);
}
.collection-card__open {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 18px;
  min-inline-size: 0;
  min-block-size: 88px;
  flex: 1;
  align-items: center;
  gap: var(--am-space-3);
  padding: var(--am-space-4);
  border: 0;
  background: transparent;
  color: var(--am-color-text);
  font: inherit;
  text-align: start;
  cursor: pointer;
  touch-action: manipulation;
  transition: background-color var(--am-motion-fast) var(--am-ease-standard);
}
.collection-card__open:is(:hover, :focus-visible) {
  background: var(--am-color-surface-hover);
}
.collection-card__open:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
.collection-card__icon {
  display: grid;
  inline-size: 44px;
  block-size: 44px;
  place-items: center;
  border-radius: var(--am-radius-sm);
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}
.collection-card__copy {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}
.collection-card__copy > * {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-card__copy strong {
  font-size: var(--am-font-size-sm);
  font-weight: 700;
}
.collection-card--accented .collection-card__copy strong {
  color: var(--am-color-primary);
}
.collection-card__copy > span,
.collection-card__footer {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
  font-variant-numeric: tabular-nums;
}
.collection-card__arrow {
  color: var(--am-color-text-secondary);
  transition: transform var(--am-motion-fast) var(--am-ease-emphasized);
}
.collection-card__open:is(:hover, :focus-visible) .collection-card__arrow {
  transform: translateX(3px);
}
.collection-card__footer {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  gap: var(--am-space-2);
  margin-inline: var(--am-space-4);
  padding-block: var(--am-space-1) var(--am-space-2);
  border-block-start: 1px solid var(--am-color-border);
}
.collection-card__meta {
  display: flex;
  min-inline-size: 0;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--am-space-2);
}
.collection-card__actions {
  flex: 0 0 auto;
}
@media (prefers-reduced-motion: reduce) {
  .collection-card,
  .collection-card__open,
  .collection-card__arrow {
    transition: none;
  }
  .collection-card__open:is(:hover, :focus-visible) .collection-card__arrow {
    transform: none;
  }
}
</style>
