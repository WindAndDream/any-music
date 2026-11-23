<script setup lang="ts">
import AppIcon from '@any-music/ui/components/AppIcon.vue'
import type { TagEntityKind } from '@any-music/ui/theme'

defineProps<{ kind: TagEntityKind; compact?: boolean }>()
defineEmits<{ change: [kind: TagEntityKind] }>()
</script>

<template>
  <div
    class="tag-entity-switch"
    :class="{ 'tag-entity-switch--compact': compact }"
    role="group"
    aria-label="标签类型"
  >
    <div
      class="tag-entity-switch__options"
      :style="{ '--am-state-tab-index': kind === 'playlists' ? 1 : 0 }"
    >
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
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/collection-chrome';

.tag-entity-switch {
  padding: var(--am-space-1);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  box-shadow: inset 0 0 0 1px var(--am-color-border);
}
.tag-entity-switch__options {
  @include collection-chrome.state-tabs(2);
  --am-tag-tab-gap: var(--am-space-1);
  column-gap: var(--am-tag-tab-gap);

  &::before {
    inline-size: calc((100% - var(--am-tag-tab-gap)) / 2);
    background: var(--am-color-primary-container);
    box-shadow: none;
    transform: translateX(calc(var(--am-state-tab-index, 0) * (100% + var(--am-tag-tab-gap))));
  }
}
.tag-entity-switch--compact {
  min-inline-size: 0;
}
.tag-entity-switch--compact .tag-entity-switch__options {
  inline-size: 100%;

  > button {
    min-inline-size: 0;
    gap: var(--am-space-1);
    padding-inline: var(--am-space-1);
  }
}
</style>
