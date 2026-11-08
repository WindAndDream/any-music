<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type { CSSProperties } from 'vue'

import {
  calculatePointerPositionMs,
  clampPlaybackPositionMs,
  formatPrecisePlaybackTime,
} from '../../composables/precision-seek'

// 精确时间轴只呈现原生 audio 的状态，所有跳转仍由父组件写入 HTMLMediaElement.currentTime。
const props = defineProps<{
  positionMs: number
  durationMs?: number
  bufferedUntilMs: number
  disabled: boolean
}>()

const emit = defineEmits<{
  seek: [positionMs: number]
}>()

const isSeeking = shallowRef(false)
const seekDraftMs = shallowRef(0)
const isHovering = shallowRef(false)
const hoverPositionMs = shallowRef(0)

const safeDurationMs = computed(() =>
  props.durationMs !== undefined && Number.isFinite(props.durationMs) && props.durationMs > 0
    ? Math.round(props.durationMs)
    : 0,
)
const currentPositionMs = computed(() =>
  clampPlaybackPositionMs(props.positionMs, safeDurationMs.value),
)
const displayedPositionMs = computed(() =>
  isSeeking.value ? seekDraftMs.value : currentPositionMs.value,
)
const progressStyle = computed<CSSProperties>(() => ({
  '--am-player-progress': `${toPercentage(displayedPositionMs.value)}%`,
  '--am-player-buffered': `${Math.max(
    toPercentage(displayedPositionMs.value),
    toPercentage(props.bufferedUntilMs),
  )}%`,
}))
const hoverStyle = computed<CSSProperties>(() => {
  const percentage = toPercentage(hoverPositionMs.value)
  const transform =
    percentage < 8 ? 'translateX(0)' : percentage > 92 ? 'translateX(-100%)' : 'translateX(-50%)'
  return { left: `${percentage}%`, transform }
})

watch(currentPositionMs, (positionMs) => {
  if (!isSeeking.value) seekDraftMs.value = positionMs
})

function handleSeekInput(event: Event): void {
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  isSeeking.value = true
  seekDraftMs.value = clampPlaybackPositionMs(Number(target.value), safeDurationMs.value)
}

function commitSeek(event: Event): void {
  handleSeekInput(event)
  isSeeking.value = false
  emit('seek', seekDraftMs.value)
}

function handlePointerMove(event: PointerEvent): void {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const bounds = target.getBoundingClientRect()
  hoverPositionMs.value = calculatePointerPositionMs(
    event.clientX,
    bounds.left,
    bounds.width,
    safeDurationMs.value,
  )
  isHovering.value = true
}

function toPercentage(positionMs: number): number {
  if (safeDurationMs.value <= 0) return 0
  return Math.min(100, Math.max(0, (positionMs / safeDurationMs.value) * 100))
}
</script>

<template>
  <div class="player__precision-seek">
    <span class="player__precision-time">{{ formatPrecisePlaybackTime(displayedPositionMs) }}</span>
    <div
      class="player__precision-track"
      :style="progressStyle"
      @pointerenter="isHovering = true"
      @pointerleave="isHovering = false"
      @pointermove="handlePointerMove"
    >
      <!-- 独立缓冲层保留完整底轨，即使尚未播放也能看清可拖动范围。 -->
      <span class="player__precision-buffered" aria-hidden="true"></span>
      <output
        v-show="isHovering && !props.disabled"
        class="player__precision-tooltip"
        :style="hoverStyle"
      >
        {{ formatPrecisePlaybackTime(hoverPositionMs) }}
      </output>
      <input
        class="player__precision-range"
        type="range"
        min="0"
        :max="safeDurationMs"
        step="100"
        :value="displayedPositionMs"
        :disabled="props.disabled || safeDurationMs <= 0"
        :aria-valuetext="formatPrecisePlaybackTime(displayedPositionMs)"
        aria-label="精确播放进度"
        @input="handleSeekInput"
        @change="commitSeek"
      />
    </div>
    <span class="player__precision-time player__precision-time--end">
      {{ formatPrecisePlaybackTime(safeDurationMs) }}
    </span>
  </div>
</template>
