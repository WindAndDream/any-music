import { createAppErrorState, sanitizeAppErrorState } from '../errors/app-error'
import type { AppErrorState } from '../errors/app-error'
import type { SegmentRecipe } from '../library/models'
import type { Track } from '../models/track'
import { sanitizeTrackAcquisition, sanitizeTrackMetadataUrl } from '../models/track'

export const DOWNLOAD_HISTORY_SCHEMA_VERSION = 2

export type DownloadOriginKind = 'music-list' | 'queue' | 'favorites' | 'playlist' | 'player'
export type DownloadBatchStatus = 'running' | 'completed' | 'cancelled' | 'interrupted'
export type DownloadItemStatus =
  | 'queued'
  | 'paused'
  | 'downloading'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
export type DownloadAttemptStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

/** 发起批量下载的界面上下文；名称快照保证列表以后改名仍能解释历史。 */
export interface DownloadOrigin {
  kind: DownloadOriginKind
  label: string
  referenceId?: string
}

/** 单次网络解析、读取和编码尝试；失败后重试不会覆盖上一轮错误。 */
export interface DownloadAttemptHistory {
  attemptNumber: number
  startedAtMs: number
  completedAtMs?: number
  status: DownloadAttemptStatus
  error?: AppErrorState
}

export interface DownloadedFileSummary {
  fileName: string
  extension: string
  mimeType: string
  sizeBytes: number
  /** Full saved-file digest, supplied by a runtime that can verify local files. */
  sha256?: string
}

/** 每首歌保存完整 Track 快照、全部尝试和最终文件结果。 */
export interface DownloadHistoryItem {
  id: string
  track: Track
  status: DownloadItemStatus
  requestedAtMs: number
  startedAtMs?: number
  completedAtMs?: number
  maxRetryCount: number
  /** Acknowledged saving is separate from transient file generation. */
  savedAtMs?: number
  /** Stable preview recipe captured at submission; never contains media URLs or bytes. */
  recipe?: readonly SegmentRecipe[]
  attempts: readonly DownloadAttemptHistory[]
  file?: DownloadedFileSummary
  /** The actual saved artifact (a song or batch ZIP), without a directory/path. */
  savedFile?: DownloadedFileSummary
  creatorName?: string
  error?: AppErrorState
  /** 保存最近的解析/解码阶段，刷新后仍可解释任务最后停在何处。 */
  progressMessage?: string
}

/** 一次提交形成一个批次；同一歌曲只在最新提交的批次中保留一条记录。 */
export interface DownloadHistoryBatch {
  id: string
  origin: DownloadOrigin
  status: DownloadBatchStatus
  startedAtMs: number
  completedAtMs?: number
  concurrency: number
  items: readonly DownloadHistoryItem[]
  /** 多曲下载最终只触发这一份 ZIP；单曲批次不设置该字段。 */
  archive?: DownloadedFileSummary
  archiveError?: AppErrorState
}

export interface DownloadHistorySnapshot {
  schemaVersion: typeof DOWNLOAD_HISTORY_SCHEMA_VERSION
  /** 新批次在前；历史不设数量上限，也不自动清理。 */
  batches: readonly DownloadHistoryBatch[]
}

export function createEmptyDownloadHistory(): DownloadHistorySnapshot {
  return { schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION, batches: [] }
}

/** GM 存储是不可信边界；单个损坏批次会被跳过，不影响其余永久历史。 */
export function sanitizeDownloadHistorySnapshot(input: unknown): DownloadHistorySnapshot {
  if (!isRecord(input) || input.schemaVersion !== DOWNLOAD_HISTORY_SCHEMA_VERSION) {
    return createEmptyDownloadHistory()
  }
  return {
    schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
    batches: deduplicateDownloadBatches(readArray(input.batches, sanitizeBatch)),
  }
}

/** Newest submission wins globally; a song keeps one selectable download record. */
export function deduplicateDownloadBatches(
  batches: readonly DownloadHistoryBatch[],
): DownloadHistoryBatch[] {
  const seen = new Set<string>()
  return batches.flatMap((batch) => {
    const items = batch.items.filter(({ track }) => {
      if (seen.has(track.id)) return false
      seen.add(track.id)
      return true
    })
    return items.length ? [{ ...batch, items }] : []
  })
}

/**
 * 页面关闭时浏览器不会可靠等待异步下载；下次加载把未完成状态标为中断，
 * 并保留原始开始时间和已经发生的每次尝试。
 */
