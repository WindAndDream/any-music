import type { CompiledSegmentRecipe, SegmentRecipe } from './models'
export type SegmentRecipeErrorCode =
  | 'empty-recipe'
  | 'invalid-range'
  | 'source-not-found'
  | 'duration-exceeded'
  | 'circular-reference'

export class SegmentRecipeError extends Error {
  readonly code: SegmentRecipeErrorCode
  readonly sourceTrackId?: string

  constructor(code: SegmentRecipeErrorCode, message: string, sourceTrackId?: string) {
    super(message)
    this.code = code
    this.name = 'SegmentRecipeError'
    this.sourceTrackId = sourceTrackId
  }
}

export interface CompileSegmentRecipeOptions {
  customTrackId?: string
  resolveTrack: (trackId: string) => { durationMs?: number } | undefined
  resolveCustomTrack: (trackId: string) => { recipe: readonly SegmentRecipe[] } | undefined
}

interface LeafSegment {
  sourceTrackId: string
  startMs: number
  endMs: number
}

/**
 * 将递归自定义歌曲编译为普通平台曲目的有序叶子片段。
 *
 * 算法按访问栈检测环；嵌套区间通过虚拟时间轴求交后映射回叶子时间轴，
 * 最后合并同源连续片段，时间复杂度与实际展开后的叶子片段数线性相关。
 */
export function compileSegmentRecipe(
  recipe: readonly SegmentRecipe[],
  options: CompileSegmentRecipeOptions,
): readonly CompiledSegmentRecipe[] {
  if (recipe.length === 0) {
    throw new SegmentRecipeError('empty-recipe', '自定义歌曲至少需要一个片段。')
  }

  const stack = new Set<string>()
  // 同一自定义歌曲在一条配方中可能被多次截取；完整时间线只递归编译一次。
  const timelineCache = new Map<string, readonly CompiledSegmentRecipe[]>()
  if (options.customTrackId) stack.add(options.customTrackId)
  const leaves = expandRecipe(recipe, options, stack, timelineCache)
  return addVirtualTimeline(mergeAdjacentSegments(leaves))
}

/** 使用二分查找把虚拟播放位置映射到一个叶子片段。 */
export function locateCompiledSegment(
  segments: readonly CompiledSegmentRecipe[],
  virtualPositionMs: number,
): CompiledSegmentRecipe | undefined {
  if (!Number.isFinite(virtualPositionMs) || virtualPositionMs < 0) return undefined

  let low = 0
  let high = segments.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const segment = segments[middle]
    if (!segment) return undefined
    if (virtualPositionMs < segment.virtualStartMs) high = middle - 1
    else if (virtualPositionMs >= segment.virtualEndMs) low = middle + 1
    else return segment
  }
  return undefined
}

export function getCompiledDurationMs(segments: readonly CompiledSegmentRecipe[]): number {
  return segments.at(-1)?.virtualEndMs ?? 0
}

function expandRecipe(
  recipe: readonly SegmentRecipe[],
  options: CompileSegmentRecipeOptions,
  stack: Set<string>,
  timelineCache: Map<string, readonly CompiledSegmentRecipe[]>,
): LeafSegment[] {
  const leaves: LeafSegment[] = []
  for (const segment of recipe) {
    for (const leaf of expandSegment(segment, options, stack, timelineCache)) leaves.push(leaf)
  }
  return leaves
}

