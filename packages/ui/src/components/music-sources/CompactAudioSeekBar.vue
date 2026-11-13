<script setup lang="ts">
import { computed } from 'vue'

import { useCompactAudioSeek } from '../../composables/player/use-compact-audio-seek'
import { formatPrecisePlaybackTime } from '../../composables/precision-seek'

const props = defineProps<{
  positionMs: number
  durationMs?: number
  bufferedUntilMs: number
  disabled: boolean
}>()
const emit = defineEmits<{ seek: [positionMs: number] }>()
const {
  disabled,
  durationMs,
  positionMs,
  isSeeking,
  handlePointerDown,
  handlePointerMove,
  handlePointerUp,
  handlePointerCancel,
  handleKeydown,
} = useCompactAudioSeek({
  positionMs: () => props.positionMs,
  durationMs: () => props.durationMs,
  disabled: () => props.disabled,
  seek: (position) => emit('seek', position),
})
const progressStyle = computed(() => ({
  '--am-compact-progress': `${durationMs.value ? (positionMs.value / durationMs.value) * 100 : 0}%`,
  '--am-compact-buffered': `${durationMs.value ? Math.max(0, Math.min(100, (props.bufferedUntilMs / durationMs.value) * 100)) : 0}%`,
}))
</script>

<template>
  <div
    class="compact-audio-seek"
    :class="{ 'compact-audio-seek--seeking': isSeeking }"
    data-player-seek
    role="slider"
    aria-label="播放进度"
    aria-orientation="horizontal"
    :aria-disabled="disabled"
    :tabindex="disabled ? -1 : 0"
    :aria-valuemin="0"
    :aria-valuemax="durationMs"
    :aria-valuenow="positionMs"
    :aria-valuetext="formatPrecisePlaybackTime(positionMs)"
    :style="progressStyle"
    @pointerdown.stop="handlePointerDown"
    @pointermove.stop="handlePointerMove"
    @pointerup.stop="handlePointerUp"
    @pointercancel.stop="handlePointerCancel"
    @lostpointercapture="handlePointerCancel"
    @keydown="handleKeydown"
    @click.stop
  >
    <span class="compact-audio-seek__rail" aria-hidden="true">
      <span class="compact-audio-seek__buffered"></span>
      <span class="compact-audio-seek__progress"></span>
      <span class="compact-audio-seek__thumb"></span>
    </span>
    <output v-if="isSeeking" class="compact-audio-seek__time" aria-hidden="true">
      {{ formatPrecisePlaybackTime(positionMs) }}
    </output>
  </div>
</template>

<style scoped>
.compact-audio-seek {
  position: relative;
  display: grid;
  block-size: var(--am-size-player-edge-seek, 44px);
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.compact-audio-seek[aria-disabled='true'] {
  cursor: not-allowed;
}
.compact-audio-seek__rail {
  position: relative;
  block-size: 3px;
  background: var(--am-color-border-strong);
}
.compact-audio-seek__buffered,
.compact-audio-seek__progress {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
}
.compact-audio-seek__thumb {
  position: absolute;
  inset-block-start: 50%;
  /* 端点圆点始终完整留在控制栏内，包括 0% 和 100% 时。 */
  inset-inline-start: clamp(5px, var(--am-compact-progress), calc(100% - 5px));
  inline-size: 10px;
  block-size: 10px;
  border-radius: var(--am-radius-pill);
  background: var(--am-color-primary);
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.compact-audio-seek__buffered {
  inline-size: var(--am-compact-buffered);
  background: var(--am-color-text-secondary);
}
.compact-audio-seek__progress {
  inline-size: var(--am-compact-progress);
  background: var(--am-color-primary);
}
.compact-audio-seek--seeking .compact-audio-seek__rail {
  block-size: 5px;
}
.compact-audio-seek__time {
  position: absolute;
  inset-block-end: 100%;
  justify-self: center;
  padding: var(--am-space-1) var(--am-space-2);
  border-radius: var(--am-radius-control);
  background: var(--am-color-surface);
  color: var(--am-color-text);
  box-shadow: var(--am-shadow-control);
  font-size: var(--am-font-size-xs);
  font-variant-numeric: tabular-nums;
}
.compact-audio-seek:focus-visible {
  outline: var(--am-focus-ring);
  outline-offset: calc(-1 * var(--am-focus-offset));
}
</style>