export function finalizeInterruptedDownloads(
  snapshot: DownloadHistorySnapshot,
  detectedAtMs: number,
): DownloadHistorySnapshot {
  let changed = false
  const batches = snapshot.batches.map((batch) => {
    if (batch.status !== 'running') return batch
    changed = true
    const items = batch.items.map((item) => {
      if (item.status !== 'queued' && item.status !== 'downloading') return item
      const attempts = item.attempts.map((attempt) =>
        attempt.status === 'running'
          ? {
              ...attempt,
              status: 'interrupted' as const,
              completedAtMs: detectedAtMs,
              error: createAppErrorState(
                'download-interrupted',
                '页面关闭或刷新导致本次下载中断。',
              ),
            }
          : attempt,
      )
      return {
        ...item,
        status: 'interrupted' as const,
        completedAtMs: detectedAtMs,
        attempts,
        error: createAppErrorState('download-interrupted', '页面关闭或刷新导致下载中断。'),
      }
    })
    return {
      ...batch,
      status: 'interrupted' as const,
      completedAtMs: detectedAtMs,
      items,
    }
  })
  return changed ? { ...snapshot, batches } : snapshot
}

function sanitizeBatch(input: unknown): DownloadHistoryBatch | undefined {
  if (!isRecord(input)) return undefined
  const id = requiredString(input.id)
  const origin = sanitizeOrigin(input.origin)
  const status = readBatchStatus(input.status)
  const startedAtMs = readTimestamp(input.startedAtMs)
  const concurrency = readPositiveInteger(input.concurrency)
  if (!id || !origin || !status || startedAtMs === undefined || concurrency === undefined) {
    return undefined
  }
  return {
    id,
    origin,
    status,
    startedAtMs,
    completedAtMs: readTimestamp(input.completedAtMs),
    concurrency,
    items: readArray(input.items, sanitizeItem),
    archive: sanitizeFile(input.archive),
    archiveError: sanitizeAppErrorState(input.archiveError),
  }
}

function sanitizeOrigin(input: unknown): DownloadOrigin | undefined {
  if (!isRecord(input) || !isDownloadOriginKind(input.kind)) return undefined
  const label = requiredString(input.label)
  if (!label) return undefined
  return { kind: input.kind, label, referenceId: optionalString(input.referenceId) }
}

function sanitizeItem(input: unknown): DownloadHistoryItem | undefined {
  if (!isRecord(input)) return undefined
  const id = requiredString(input.id)
  const track = sanitizeTrack(input.track)
  const status = readItemStatus(input.status)
  const requestedAtMs = readTimestamp(input.requestedAtMs)
  const maxRetryCount = readNonNegativeInteger(input.maxRetryCount)
  if (!id || !track || !status || requestedAtMs === undefined || maxRetryCount === undefined) {
    return undefined
  }
  return {
    id,
    track,
    status,
    requestedAtMs,
    startedAtMs: readTimestamp(input.startedAtMs),
    completedAtMs: readTimestamp(input.completedAtMs),
    maxRetryCount,
    savedAtMs: readTimestamp(input.savedAtMs),
    recipe: Array.isArray(input.recipe)
      ? readArray(input.recipe, (segment) => {
          if (!isRecord(segment)) return undefined
          const sourceTrackId = requiredString(segment.sourceTrackId)
          const startMs = readNonNegativeNumber(segment.startMs)
          const endMs = readNonNegativeNumber(segment.endMs)
          return sourceTrackId && startMs !== undefined && endMs !== undefined && endMs > startMs
            ? { sourceTrackId, startMs, endMs }
            : undefined
        })
      : undefined,
    attempts: readArray(input.attempts, sanitizeAttempt),
    file: sanitizeFile(input.file),
    savedFile: sanitizeFile(input.savedFile),
    creatorName: optionalString(input.creatorName),
    error: sanitizeAppErrorState(input.error),
    progressMessage: optionalString(input.progressMessage),
  }
}

function sanitizeAttempt(input: unknown): DownloadAttemptHistory | undefined {
  if (!isRecord(input) || !isAttemptStatus(input.status)) return undefined
  const attemptNumber = readPositiveInteger(input.attemptNumber)
  const startedAtMs = readTimestamp(input.startedAtMs)
  if (attemptNumber === undefined || startedAtMs === undefined) return undefined
  return {
    attemptNumber,
    startedAtMs,
    completedAtMs: readTimestamp(input.completedAtMs),
    status: input.status,
    error: sanitizeAppErrorState(input.error),
  }
}