function expandSegment(
  segment: SegmentRecipe,
  options: CompileSegmentRecipeOptions,
  stack: Set<string>,
  timelineCache: Map<string, readonly CompiledSegmentRecipe[]>,
): LeafSegment[] {
  assertValidRange(segment)
  const customTrack = options.resolveCustomTrack(segment.sourceTrackId)
  if (customTrack) {
    if (stack.has(segment.sourceTrackId)) {
      throw new SegmentRecipeError(
        'circular-reference',
        `自定义歌曲存在循环引用：${segment.sourceTrackId}`,
        segment.sourceTrackId,
      )
    }

    let sourceTimeline = timelineCache.get(segment.sourceTrackId)
    if (!sourceTimeline) {
      stack.add(segment.sourceTrackId)
      try {
        sourceTimeline = addVirtualTimeline(
          mergeAdjacentSegments(expandRecipe(customTrack.recipe, options, stack, timelineCache)),
        )
        timelineCache.set(segment.sourceTrackId, sourceTimeline)
      } finally {
        stack.delete(segment.sourceTrackId)
      }
    }
    const durationMs = getCompiledDurationMs(sourceTimeline)
    if (segment.endMs > durationMs) {
      throw new SegmentRecipeError(
        'duration-exceeded',
        `片段结束位置超过自定义歌曲时长：${segment.sourceTrackId}`,
        segment.sourceTrackId,
      )
    }
    return sliceCompiledTimeline(sourceTimeline, segment.startMs, segment.endMs)
  }

  const sourceTrack = options.resolveTrack(segment.sourceTrackId)
  if (!sourceTrack) {
    throw new SegmentRecipeError(
      'source-not-found',
      `找不到片段来源曲目：${segment.sourceTrackId}`,
      segment.sourceTrackId,
    )
  }
  if (sourceTrack.durationMs !== undefined && segment.endMs > sourceTrack.durationMs) {
    throw new SegmentRecipeError(
      'duration-exceeded',
      `片段结束位置超过来源曲目时长：${segment.sourceTrackId}`,
      segment.sourceTrackId,
    )
  }
  return [{ ...segment }]
}

function assertValidRange(segment: SegmentRecipe): void {
  if (
    !segment.sourceTrackId ||
    !Number.isSafeInteger(segment.startMs) ||
    !Number.isSafeInteger(segment.endMs) ||
    segment.startMs < 0 ||
    segment.endMs <= segment.startMs
  ) {
    throw new SegmentRecipeError(
      'invalid-range',
      `片段区间无效：${segment.sourceTrackId || '未知来源'}`,
      segment.sourceTrackId || undefined,
    )
  }
}

function sliceCompiledTimeline(
  timeline: readonly CompiledSegmentRecipe[],
  startMs: number,
  endMs: number,
): LeafSegment[] {
  const result: LeafSegment[] = []
  // 前缀虚拟时间轴单调递增；先二分定位首个可能重叠项，再只扫描输出区间。
  let low = 0
  let high = timeline.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const segment = timeline[middle]
    if (segment && segment.virtualEndMs <= startMs) low = middle + 1
    else high = middle
  }

  for (let index = low; index < timeline.length; index += 1) {
    const leaf = timeline[index]
    if (!leaf || leaf.virtualStartMs >= endMs) break
    const overlapStartMs = Math.max(startMs, leaf.virtualStartMs)
    const overlapEndMs = Math.min(endMs, leaf.virtualEndMs)
    if (overlapEndMs <= overlapStartMs) continue

    result.push({
      sourceTrackId: leaf.sourceTrackId,
      startMs: leaf.startMs + overlapStartMs - leaf.virtualStartMs,
      endMs: leaf.startMs + overlapEndMs - leaf.virtualStartMs,
    })
  }
  return result
}

function mergeAdjacentSegments(segments: readonly LeafSegment[]): LeafSegment[] {
  const result: LeafSegment[] = []
  for (const segment of segments) {
    const previous = result.at(-1)
    if (previous?.sourceTrackId === segment.sourceTrackId && previous.endMs === segment.startMs) {
      previous.endMs = segment.endMs
    } else {
      result.push({ ...segment })
    }
  }
  return result
}

function addVirtualTimeline(segments: readonly LeafSegment[]): CompiledSegmentRecipe[] {
  let virtualPositionMs = 0
  return segments.map((segment) => {
    const durationMs = segment.endMs - segment.startMs
    if (!Number.isSafeInteger(virtualPositionMs + durationMs)) {
      throw new SegmentRecipeError(
        'invalid-range',
        '拼接时间线超过安全整数毫秒范围。',
        segment.sourceTrackId,
      )
    }
    const compiled = {
      ...segment,
      virtualStartMs: virtualPositionMs,
      virtualEndMs: virtualPositionMs + durationMs,
    }
    virtualPositionMs += durationMs
    return compiled
  })
}
