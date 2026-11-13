<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagEntityKind } from '@any-music/ui/theme'

defineProps<{ kind: TagEntityKind }>()
defineEmits<{ change: [kind: TagEntityKind] }>()
</script>

<template>
  <div class="tag-entity-switch" role="group" aria-label="标签类型">
    <button type="button" :aria-pressed="kind === 'tracks'" @click="$emit('change', 'tracks')">
      <AppIcon name="music" :size="16" />音乐标签
    </button>
    <button
      type="button"
      :aria-pressed="kind === 'playlists'"
      @click="$emit('change', 'playlists')"
    >
      <AppIcon name="playlist" :size="16" />歌单标签
    </button>
  </div>
</template>

<style scoped>
/* Match the Favorites All Tracks / By Platform segmented control. */
.tag-entity-switch {
  display: flex;
  gap: var(--am-space-1);
  padding: var(--am-space-1);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  box-shadow: inset 0 0 0 1px var(--am-color-border);
}
.tag-entity-switch button {
  display: flex;
  min-block-size: 44px;
  align-items: center;
  justify-content: center;
  gap: var(--am-space-2);
  padding-inline: var(--am-space-3);
  border: 0;
  border-radius: var(--am-radius-control);
  background: transparent;
  color: var(--am-color-text-secondary);
  font: 650 var(--am-font-size-xs) var(--am-font-family);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--am-motion-fast),
    color var(--am-motion-fast);
  touch-action: manipulation;
}
.tag-entity-switch button[aria-pressed='true'] {
  background: var(--am-color-primary-container);
  color: var(--am-color-primary);
}
.tag-entity-switch button:is(:hover, :focus-visible) {
  background: var(--am-color-surface-hover);
}
.tag-entity-switch button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: -3px;
}
@media (prefers-reduced-motion: reduce) {
  .tag-entity-switch button {
    transition: none;
  }
}
</style>
