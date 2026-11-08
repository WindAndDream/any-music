import { computed, shallowRef } from 'vue'
import type { Ref } from 'vue'

interface UseProgressScrubOptions {
  playbackPositionMs: Readonly<Ref<number>>
  seek: (positionMs: number) => Promise<void> | void
}

/**
 * 在用户拖动期间暂存滑块位置，避免实时播放进度把尚未提交的输入覆盖掉。
 * seek 完成后才恢复跟随播放位置；新的拖动会使旧 seek 无权清除当前预览。
 */
export function useProgressScrub(options: UseProgressScrubOptions) {
  const previewPositionMs = shallowRef<number>()
  let interactionGeneration = 0

  const displayedPositionMs = computed(
    () => previewPositionMs.value ?? options.playbackPositionMs.value,
  )

  function preview(positionMs: number): void {
    interactionGeneration += 1
    previewPositionMs.value = positionMs
  }

  async function commit(positionMs: number): Promise<void> {
    previewPositionMs.value = positionMs
    const generation = ++interactionGeneration
    try {
      await options.seek(positionMs)
    } finally {
      if (generation === interactionGeneration) previewPositionMs.value = undefined
    }
  }

  function reset(): void {
    interactionGeneration += 1
    previewPositionMs.value = undefined
  }

  return {
    displayedPositionMs,
    preview,
    commit,
    reset,
  }
}
