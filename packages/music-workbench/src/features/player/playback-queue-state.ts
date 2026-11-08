import type { PlaybackMode } from '@any-music/core'

/** 待听快照只保存稳定曲目 ID、排列设置与入队时间，不复制 Track 或媒体地址。 */
export const PLAYBACK_QUEUE_SCHEMA_VERSION = 1 as const
export const MAX_PLAYBACK_QUEUE_ITEM_COUNT = 5_000
export type QueueArrangementMode = 'flat' | 'platform'

export interface PlaybackQueueSnapshot {
  schemaVersion: typeof PLAYBACK_QUEUE_SCHEMA_VERSION
  trackIds: readonly string[]
  mode: PlaybackMode
  arrangementMode: QueueArrangementMode
  /** 可选的入队时间；无有效记录时保持未知，不伪造日期。 */
  addedAtMsByTrackId?: Readonly<Record<string, number>>
}

export function createEmptyPlaybackQueue(): PlaybackQueueSnapshot {
  return {
    schemaVersion: PLAYBACK_QUEUE_SCHEMA_VERSION,
    trackIds: [],
    mode: 'sequence',
    arrangementMode: 'flat',
  }
}

/** 稳定存储属于不可信边界；损坏项会被跳过，重复 ID 保留第一次出现的顺序。 */
export function sanitizePlaybackQueueSnapshot(input: unknown): PlaybackQueueSnapshot {
  if (!isRecord(input) || input.schemaVersion !== PLAYBACK_QUEUE_SCHEMA_VERSION) {
    return createEmptyPlaybackQueue()
  }
  const trackIds = new Set<string>()
  if (Array.isArray(input.trackIds)) {
    for (const candidate of input.trackIds) {
      if (trackIds.size >= MAX_PLAYBACK_QUEUE_ITEM_COUNT) break
      if (typeof candidate !== 'string') continue
      const trackId = candidate.trim()
      if (trackId && trackId.length <= 1_000) trackIds.add(trackId)
    }
  }
  const addedTimes = isRecord(input.addedAtMsByTrackId) ? input.addedAtMsByTrackId : undefined
  return {
    schemaVersion: PLAYBACK_QUEUE_SCHEMA_VERSION,
    trackIds: [...trackIds],
    mode: isPlaybackMode(input.mode) ? input.mode : 'sequence',
    arrangementMode: input.arrangementMode === 'platform' ? 'platform' : 'flat',
    ...(addedTimes
      ? {
          addedAtMsByTrackId: Object.fromEntries(
            [...trackIds].flatMap((id) => {
              const timestamp = addedTimes[id]
              return typeof timestamp === 'number' &&
                Number.isFinite(timestamp) &&
                timestamp >= 0 &&
                timestamp <= 8.64e15
                ? [[id, timestamp]]
                : []
            }),
          ),
        }
      : {}),
  }
}

/** 筛选后的拖动只重排可见 ID 的槽位，隐藏项原位保留；传入顺序不能覆盖事实队列。 */
export function reorderQueueIds(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
  visibleIds: readonly string[] = ids,
): readonly string[] {
  const eligible = new Set(visibleIds)
  const visible = ids.filter((id) => eligible.has(id))
  const from = visible.indexOf(draggedId)
  const to = visible.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return ids
  visible.splice(from, 1)
  visible.splice(to, 0, draggedId)
  let index = 0
  return ids.map((id) => (eligible.has(id) ? visible[index++]! : id))
}

function isPlaybackMode(input: unknown): input is PlaybackMode {
  return (
    input === 'sequence' ||
    input === 'repeat-one' ||
    input === 'shuffle' ||
    input === 'shuffle-no-repeat'
  )
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}
