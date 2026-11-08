import type { CompiledSegmentRecipe } from './models'

export const DEFAULT_VIRTUAL_AUDIO_CHUNK_DURATION_MS = 4_000

/**
 * 自定义歌曲的运行时解码块；它只描述叶子媒体上的时间范围，不包含临时 URL 或媒体字节。
 * 固定上限避免一个很长的叶子片段在点击播放时被一次性解码为巨大的 PCM 缓冲区。
 */
export interface VirtualPlaybackChunk extends CompiledSegmentRecipe {
  key: string
  segmentIndex: number
}

export interface SelectVirtualPlaybackWindowOptions {
  /** 从当前位置起希望至少覆盖的虚拟时长，单位为毫秒。 */
  lookAheadMs: number
  /** 短片段场景下至少同时准备的块数。 */
  minimumChunkCount: number
  /** 防止极端碎片配方在一次补窗中发起无限请求。 */
  maximumChunkCount: number
}

/**
 * 把编译后的叶子时间线切为有界解码块。片段边界永远保留，长片段才会继续细分，
 * 因而 seek、来源切换和署名仍能精确对应原始配方。
 */
export function createVirtualPlaybackChunks(
  segments: readonly CompiledSegmentRecipe[],
  maximumDurationMs = DEFAULT_VIRTUAL_AUDIO_CHUNK_DURATION_MS,
): readonly VirtualPlaybackChunk[] {
  if (!Number.isSafeInteger(maximumDurationMs) || maximumDurationMs <= 0) {
    throw new TypeError('虚拟音频解码块时长必须是正整数毫秒。')
  }

  const chunks: VirtualPlaybackChunk[] = []
  for (const [segmentIndex, segment] of segments.entries()) {
    // Public callers may bypass the compiler; invalid bounds must not create an infinite loop.
    if (
      ![segment.startMs, segment.endMs, segment.virtualStartMs, segment.virtualEndMs].every(
        Number.isSafeInteger,
      ) ||
      segment.startMs < 0 ||
      segment.virtualStartMs < 0 ||
      segment.endMs <= segment.startMs ||
      segment.endMs - segment.startMs !== segment.virtualEndMs - segment.virtualStartMs
    ) {
      throw new TypeError('虚拟音频片段必须使用长度一致的有效毫秒区间。')
    }
    let sourceStartMs = segment.startMs
    let virtualStartMs = segment.virtualStartMs
    let chunkIndex = 0
    while (virtualStartMs < segment.virtualEndMs) {
      const durationMs = Math.min(maximumDurationMs, segment.virtualEndMs - virtualStartMs)
      chunks.push({
        key: `${segmentIndex}:${chunkIndex}:${segment.sourceTrackId}:${sourceStartMs}`,
        segmentIndex,
        sourceTrackId: segment.sourceTrackId,
        startMs: sourceStartMs,
        endMs: sourceStartMs + durationMs,
        virtualStartMs,
        virtualEndMs: virtualStartMs + durationMs,
      })
      sourceStartMs += durationMs
      virtualStartMs += durationMs
      chunkIndex += 1
    }
  }
  return chunks
}

/** 使用二分查找定位包含指定虚拟播放位置的解码块。 */
export function locateVirtualPlaybackChunk(
  chunks: readonly VirtualPlaybackChunk[],
  virtualPositionMs: number,
): VirtualPlaybackChunk | undefined {
  return chunks[locateChunkIndex(chunks, virtualPositionMs)]
}

/** Return the index directly so selecting a window never rescans the full timeline. */
function locateChunkIndex(
  chunks: readonly VirtualPlaybackChunk[],
  virtualPositionMs: number,
): number {
  if (!Number.isFinite(virtualPositionMs) || virtualPositionMs < 0) return -1

  let low = 0
  let high = chunks.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const chunk = chunks[middle]
    if (!chunk) return -1
    if (virtualPositionMs < chunk.virtualStartMs) high = middle - 1
    else if (virtualPositionMs >= chunk.virtualEndMs) low = middle + 1
    else return middle
  }
  return -1
}

/**
 * 从当前位置选择连续预取窗口：正常片段按时间覆盖，密集短片段还会满足最少块数，
 * 最终受最大块数硬限制。调用方可分别传入较小的启动窗口和较大的滚动窗口。
 */
export function selectVirtualPlaybackWindow(
  chunks: readonly VirtualPlaybackChunk[],
  virtualPositionMs: number,
  options: SelectVirtualPlaybackWindowOptions,
): readonly VirtualPlaybackChunk[] {
  assertWindowOptions(options)
  const startIndex = locateChunkIndex(chunks, virtualPositionMs)
  if (startIndex < 0) return []
  const selected: VirtualPlaybackChunk[] = []

  for (let index = startIndex; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (!chunk || selected.length >= options.maximumChunkCount) break
    selected.push(chunk)
    const coveredMs = chunk.virtualEndMs - virtualPositionMs
    if (coveredMs >= options.lookAheadMs && selected.length >= options.minimumChunkCount) break
  }
  return selected
}

function assertWindowOptions(options: SelectVirtualPlaybackWindowOptions): void {
  if (!Number.isFinite(options.lookAheadMs) || options.lookAheadMs < 0) {
    throw new TypeError('虚拟音频预取时长不能为负数。')
  }
  if (
    !Number.isSafeInteger(options.minimumChunkCount) ||
    options.minimumChunkCount <= 0 ||
    !Number.isSafeInteger(options.maximumChunkCount) ||
    options.maximumChunkCount < options.minimumChunkCount
  ) {
    throw new TypeError('虚拟音频预取块数范围无效。')
  }
}
