<script setup lang="ts">
import type { PlaybackMode } from '@any-music/core'
import { AppIcon } from '@any-music/ui'
import { computed } from 'vue'

import { playbackModeOptions } from './player-control-options'
import type { PlayerSettingKind } from './player-control-options'

/** 三处控制栏入口共用同一组受控操作；模式与媒体状态由父级提供。 */
const props = defineProps<{
  mode: PlaybackMode
  playbackRate: number
  hasTrack: boolean
  qualityDisabled: boolean
}>()

const emit = defineEmits<{
  openSetting: [setting: PlayerSettingKind]
  download: []
}>()

const modeOption = computed(
  () => playbackModeOptions.find((option) => option.value === props.mode) ?? playbackModeOptions[0],
)
</script>

<template>
  <div class="player-actions" role="group" aria-label="播放设置与下载">
    <button
      class="player-actions__button player-actions__button--mode"
      type="button"
      :title="`播放顺序：${modeOption?.label}`"
      :aria-label="`播放顺序：${modeOption?.label}`"
      @click="emit('openSetting', 'mode')"
    >
      <AppIcon name="queue" :size="18" />
      <span>{{ modeOption?.shortLabel }}</span>
    </button>
    <button
      class="player-actions__button"
      type="button"
      aria-label="选择音质"
      title="选择音质"
      :disabled="props.qualityDisabled"
      @click="emit('openSetting', 'quality')"
    >
      音质
    </button>
    <button
      class="player-actions__button"
      type="button"
      :aria-label="`播放倍速：${props.playbackRate} 倍`"
      title="播放倍速"
      @click="emit('openSetting', 'rate')"
    >
      {{ props.playbackRate }}×
    </button>
    <button
      class="player-actions__button"
      type="button"
      aria-label="调整音量"
      title="调整音量"
      @click="emit('openSetting', 'volume')"
    >
      <AppIcon name="volume" :size="19" />
    </button>
    <button
      class="player-actions__button"
      type="button"
      :disabled="!props.hasTrack"
      title="下载当前音乐"
      aria-label="下载当前音乐"
      @click="emit('download')"
    >
      <AppIcon name="download" :size="19" />
    </button>
  </div>
</template>

<style scoped>
.player-actions {
  display: flex;
  min-inline-size: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--am-space-1);
}

.player-actions__button {
  display: inline-flex;
  min-inline-size: var(--am-size-control);
  block-size: var(--am-size-control);
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0 var(--am-space-1);
  border: 0;
  border-radius: var(--am-radius-pill);
  background: transparent;
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
  font-size: var(--am-font-size-xs);
  white-space: nowrap;
  transition: background-color var(--am-motion-fast) var(--am-ease-standard);
}

.player-actions__button--mode {
  min-inline-size: 68px;
}

.player-actions__button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.player-actions__button:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

.player-actions__button:not(:disabled):active {
  background: var(--am-color-hover);
}

@media (max-width: 576px) {
  .player-actions__button {
    min-inline-size: 44px;
    block-size: 44px;
    /* 手机上的文字与图标按钮统一圆角矩形，保留桌面原有胶囊反馈。 */
    border-radius: var(--am-radius-md);
  }
}

@media (hover: hover) {
  .player-actions__button:not(:disabled):hover {
    background: var(--am-color-hover);
  }
}

@media (prefers-reduced-motion: reduce) {
  .player-actions__button {
    transition: none;
  }
}
</style>
