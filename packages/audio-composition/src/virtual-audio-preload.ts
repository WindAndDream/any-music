import type { VirtualPlaybackChunk } from './virtual-playback-plan'

export interface PreloadVirtualAudioChunksOptions {
  concurrency: number
  shouldContinue: () => boolean
  loadChunk: (chunk: VirtualPlaybackChunk) => Promise<void>
  onChunkLoaded?: () => void
}

/**
 * 按时间线顺序把预取块分配给固定数量的 worker。最靠近播放点的块会先占满并发槽，
 * 任一槽完成后立即领取后续短片段，避免一秒级配方退化为逐片串行加载。
 */
export async function preloadVirtualAudioChunks(
  chunks: readonly VirtualPlaybackChunk[],
  options: PreloadVirtualAudioChunksOptions,
): Promise<void> {
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency <= 0) {
    throw new TypeError('虚拟音频预取并发数必须是正整数。')
  }

  let nextIndex = 0
  let hasFailed = false
  const workers = Array.from({ length: Math.min(options.concurrency, chunks.length) }, async () => {
    while (nextIndex < chunks.length) {
      const chunk = chunks[nextIndex]
      nextIndex += 1
      if (!chunk || hasFailed || !options.shouldContinue()) return
      // 每个 worker 内保持顺序，worker 之间并行覆盖连续的前向时间窗。
      try {
        // eslint-disable-next-line no-await-in-loop
        await options.loadChunk(chunk)
      } catch (error) {
        // Stop assigning queued work after failure; the caller owns aborting in-flight reads.
        hasFailed = true
        throw error
      }
      if (!options.shouldContinue()) return
      options.onChunkLoaded?.()
    }
  })
  await Promise.all(workers)
}