function sanitizeFile(input: unknown): DownloadedFileSummary | undefined {
  if (!isRecord(input)) return undefined
  const fileName = requiredString(input.fileName)
  const extension = requiredString(input.extension)
  const mimeType = requiredString(input.mimeType)
  const sizeBytes = readNonNegativeInteger(input.sizeBytes)
  if (!fileName || !extension || !mimeType || sizeBytes === undefined) return undefined
  const sha256 =
    typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.sha256)
      ? input.sha256
      : undefined
  return { fileName, extension, mimeType, sizeBytes, sha256 }
}

function sanitizeTrack(input: unknown): Track | undefined {
  if (!isRecord(input) || !isRecord(input.source) || !Array.isArray(input.artists)) {
    return undefined
  }
  if (
    typeof input.id !== 'string' ||
    typeof input.title !== 'string' ||
    typeof input.source.pluginId !== 'string' ||
    typeof input.source.resourceId !== 'string' ||
    (input.source.mediaKind !== 'audio' &&
      input.source.mediaKind !== 'video' &&
      input.source.mediaKind !== 'custom')
  ) {
    return undefined
  }
  const artists = input.artists
    .map((artist) => {
      if (!isRecord(artist) || typeof artist.name !== 'string') return undefined
      return { name: artist.name, id: optionalString(artist.id) }
    })
    .filter((artist) => artist !== undefined)
  if (artists.length === 0) return undefined
  return {
    id: input.id,
    title: input.title,
    artists,
    artworkUrl: sanitizeTrackMetadataUrl(input.artworkUrl),
    durationMs: readNonNegativeNumber(input.durationMs),
    publishedAtMs: readNonNegativeNumber(input.publishedAtMs),
    description: optionalString(input.description),
    sourceTags: readStringArray(input.sourceTags),
    statistics: sanitizeStatistics(input.statistics),
    acquisition: sanitizeTrackAcquisition(input.acquisition),
    source: {
      pluginId: input.source.pluginId,
      mediaKind: input.source.mediaKind,
      resourceId: input.source.resourceId,
      partId: optionalString(input.source.partId),
      pageUrl: sanitizeTrackMetadataUrl(input.source.pageUrl),
    },
  }
}

function sanitizeStatistics(input: unknown): Track['statistics'] {
  if (!isRecord(input)) return undefined
  return {
    playCount: readNonNegativeNumber(input.playCount),
    danmakuCount: readNonNegativeNumber(input.danmakuCount),
    favoriteCount: readNonNegativeNumber(input.favoriteCount),
    commentCount: readNonNegativeNumber(input.commentCount),
    likeCount: readNonNegativeNumber(input.likeCount),
  }
}

function readBatchStatus(input: unknown): DownloadBatchStatus | undefined {
  return input === 'running' ||
    input === 'completed' ||
    input === 'cancelled' ||
    input === 'interrupted'
    ? input
    : undefined
}

function readItemStatus(input: unknown): DownloadItemStatus | undefined {
  return input === 'queued' ||
    input === 'paused' ||
    input === 'downloading' ||
    input === 'succeeded' ||
    input === 'failed' ||
    input === 'cancelled' ||
    input === 'interrupted'
    ? input
    : undefined
}

function isAttemptStatus(input: unknown): input is DownloadAttemptStatus {
  return (
    input === 'running' ||
    input === 'succeeded' ||
    input === 'failed' ||
    input === 'cancelled' ||
    input === 'interrupted'
  )
}

function isDownloadOriginKind(input: unknown): input is DownloadOriginKind {
  return (
    input === 'music-list' ||
    input === 'queue' ||
    input === 'favorites' ||
    input === 'playlist' ||
    input === 'player'
  )
}

function readArray<T>(input: unknown, mapper: (value: unknown) => T | undefined): T[] {
  return Array.isArray(input)
    ? input.map(mapper).filter((value): value is T => value !== undefined)
    : []
}

function readStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === 'string')
    : []
}

function requiredString(input: unknown): string | undefined {
  return typeof input === 'string' && input.length > 0 ? input : undefined
}

function optionalString(input: unknown): string | undefined {
  return typeof input === 'string' ? input : undefined
}

function readTimestamp(input: unknown): number | undefined {
  return readNonNegativeNumber(input)
}

function readNonNegativeNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined
}

function readNonNegativeInteger(input: unknown): number | undefined {
  return Number.isSafeInteger(input) && (input as number) >= 0 ? (input as number) : undefined
}

function readPositiveInteger(input: unknown): number | undefined {
  return Number.isSafeInteger(input) && (input as number) > 0 ? (input as number) : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}
