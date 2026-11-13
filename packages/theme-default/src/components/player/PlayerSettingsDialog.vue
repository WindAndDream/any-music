<script setup lang="ts">
import type { MediaQuality, PlaybackMode } from '@any-music/core'
import { AppDialog, PlaybackModeChoices } from '@any-music/ui'
import { computed } from 'vue'

import { playbackRateOptions } from './player-control-options'
import type { PlayerSettingKind } from './player-control-options'

/** 播放设置只提交受控值；关闭、焦点圈与 Escape 交给共享弹窗处理。 */
const props = defineProps<{
  setting?: PlayerSettingKind
  mode: PlaybackMode
  qualityOptions: readonly MediaQuality[]
  selectedQualityId?: string
  playbackRate: number
  volume: number
}>()

const emit = defineEmits<{
  close: []
  updateMode: [mode: PlaybackMode]
  selectQuality: [qualityId: string]
  setPlaybackRate: [rate: number]
  setVolume: [volume: number]
}>()

const title = computed(() => {
  switch (props.setting) {
    case 'mode':
      return '播放顺序'
    case 'quality':
      return '播放音质'
    case 'rate':
      return '播放倍速'
    case 'volume':
      return '音量'
    default:
      return ''
  }
})

function selectMode(mode: PlaybackMode): void {
  emit('updateMode', mode)
  emit('close')
}

function selectQuality(qualityId: string): void {
  emit('selectQuality', qualityId)
  emit('close')
}

function selectRate(rate: number): void {
  emit('setPlaybackRate', rate)
  emit('close')
}

function handleVolumeInput(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) emit('setVolume', Number(target.value))
}
</script>

<template>
  <AppDialog
    :open="props.setting !== undefined"
    :title="title"
    :description="props.setting === 'mode' ? '播放列表与控制栏使用同一设置。' : undefined"
    size="compact"
    :initial-focus-selector="props.setting === 'volume' ? '#am-player-volume' : undefined"
    @close="emit('close')"
  >
    <PlaybackModeChoices v-if="props.setting === 'mode'" :mode="props.mode" @select="selectMode" />
    <div
      v-else-if="props.setting === 'quality'"
      class="player-settings__options"
      role="group"
      aria-label="播放音质"
    >
      <button
        v-for="quality in props.qualityOptions"
        :key="quality.id"
        class="player-settings__option"
        type="button"
        :aria-pressed="props.selectedQualityId === quality.id"
        @click="selectQuality(quality.id)"
      >
        <strong>{{ quality.label }}</strong>
        <span class="player-settings__selection" aria-hidden="true">{{
          props.selectedQualityId === quality.id ? '已选' : '选择'
        }}</span>
      </button>
      <p v-if="props.qualityOptions.length === 0" class="player-settings__empty">
        当前歌曲暂无可切换的音质。
      </p>
    </div>
    <div
      v-else-if="props.setting === 'rate'"
      class="player-settings__rates"
      role="group"
      aria-label="播放倍速"
    >
      <button
        v-for="rate in playbackRateOptions"
        :key="rate"
        class="player-settings__rate"
        type="button"
        :aria-pressed="props.playbackRate === rate"
        @click="selectRate(rate)"
      >
        {{ rate }}×
      </button>
    </div>
    <label
      v-else-if="props.setting === 'volume'"
      class="player-settings__volume"
      for="am-player-volume"
    >
      <span>音量 {{ Math.round(props.volume * 100) }}%</span>
      <input
        id="am-player-volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="props.volume"
        @input="handleVolumeInput"
      />
    </label>
  </AppDialog>
</template>

<style scoped>
.player-settings__options {
  display: grid;
  gap: var(--am-space-2);
}

.player-settings__option,
.player-settings__rate {
  min-block-size: 52px;
  border: 1px solid var(--am-color-border);
  border-radius: var(--am-radius-md);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  cursor: pointer;
  font: inherit;
}

.player-settings__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--am-space-3);
  padding: var(--am-space-3);
  text-align: start;
}

.player-settings__option > span:first-child {
  display: grid;
  min-inline-size: 0;
  gap: var(--am-space-1);
}

.player-settings__option small,
.player-settings__selection,
.player-settings__empty {
  color: var(--am-color-text-secondary);
  font-size: var(--am-font-size-xs);
}

.player-settings__selection {
  flex: 0 0 auto;
}

.player-settings__option[aria-pressed='true'],
.player-settings__rate[aria-pressed='true'] {
  border-color: var(--am-color-primary);
  background: var(--am-color-primary-container);
}

.player-settings__option:focus-visible,
.player-settings__rate:focus-visible,
.player-settings__volume input:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: var(--am-focus-offset);
}

.player-settings__rates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--am-space-2);
}

.player-settings__volume {
  display: grid;
  gap: var(--am-space-3);
  color: var(--am-color-text);
}

.player-settings__volume input {
  inline-size: 100%;
  min-block-size: 44px;
  accent-color: var(--am-color-primary);
  cursor: pointer;
}
</style>
