import { computed } from 'vue'
import type { Ref } from 'vue'

export interface StablePlaybackTimelineOptions {
  positionMs: Readonly<Ref<number>>
  durationMs: Readonly<Ref<number | undefined>>
  pendingPositionMs: Readonly<Ref<number | undefined>>
  resolvedDurationMs: Readonly<Ref<number | undefined>>
}

/**
 * 在媒体源被重建时维持播放器的逻辑时间轴，避免原生 audio 暂时回报 0 / 未知时长，
 * 导致进度条先跳回起点、再跳到用户选择的位置。
 */
export function useStablePlaybackTimeline(options: StablePlaybackTimelineOptions) {
  const displayedPositionMs = computed(
    () => options.pendingPositionMs.value ?? options.positionMs.value,
  )
  const displayedDurationMs = computed(
    () => options.durationMs.value ?? options.resolvedDurationMs.value,
  )

  return {
    displayedPositionMs,
    displayedDurationMs,
  }
}
