<script setup lang="ts">
import type { PlaybackMode } from '@any-music/core'

import { playbackModeOptions } from './playback-mode-options'

/** 弹窗内容由队列与控制栏复用，选择后由外层负责更新和关闭。 */
defineProps<{ mode: PlaybackMode }>()
const emit = defineEmits<{ select: [mode: PlaybackMode] }>()
</script>

<template>
  <div class="playback-choices" role="group" aria-label="播放顺序">
    <button
      v-for="option in playbackModeOptions"
      :key="option.value"
      class="playback-choices__option"
      type="button"
      :aria-pressed="mode === option.value"
      @click="emit('select', option.value)"
    >
      <span class="playback-choices__copy">
        <strong>{{ option.label }}</strong>
        <small>{{ option.description }}</small>
      </span>
      <span class="playback-choices__selection" aria-hidden="true">{{
        mode === option.value ? '已选' : '选择'
      }}</span>
    </button>
  </div>
</template>

<style scoped>
.playback-choices {
  display: grid;
  gap: var(--am-space-2);
}
.playback-choices__option {
  display: flex;
  min-block-size: 52px;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  text-align: start;
}
.playback-choices__copy {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}
.playback-choices__copy small,
.playback-choices__selection {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}
.playback-choices__selection {
  flex: 0 0 auto;
}
.playback-choices__option[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
}
.playback-choices__option:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}
</style>
