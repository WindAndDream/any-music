import { getCompiledDurationMs, locateCompiledSegment } from '@any-music/core'
import type { CompiledSegmentRecipe } from '@any-music/core'

/** 一次自定义歌曲 seek 在虚拟时间轴与叶子媒体时间轴上的稳定映射。 */
export interface CustomSegmentSeekTarget {
  segmentIndex: number
  virtualPositionMs: number
  sourcePositionMs: number
}

/**
 * 将用户选择的自定义歌曲位置映射到叶子片段。末端保持为开区间内的最后 1 ms，
 * 让播放器仍能选中最后一个片段并由正常 ended 流程完成整首歌曲。
 */
export function createCustomSegmentSeekTarget(
  segments: readonly CompiledSegmentRecipe[],
  positionMs: number,
): CustomSegmentSeekTarget | undefined {
  const durationMs = getCompiledDurationMs(segments)
  if (durationMs <= 0) return undefined
  const virtualPositionMs = Math.min(
    Math.max(0, Math.round(Number.isFinite(positionMs) ? positionMs : 0)),
    durationMs - 1,
  )
  const segment = locateCompiledSegment(segments, virtualPositionMs)
  if (!segment) return undefined
  const segmentIndex = segments.indexOf(segment)
  if (segmentIndex < 0) return undefined
  return {
    segmentIndex,
    virtualPositionMs,
    sourcePositionMs: segment.startMs + virtualPositionMs - segment.virtualStartMs,
  }
}

/** 自动衔接片段时复用与手动 seek 相同的目标结构，避免出现两套时间换算规则。 */
export function createCustomSegmentStartTarget(
  segments: readonly CompiledSegmentRecipe[],
  segmentIndex: number,
  offsetMs = 0,
): CustomSegmentSeekTarget | undefined {
  const segment = segments[segmentIndex]
  if (!segment) return undefined
  const segmentDurationMs = segment.virtualEndMs - segment.virtualStartMs
  const normalizedOffsetMs = Math.min(
    Math.max(0, Math.round(Number.isFinite(offsetMs) ? offsetMs : 0)),
    Math.max(0, segmentDurationMs - 1),
  )
  return {
    segmentIndex,
    virtualPositionMs: segment.virtualStartMs + normalizedOffsetMs,
    sourcePositionMs: segment.startMs + normalizedOffsetMs,
  }
}

/**
 * 只有正确叶子媒体的原生时钟到达目标后，旧媒体事件才可以解除虚拟位置锁。
 * 100 ms 与播放器时间轴步进一致，也容纳音频包边界带来的轻微取整。
 */
export function hasReachedCustomSegmentSeekTarget(
  target: CustomSegmentSeekTarget,
  loadedSegmentIndex: number | undefined,
  sourcePositionMs: number | undefined,
  toleranceMs = 100,
): boolean {
  return (
    loadedSegmentIndex === target.segmentIndex &&
    sourcePositionMs !== undefined &&
    Number.isFinite(sourcePositionMs) &&
    Math.abs(sourcePositionMs - target.sourcePositionMs) <= toleranceMs
  )
}

/** 自动换源会暂时暂停 audio；逻辑播放意图必须独立于这次内部 pause。 */
export function shouldAutoplayCustomSegment(
  hasCustomAutoplayIntent: boolean,
  isNativePlaying: boolean,
  hasPendingNativeAutoplay: boolean,
): boolean {
  return hasCustomAutoplayIntent || isNativePlaying || hasPendingNativeAutoplay
}
