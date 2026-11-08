import { formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import type { DownloadHistoryBatch, DownloadItemStatus, Track } from '@any-music/core'
import { computed, getCurrentScope, onScopeDispose, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

/** Paused downloads resume through the task collection. */
export type PlayerDownloadStatus = DownloadItemStatus | 'busy'

export interface PlayerDownloadNotice {
  trackId: string
  trackTitle: string
  status: PlayerDownloadStatus
  detail?: string
}

interface UsePlayerDownloadOptions {
  batches: MaybeRefOrGetter<readonly DownloadHistoryBatch[]>
  isBusy: MaybeRefOrGetter<boolean>
  startDownload: (track: Track) => Promise<string | undefined>
  /** 仅响应本次点击或其启动失败，不随下载阶段变化自动重复通知。 */
  onNotice?: (notice: PlayerDownloadNotice) => void
}

const statusLabels: Record<PlayerDownloadStatus, string> = {
  queued: '等待下载',
  downloading: '歌曲下载中',
  succeeded: '歌曲已下载',
  paused: '下载暂停中',
  failed: '歌曲下载失败',
  cancelled: '下载已取消',
  interrupted: '下载已中断',
  busy: '暂时无法开始下载',
}

export function getPlayerDownloadStatusLabel(status: PlayerDownloadStatus): string {
  return statusLabels[status]
}

export function formatPlayerDownloadNotice(notice: PlayerDownloadNotice): string {
  const detail = ['failed', 'cancelled', 'interrupted', 'busy'].includes(notice.status)
    ? notice.detail
    : undefined
  return `${notice.trackTitle} · ${getPlayerDownloadStatusLabel(notice.status)}${detail ? `：${detail}` : ''}`
}

/** 最新的同曲任务决定提示；生成成功仍需等整批保存成功，才能声明已下载。 */
function findDownloadNotice(
  track: Track,
  batches: readonly DownloadHistoryBatch[],
): PlayerDownloadNotice | undefined {
  for (const batch of batches) {
    const item = batch.items.find((candidate) => candidate.track.id === track.id)
    if (!item) continue
    let status: PlayerDownloadStatus = item.status
    let detail = item.error ? formatAppErrorMessage(item.error) : item.progressMessage
    if (item.status === 'succeeded' && item.savedAtMs === undefined) {
      if (batch.status === 'running') {
        status = 'downloading'
        detail = '歌曲文件已生成，正在等待保存。'
      } else if (batch.status === 'cancelled' || batch.status === 'interrupted') {
        status = batch.status
        detail = batch.archiveError
          ? formatAppErrorMessage(batch.archiveError)
          : '歌曲文件尚未保存，请重新下载。'
      } else if (batch.archiveError) {
        // 用户取消原生保存不等于文件已下载；保留 AM-1005 并允许下一次点击重试。
        status = batch.archiveError.code === 'operation-cancelled' ? 'cancelled' : 'failed'
        detail = formatAppErrorMessage(batch.archiveError)
      } else {
        detail = undefined
      }
    }
    return { trackId: track.id, trackTitle: track.title, status, detail }
  }
  return undefined
}

/** 与播放器采用同一保存判定，批量操作不能把生成完成或取消保存当成已下载。 */
export function getDownloadedTrackIds(
  batches: readonly DownloadHistoryBatch[],
): ReadonlySet<string> {
  const seen = new Set<string>()
  const downloaded = new Set<string>()
  for (const batch of batches) {
    for (const item of batch.items) {
      const { track } = item
      if (seen.has(track.id)) continue
      seen.add(track.id)
      if (
        item.status === 'succeeded' &&
        (item.savedAtMs !== undefined || (batch.status === 'completed' && !batch.archiveError))
      )
        downloaded.add(track.id)
    }
  }
  return downloaded
}

/** 控制栏只提交一次下载；提示跟随所点击歌曲，不被切歌或其他批次的结果覆盖。 */
export function usePlayerDownload(options: UsePlayerDownloadOptions) {
  const selectedTrack = shallowRef<Track>()
  const localNotice = shallowRef<PlayerDownloadNotice>()
  let generation = 0
  let pendingRequest: { trackId: string; generation: number } | undefined
  if (getCurrentScope())
    onScopeDispose(() => {
      generation += 1
    })
  const notice = computed(() => {
    const track = selectedTrack.value
    if (!track) return undefined
    return (
      localNotice.value ??
      findDownloadNotice(track, toValue(options.batches)) ?? {
        trackId: track.id,
        trackTitle: track.title,
        status: 'downloading' as const,
      }
    )
  })

  function publishNotice(): void {
    if (notice.value) options.onNotice?.(notice.value)
  }

  function requestDownload(track: Track): void {
    const existing = findDownloadNotice(track, toValue(options.batches))
    const canRestart =
      existing &&
      ['succeeded', 'paused', 'failed', 'cancelled', 'interrupted'].includes(existing.status)
    // 管理器已释放并发池时，允许跨过 Promise 尚未回调的完成边界立即重新下载。
    if (pendingRequest?.trackId === track.id && canRestart && !toValue(options.isBusy))
      pendingRequest = undefined
    if (selectedTrack.value?.id === track.id && pendingRequest?.trackId === track.id) {
      publishNotice()
      return
    }
    const currentGeneration = ++generation
    selectedTrack.value = track
    localNotice.value = undefined
    if (existing && !canRestart) {
      publishNotice()
      return
    }
    if (pendingRequest || toValue(options.isBusy)) {
      localNotice.value = {
        trackId: track.id,
        trackTitle: track.title,
        status: 'busy',
        detail: '已有其他下载或导出任务正在处理，请等待完成后再试。',
      }
      publishNotice()
      return
    }
    // 启动失败属于当前点击的结果；旧任务晚到的失败不能覆盖另一首歌的提示。
    pendingRequest = { trackId: track.id, generation: currentGeneration }
    const reportFailure = (error: unknown): void => {
      if (pendingRequest?.generation === currentGeneration) pendingRequest = undefined
      if (generation !== currentGeneration) return
      localNotice.value = {
        trackId: track.id,
        trackTitle: track.title,
        status: 'failed',
        detail: formatAppErrorMessage(toAppErrorState(error, 'download-failed')),
      }
      publishNotice()
    }
    try {
      void options.startDownload(track).then((batchId) => {
        // 同曲已重试时，旧 Promise 不能清除新任务的防重复标记。
        if (pendingRequest?.generation === currentGeneration) pendingRequest = undefined
        if (generation !== currentGeneration || batchId) return
        reportFailure(new Error('下载任务未能启动，请稍后重试。'))
      }, reportFailure)
      publishNotice()
    } catch (error) {
      reportFailure(error)
    }
  }

  return { notice, requestDownload }
}
