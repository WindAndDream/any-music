import {
  AppError,
  createAppErrorState,
  deduplicateDownloadBatches,
  formatAppErrorMessage,
  MAX_DOWNLOAD_RETRY_COUNT,
  normalizeDownloadConcurrency,
  runConcurrentDownloads,
  toAppErrorState,
} from '@any-music/core'
import type {
  AppErrorState,
  ConcurrentDownloadResult,
  RunConcurrentDownloadsOptions,
  MediaResolveOptions,
  ResolvedMediaSource,
  SegmentRecipe,
  Track,
} from '@any-music/core'
import {
  DOWNLOAD_HISTORY_SCHEMA_VERSION,
  type DownloadHistoryBatch,
  type DownloadHistoryItem,
  type DownloadHistorySnapshot,
  type DownloadOrigin,
  type DownloadedFileSummary,
} from '@any-music/core'
import { computed, getCurrentScope, onScopeDispose, readonly, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import type { WorkbenchRuntime } from '../../runtime/workbench-runtime'
import { downloadHistoryRepository } from '../../storage/download-history-repository'
import { createAudioDownloadFileName, downloadBlob } from '../audio-export/download-audio'
import type { GeneratedDownloadFile } from './download-archive'
import {
  browserDownloadScheduler,
  type DownloadScheduler,
  type DownloadSchedule,
} from './download-scheduler'

interface UseDownloadManagerOptions {
  scheduler?: DownloadScheduler
  verifyDownload?: WorkbenchRuntime['verifyDownload']
  concurrency: MaybeRefOrGetter<number>
  creatorName: MaybeRefOrGetter<string>
  createRecipe: (track: Track) => readonly SegmentRecipe[]
  resolveTrack: (trackId: string) => Track | undefined
  resolveMedia: (track: Track, options?: MediaResolveOptions) => Promise<ResolvedMediaSource>
  subscribeSourceInvalidation?: WorkbenchRuntime['subscribeSourceInvalidation']
}

interface StartDownloadBatchOptions {
  resumeBatchId?: string
  resumeItemIds?: ReadonlySet<string>
  tracks: readonly Track[]
  origin: DownloadOrigin
  /** 播放器试听内容使用点击时的叶子配方，不读取以后可能变化的当前时间线。 */
  createRecipe?: UseDownloadManagerOptions['createRecipe']
}

/**
 * 下载编排向运行端申请唯一并发池，并把任务状态写入独立历史仓库。
 * 组件只提交规范 Track 与来源上下文，不接触媒体 URL、GM 请求或 Blob。
 */
export function useDownloadManager(options: UseDownloadManagerOptions) {
  const loaded = loadHistory()
  const batches = shallowRef<readonly DownloadHistoryBatch[]>(
    deduplicateDownloadBatches(loaded.snapshot.batches),
  )
  const activeBatchId = shallowRef<string>()
  const statusMessage = shallowRef('')
  const persistenceErrorState = shallowRef<AppErrorState | undefined>(loaded.error)
  const persistenceError = computed(() =>
    persistenceErrorState.value ? formatAppErrorMessage(persistenceErrorState.value) : '',
  )
  const isCancelling = shallowRef(false)
  const isBusy = computed(() => activeBatchId.value !== undefined)
  const activeBatch = computed(() =>
    batches.value.find((batch) => batch.id === activeBatchId.value),
  )
  const activeItemCount = computed(
    () =>
      activeBatch.value?.items.filter(
        (item) => item.status === 'queued' || item.status === 'downloading',
      ).length ?? 0,
  )
  const itemCount = computed(() =>
    batches.value.reduce((total, batch) => total + batch.items.length, 0),
  )
  let activeController: AbortController | undefined
  let activeTaskControllers: ReadonlyMap<string, AbortController> = new Map()
  const pausedItemIds = new Set<string>()
  const pendingResumes = new Set<string>()
  const restartQueue = new Set<string>()
  let enqueueActiveItems: ((items: readonly DownloadHistoryItem[]) => void) | undefined
  let disposed = false

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      restartQueue.clear()
      activeController?.abort()
      for (const controller of activeTaskControllers.values()) controller.abort()
    })
  }

  async function startDownloadBatch(
    request: StartDownloadBatchOptions,
  ): Promise<string | undefined> {
    if (isBusy.value) {
      statusMessage.value = '已有下载批次正在处理，请等待完成或先中止当前批次。'
      return undefined
    }

    if (disposed) return undefined
    const tracks = deduplicateTracks(request.tracks)
    if (tracks.length === 0) return undefined
    const startedAtMs = Date.now()
    const batchId = request.resumeBatchId ?? `download-batch:${crypto.randomUUID()}`
    const concurrency = normalizeDownloadConcurrency(toValue(options.concurrency))
    const previousBatch = batches.value.find((candidate) => candidate.id === request.resumeBatchId)
    const previousItems = new Map(
      batches.value.flatMap((candidate) =>
        candidate.items.map((item) => [item.track.id, item] as const),
      ),
    )
    const creatorName = toValue(options.creatorName)
    const batch: DownloadHistoryBatch = previousBatch
      ? {
          ...previousBatch,
          status: 'running',
          completedAtMs: undefined,
          archiveError: undefined,
          concurrency,
          items: previousBatch.items.map((item) =>
            request.resumeItemIds?.has(item.id)
              ? {
                  ...item,
                  status: 'queued',
                  completedAtMs: undefined,
                  savedAtMs: undefined,
                  savedFile: item.creatorName === creatorName ? item.savedFile : undefined,
                  creatorName,
                  error: undefined,
                  progressMessage: '等待继续下载',
                }
              : item.status === 'succeeded' &&
                  item.savedAtMs === undefined &&
                  (previousBatch.archiveError ||
                    previousBatch.status === 'cancelled' ||
                    previousBatch.status === 'interrupted')
                ? {
                    ...item,
                    status: 'failed',
                    error:
                      previousBatch.archiveError ??
                      createAppErrorState('download-interrupted', '歌曲文件尚未保存，请重新下载。'),
                    progressMessage: '歌曲文件尚未保存，请重新下载。',
                  }
                : item.status === 'succeeded' &&
                    previousBatch.status === 'completed' &&
                    !previousBatch.archiveError
                  ? {
                      ...item,
                      savedAtMs: item.savedAtMs ?? previousBatch.completedAtMs ?? startedAtMs,
                    }
                  : item,
          ),
        }
      : {
          id: batchId,
          origin: request.origin,
          status: 'running',
          startedAtMs,
          concurrency,
          items: tracks.map((track) => {
            const previous = previousItems.get(track.id)
            const recipe = (request.createRecipe ?? options.createRecipe)(track).map(
              ({ sourceTrackId, startMs, endMs }) => ({ sourceTrackId, startMs, endMs }),
            )
            const sameExport =
              previous?.creatorName === creatorName &&
              previous.file?.fileName === createAudioDownloadFileName(track.title, 'mp3') &&
              previous.recipe?.length === recipe.length &&
              recipe.every((segment, index) => {
                const earlier = previous.recipe?.[index]
                return (
                  earlier?.sourceTrackId === segment.sourceTrackId &&
                  earlier.startMs === segment.startMs &&
                  earlier.endMs === segment.endMs
                )
              })
            return {
              id: previous?.id ?? `download-item:${crypto.randomUUID()}`,
              track: cloneTrack(track),
              status: 'queued' as const,
              requestedAtMs: startedAtMs,
              maxRetryCount: MAX_DOWNLOAD_RETRY_COUNT,
              recipe,
              creatorName,
              file: sameExport ? previous.file : undefined,
              savedFile: sameExport ? previous.savedFile : undefined,
              attempts: previous?.attempts ?? [],
              progressMessage: '等待进入下载队列',
            }
          }),
        }
    const controller = new AbortController()
    const requestedItems = batch.items.filter(
      (item) => !request.resumeItemIds || request.resumeItemIds.has(item.id),
    )
    const taskControllers = new Map<string, AbortController>()
    let schedule: DownloadSchedule | undefined
    const jobs = new Map<string, Promise<void>>()
    const attemptsAtStart = new Map(batch.items.map((item) => [item.id, item.attempts.length]))
    activeController = controller
    activeTaskControllers = taskControllers
    batches.value = previousBatch
      ? batches.value.map((candidate) => (candidate.id === batchId ? batch : candidate))
      : deduplicateDownloadBatches([batch, ...batches.value])
    activeBatchId.value = batchId
    isCancelling.value = false
    statusMessage.value = `正在下载 0 / ${tracks.length} 首歌曲…`
    persistHistory()

    try {
      schedule = await (options.scheduler ?? browserDownloadScheduler).open(concurrency)
      // A batch ZIP can back multiple songs; hash it once per run, without retaining bytes.
      const verification = new Map<string, Promise<boolean>>()
      const taskOptions: RunConcurrentDownloadsOptions<DownloadHistoryItem, GeneratedDownloadFile> =
        {
          concurrency: 1,
          maxRetryCount: MAX_DOWNLOAD_RETRY_COUNT,
          isCancelled: () => controller.signal.aborted,
          isTaskCancelled: (item) => taskControllers.get(item.id)?.signal.aborted ?? false,
          onAttemptStart: ({ item, attemptNumber }) => {
            const now = Date.now()
            updateItem(batchId, item.id, (current) => ({
              ...current,
              status: 'downloading',
              startedAtMs: current.startedAtMs ?? now,
              error: undefined,
              progressMessage: `第 ${attemptNumber} 次尝试：正在准备媒体`,
              attempts: [
                ...current.attempts,
                {
                  attemptNumber: (attemptsAtStart.get(item.id) ?? 0) + attemptNumber,
                  startedAtMs: now,
                  status: 'running',
                },
              ],
            }))
            updateProgressMessage(batchId)
          },
          download: async (item) => {
            const taskController = taskControllers.get(item.id)
            if (!taskController) throw new Error('找不到歌曲下载控制器。')
            if (
              options.verifyDownload &&
              item.savedFile?.sha256 &&
              item.file &&
              (item.savedFile.extension === 'zip' ||
                item.savedFile.fileName === item.file.fileName) &&
              item.creatorName === toValue(options.creatorName)
            ) {
              updateItem(batchId, item.id, (current) => ({
                ...current,
                progressMessage: '正在校验保存目录中的文件名和完整内容…',
              }))
              const key = JSON.stringify(item.savedFile)
              let checked = verification.get(key)
              if (!checked) {
                checked = options.verifyDownload(item.savedFile, controller.signal)
                verification.set(key, checked)
              }
              const exists = await checked
              throwIfCancelled(taskController.signal)
              if (exists) {
                const now = Date.now()
                updateItem(batchId, item.id, (current) => ({
                  ...current,
                  status: 'succeeded',
                  savedAtMs: now,
                  completedAtMs: now,
                  attempts: completeAttempt(current.attempts, 'succeeded', now),
                  error: undefined,
                  progressMessage: '文件名和内容校验一致，已跳过重复下载',
                }))
                return { blob: new Blob(), summary: item.file, existing: true }
              }
            }
            const accountIds = new Set<string>()
            const unsubscribe = options.subscribeSourceInvalidation?.((event) => {
              if (event.accountId && accountIds.has(event.accountId)) taskController.abort()
            })
            let file: GeneratedDownloadFile
            try {
              file = await generateTrackFile(
                item.track,
                {
                  ...options,
                  creatorName: item.creatorName ?? options.creatorName,
                  createRecipe: item.recipe
                    ? () => item.recipe!
                    : (request.createRecipe ?? options.createRecipe),
                  resolveMedia: async (track, resolveOptions) => {
                    try {
                      const source = await options.resolveMedia(track, resolveOptions)
                      if (source.accountId) accountIds.add(source.accountId)
                      return source
                    } catch (cause) {
                      if (cause instanceof AppError && cause.code === 'operation-cancelled')
                        taskController.abort()
                      throw cause
                    }
                  },
                },
                taskController.signal,
                (message) => {
                  if (taskController.signal.aborted) return
                  updateItem(batchId, item.id, (current) => ({
                    ...current,
                    progressMessage: message,
                  }))
                },
              )
            } finally {
              unsubscribe?.()
            }
            throwIfCancelled(taskController.signal)
            const now = Date.now()
            updateItem(batchId, item.id, (current) => ({
              ...current,
              status: 'succeeded',
              completedAtMs: now,
              attempts: completeAttempt(current.attempts, 'succeeded', now),
              file: file.summary,
              error: undefined,
              progressMessage: '歌曲文件已生成，等待批次保存',
            }))
            updateProgressMessage(batchId)
            return file
          },
          onAttemptFailure: ({ item, error, willRetry, attemptNumber }) => {
            const now = Date.now()
            const appError = toAppErrorState(error, 'download-failed', '歌曲下载失败。')
            updateItem(batchId, item.id, (current) => ({
              ...current,
              status: willRetry ? 'queued' : 'failed',
              completedAtMs: willRetry ? undefined : now,
              attempts: completeAttempt(current.attempts, 'failed', now, appError),
              error: appError,
              progressMessage: willRetry
                ? `第 ${attemptNumber} 次失败，等待自动重试`
                : '已达到最大重试次数',
            }))
            updateProgressMessage(batchId)
          },
          onTaskCancelled: ({ item }) => {
            const now = Date.now()
            const appError = createAppErrorState('operation-cancelled', '用户中止了本次下载。')
            updateItem(batchId, item.id, (current) => ({
              ...current,
              status: pausedItemIds.has(item.id)
                ? current.status === 'queued'
                  ? 'queued'
                  : 'paused'
                : pendingResumes.has(item.id)
                  ? 'queued'
                  : 'cancelled',
              completedAtMs: now,
              attempts: completeAttempt(current.attempts, 'cancelled', now, appError),
              error:
                pausedItemIds.has(item.id) || pendingResumes.has(item.id) ? undefined : appError,
              progressMessage: pausedItemIds.has(item.id)
                ? current.status === 'queued'
                  ? '等待继续下载'
                  : '已暂停，继续时将重新解析媒体'
                : pendingResumes.has(item.id)
                  ? '等待重新下载'
                  : '已取消，可重新下载',
            }))
            updateProgressMessage(batchId)
          },
          waitBeforeRetry: ({ item, attemptNumber }) => {
            const taskSignal = taskControllers.get(item.id)?.signal
            return taskSignal ? waitForRetry(attemptNumber, taskSignal) : Promise.resolve()
          },
        }
      type Result = ConcurrentDownloadResult<DownloadHistoryItem, GeneratedDownloadFile>
      const resultById = new Map<string, Result>()
      const enqueue = (items: readonly DownloadHistoryItem[]) => {
        for (const item of items) {
          const previous = jobs.get(item.id)
          const run = async () => {
            attemptsAtStart.set(
              item.id,
              batches.value
                .find((candidate) => candidate.id === batchId)
                ?.items.find((candidate) => candidate.id === item.id)?.attempts.length ?? 0,
            )
            const taskController = new AbortController()
            pendingResumes.delete(item.id)
            taskControllers.set(item.id, taskController)
            const latest = batches.value
              .find((candidate) => candidate.id === batchId)
              ?.items.find((candidate) => candidate.id === item.id)
            if (
              controller.signal.aborted ||
              latest?.status === 'paused' ||
              latest?.status === 'cancelled'
            )
              taskController.abort()
            else pausedItemIds.delete(item.id)
            let release: (() => void | Promise<void>) | undefined
            try {
              release = await schedule!.acquire(item.id, taskController.signal)
              const [result] = await runConcurrentDownloads([item], taskOptions)
              if (result) resultById.set(item.id, result)
            } catch (error) {
              if (!taskController.signal.aborted && !controller.signal.aborted) throw error
              taskOptions.onTaskCancelled?.({ item, itemIndex: 0, attemptCount: 0 })
              resultById.set(item.id, { status: 'cancelled', item, itemIndex: 0, attemptCount: 0 })
            } finally {
              await release?.()
              if (taskControllers.get(item.id) === taskController) taskControllers.delete(item.id)
            }
          }
          const job = (previous ? previous.then(run) : run()).finally(() => {
            if (jobs.get(item.id) === job) jobs.delete(item.id)
          })
          jobs.set(item.id, job)
        }
      }
      enqueueActiveItems = enqueue
      enqueue(requestedItems)
      // Resuming a paused item joins this same admission pool, including while other songs run.
      while (jobs.size) {
        // Resumed jobs may join during this wait, so drain a fresh generation afterwards.
        // eslint-disable-next-line no-await-in-loop
        await Promise.all(jobs.values())
      }
      enqueueActiveItems = undefined
      const results = batch.items.flatMap((item) => resultById.get(item.id) ?? [])

      if (controller.signal.aborted || results.every((result) => result.status === 'cancelled')) {
        const completedAtMs = Date.now()
        updateBatch(batchId, (current) => ({
          ...current,
          status: 'cancelled',
          completedAtMs,
        }))
        statusMessage.value = pausedItemIds.size
          ? '下载已暂停，可选择歌曲继续下载。'
          : '下载批次已中止；已生成但尚未保存的临时文件已丢弃。'
        return batchId
      }

      const generatedFiles = results.flatMap((result) =>
        result.status === 'succeeded' && !result.value.existing ? [result.value] : [],
      )
      let archive: DownloadedFileSummary | undefined
      let savedFile: DownloadedFileSummary | undefined
      let archiveError: AppErrorState | undefined
      try {
        const output = await saveBatchOutput(
          batchId,
          Math.max(tracks.length, results.length),
          generatedFiles,
          controller.signal,
        )
        archive = output.archive
        savedFile = output.savedFile
      } catch (error) {
        archiveError = toAppErrorState(error, 'archive-failed', '批次文件保存失败。')
      }

      if (controller.signal.aborted) {
        const completedAtMs = Date.now()
        updateBatch(batchId, (current) => ({
          ...current,
          status: 'cancelled',
          completedAtMs,
        }))
        statusMessage.value = '下载批次已中止；未触发浏览器保存。'
        return batchId
      }

      const completedAtMs = Date.now()
      const savedIds = new Set(
        results.filter((result) => result.status === 'succeeded').map((result) => result.item.id),
      )
      const existingIds = new Set(
        results
          .filter((result) => result.status === 'succeeded' && result.value.existing)
          .map((result) => result.item.id),
      )
      updateBatch(batchId, (current) => ({
        ...current,
        status: 'completed',
        completedAtMs,
        archive,
        archiveError,
        items: current.items.map((item) =>
          !archiveError && savedIds.has(item.id) && !existingIds.has(item.id)
            ? { ...item, savedAtMs: completedAtMs, savedFile, progressMessage: '已下载' }
            : item,
        ),
      }))
      updateProgressMessage(batchId)
      if (existingIds.size)
        statusMessage.value += ` 已校验并跳过 ${existingIds.size} 首歌曲的重复下载。`
      return batchId
    } catch (error) {
      // 调度器之外的异常也必须收口到历史，避免界面看似结束但批次永久停在“运行中”。
      controller.abort()
      for (const taskController of taskControllers.values()) taskController.abort()
      await Promise.allSettled(jobs.values())
      const completedAtMs = Date.now()
      const appError = toAppErrorState(error, 'download-failed', '批量下载异常终止。')
      updateBatch(batchId, (current) => ({
        ...current,
        status: 'completed',
        completedAtMs,
        archiveError: appError,
        items: current.items.map((item) =>
          item.status === 'queued' || item.status === 'downloading'
            ? {
                ...item,
                status: 'failed',
                completedAtMs,
                attempts: completeAttempt(item.attempts, 'failed', completedAtMs, appError),
                error: appError,
                progressMessage: '批次异常终止',
              }
            : item,
        ),
      }))
      statusMessage.value = `批量下载异常终止：${formatAppErrorMessage(appError)}`
      return batchId
    } finally {
      enqueueActiveItems = undefined
      try {
        await schedule?.close()
      } catch (error) {
        persistenceErrorState.value = toAppErrorState(
          error,
          'download-failed',
          '原生下载队列清理失败。',
        )
      }
      if (activeController === controller) activeController = undefined
      if (activeTaskControllers === taskControllers) activeTaskControllers = new Map()
      if (activeBatchId.value === batchId) activeBatchId.value = undefined
      isCancelling.value = false
      for (const item of batch.items) pausedItemIds.delete(item.id)
      if (restartQueue.size && !disposed) {
        const nextIds = [...restartQueue]
        restartQueue.clear()
        void resumeDownloadItems(nextIds)
      }
    }
  }

  function cancelActiveBatch(): void {
    if (!activeController || !activeBatchId.value || activeController.signal.aborted) return
    isCancelling.value = true
    restartQueue.clear()
    pendingResumes.clear()
    statusMessage.value = '正在中止下载并释放网络与编码资源…'
    activeController.abort()
    for (const controller of activeTaskControllers.values()) controller.abort()
  }

  function cancelDownloadItem(itemId: string): void {
    cancelDownloadItems([itemId])
  }

  function cancelDownloadItems(itemIds: readonly string[]): void {
    const ids = new Set(itemIds)
    const now = Date.now()
    let changed = false
    batches.value = batches.value.map((batch) => ({
      ...batch,
      items: batch.items.map((item) => {
        if (
          !ids.has(item.id) ||
          (!['queued', 'downloading', 'paused'].includes(item.status) && !restartQueue.has(item.id))
        )
          return item
        changed = true
        restartQueue.delete(item.id)
        pendingResumes.delete(item.id)
        pausedItemIds.delete(item.id)
        activeTaskControllers.get(item.id)?.abort()
        const error = createAppErrorState('operation-cancelled', '用户取消了本次下载。')
        return {
          ...item,
          status: 'cancelled' as const,
          completedAtMs: now,
          attempts: completeAttempt(item.attempts, 'cancelled', now, error),
          error,
          progressMessage: '已取消，可重新下载',
        }
      }),
    }))
    if (changed) persistHistory()
  }

  function pauseDownloadItems(itemIds: readonly string[]): void {
    const ids = new Set(itemIds)
    let changed = false
    batches.value = batches.value.map((batch) => {
      let batchChanged = false
      const items = batch.items.map((item) => {
        if (
          !ids.has(item.id) ||
          (item.status !== 'queued' && item.status !== 'downloading' && !restartQueue.has(item.id))
        )
          return item
        changed = batchChanged = true
        pausedItemIds.add(item.id)
        pendingResumes.delete(item.id)
        restartQueue.delete(item.id)
        activeTaskControllers.get(item.id)?.abort()
        return {
          ...item,
          status: 'paused' as const,
          error: undefined,
          progressMessage: '已暂停，继续时将重新解析媒体',
        }
      })
      return batchChanged ? { ...batch, items } : batch
    })
    if (changed) persistHistory()
  }

  async function resumeDownloadItems(itemIds: readonly string[]): Promise<void> {
    if (disposed) return
    const ids = new Set(itemIds)
    for (const batchId of batches.value.map((batch) => batch.id)) {
      const batch = batches.value.find((candidate) => candidate.id === batchId)
      if (!batch) continue
      const items = batch.items.filter(
        (item) =>
          ids.has(item.id) &&
          (item.status === 'paused' ||
            item.status === 'failed' ||
            item.status === 'cancelled' ||
            item.status === 'interrupted' ||
            (item.status === 'succeeded' &&
              (item.savedAtMs !== undefined || batch.status !== 'running'))),
      )
      if (!items.length) continue
      if (batch.id === activeBatchId.value && enqueueActiveItems && !isCancelling.value) {
        const resumeIds = new Set(items.map((item) => item.id))
        for (const id of resumeIds) pendingResumes.add(id)
        updateBatch(batch.id, (current) => ({
          ...current,
          items: current.items.map((item) =>
            resumeIds.has(item.id)
              ? {
                  ...item,
                  status: 'queued',
                  completedAtMs: undefined,
                  savedAtMs: undefined,
                  error: undefined,
                  progressMessage: '等待继续下载',
                }
              : item,
          ),
        }))
        enqueueActiveItems(items)
      } else if (isBusy.value) {
        for (const item of items) restartQueue.add(item.id)
        statusMessage.value = '已加入继续下载队列，当前批次保存后开始处理。'
      } else {
        // Batches share one runtime pool and one save transaction at a time.
        // eslint-disable-next-line no-await-in-loop
        await startDownloadBatch({
          tracks: items.map((item) => item.track),
          origin: batch.origin,
          resumeBatchId: batch.id,
          resumeItemIds: new Set(items.map((item) => item.id)),
        })
      }
    }
  }

  function removeDownloadItems(itemIds: readonly string[]): void {
    const ids = new Set(itemIds)
    batches.value = batches.value.flatMap((batch) => {
      const items = batch.items.filter(
        (item) =>
          !ids.has(item.id) ||
          item.status === 'queued' ||
          item.status === 'downloading' ||
          (batch.status === 'running' &&
            item.status === 'succeeded' &&
            item.savedAtMs === undefined) ||
          activeTaskControllers.has(item.id),
      )
      return items.length ? [{ ...batch, items }] : []
    })
    const retainedIds = new Set(
      batches.value.flatMap((batch) => batch.items.map((item) => item.id)),
    )
    for (const id of ids)
      if (!retainedIds.has(id)) {
        restartQueue.delete(id)
        pausedItemIds.delete(id)
      }
    if (!batches.value.length) statusMessage.value = ''
    persistHistory()
  }

  async function saveBatchOutput(
    batchId: string,
    selectedTrackCount: number,
    files: readonly GeneratedDownloadFile[],
    signal: AbortSignal,
  ): Promise<{ archive?: DownloadedFileSummary; savedFile?: DownloadedFileSummary }> {
    throwIfCancelled(signal)
    if (!files.length) return {}
    if (selectedTrackCount === 1) {
      const file = files[0]
      if (!file) return {}
      const receipt = await downloadBlob(file.blob, file.summary.fileName)
      return { savedFile: { ...file.summary, ...receipt } }
    }

    const batch = batches.value.find((candidate) => candidate.id === batchId)
    if (!batch) throw new Error('找不到正在打包的下载批次。')
    statusMessage.value = `歌曲处理完成，正在把 ${files.length} 个成功文件打包为 ZIP…`
    // ZIP 仅属于多曲批次；单曲下载和不含下载页的未来移动入口不应静态引入归档器。
    const { createDownloadArchive } = await import('./download-archive')
    const archive = await createDownloadArchive(batch, files, signal)
    throwIfCancelled(signal)
    const receipt = await downloadBlob(archive.blob, archive.fileName)
    const summary = {
      fileName: archive.fileName,
      extension: 'zip',
      mimeType: archive.blob.type || 'application/zip',
      sizeBytes: archive.blob.size,
      ...receipt,
    }
    return { archive: summary, savedFile: summary }
  }

  function updateProgressMessage(batchId: string): void {
    const batch = batches.value.find((candidate) => candidate.id === batchId)
    if (!batch) return
    const succeededCount = batch.items.filter((item) => item.status === 'succeeded').length
    const failedCount = batch.items.filter((item) => item.status === 'failed').length
    const cancelledCount = batch.items.filter((item) => item.status === 'cancelled').length
    const completedCount = succeededCount + failedCount + cancelledCount
    if (batch.status === 'cancelled') {
      statusMessage.value = `下载已中止：成功生成 ${succeededCount} 首，取消 ${cancelledCount} 首。`
    } else if (batch.status === 'completed') {
      statusMessage.value = batch.archiveError
        ? `歌曲处理完成，但批次保存失败：${formatAppErrorMessage(batch.archiveError)}`
        : `下载完成：成功 ${succeededCount} 首，失败 ${failedCount} 首，取消 ${cancelledCount} 首。`
    } else if (!isCancelling.value) {
      statusMessage.value = `正在下载 ${completedCount} / ${batch.items.length} 首歌曲…`
    }
  }

  function updateItem(
    batchId: string,
    itemId: string,
    updater: (item: DownloadHistoryItem) => DownloadHistoryItem,
  ): void {
    updateBatch(batchId, (batch) => ({
      ...batch,
      items: batch.items.map((item) => (item.id === itemId ? updater(item) : item)),
    }))
  }

  function updateBatch(
    batchId: string,
    updater: (batch: DownloadHistoryBatch) => DownloadHistoryBatch,
  ): void {
    batches.value = batches.value.map((batch) => (batch.id === batchId ? updater(batch) : batch))
    persistHistory()
  }

  function persistHistory(): void {
    try {
      downloadHistoryRepository.save({
        schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
        batches: batches.value,
      })
      persistenceErrorState.value = undefined
    } catch (error) {
      persistenceErrorState.value = toAppErrorState(
        error,
        'storage-write-failed',
        '下载历史保存失败。',
      )
    }
  }

  return {
    batches: readonly(batches),
    activeBatch,
    activeItemCount,
    isBusy,
    isCancelling: readonly(isCancelling),
    itemCount,
    statusMessage: readonly(statusMessage),
    persistenceError: readonly(persistenceError),
    persistenceErrorState: readonly(persistenceErrorState),
    startDownloadBatch,
    cancelActiveBatch,
    cancelDownloadItem,
    cancelDownloadItems,
    pauseDownloadItems,
    resumeDownloadItems,
    removeDownloadItems,
  }
}

async function generateTrackFile(
  track: Track,
  options: UseDownloadManagerOptions,
  signal: AbortSignal,
  onProgress: (message: string) => void,
): Promise<GeneratedDownloadFile> {
  // 大型编码栈保持按需加载；并发任务共享浏览器模块缓存和 MP3 注册 Promise。
  const [{ exportAudioSegments }, { loadResolvedMediaFile }] = await Promise.all([
    import('../audio-export/audio-exporter'),
    import('../../media/resolved-media-loader'),
  ])
  const file = await exportAudioSegments({
    title: track.title,
    creatorName: toValue(options.creatorName),
    segments: options.createRecipe(track),
    format: 'mp3',
    resolveTrack: options.resolveTrack,
    resolveMedia: options.resolveMedia,
    loadMediaFile: loadResolvedMediaFile,
    signal,
    onProgress: (progress) => onProgress(progress.message),
  })
  const fileName = createAudioDownloadFileName(track.title, file.extension)
  return {
    blob: file.blob,
    summary: {
      fileName,
      extension: file.extension,
      mimeType: file.blob.type || 'audio/mpeg',
      sizeBytes: file.blob.size,
    },
  }
}

function completeAttempt(
  attempts: readonly DownloadHistoryItem['attempts'][number][],
  status: 'succeeded' | 'failed' | 'cancelled',
  completedAtMs: number,
  error?: AppErrorState,
): DownloadHistoryItem['attempts'] {
  return attempts.map((attempt, index) =>
    index === attempts.length - 1 && attempt.status === 'running'
      ? { ...attempt, status, completedAtMs, error }
      : attempt,
  )
}

function waitForRetry(attemptNumber: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  const delayMs = Math.min(3_000, 750 * 2 ** (attemptNumber - 1))
  return new Promise((resolve) => {
    let timeoutId = 0
    const finish = () => {
      window.clearTimeout(timeoutId)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    timeoutId = window.setTimeout(finish, delayMs)
    signal.addEventListener('abort', finish, { once: true })
  })
}

function deduplicateTracks(tracks: readonly Track[]): Track[] {
  return [...new Map(tracks.map((track) => [track.id, track])).values()]
}

function cloneTrack(track: Track): Track {
  return {
    ...track,
    artists: track.artists.map((artist) => ({ ...artist })),
    sourceTags: track.sourceTags ? [...track.sourceTags] : undefined,
    statistics: track.statistics ? { ...track.statistics } : undefined,
    source: { ...track.source },
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('下载已由用户中止。')
  error.name = 'AbortError'
  throw error
}

function loadHistory(): { snapshot: DownloadHistorySnapshot; error?: AppErrorState } {
  try {
    return { snapshot: downloadHistoryRepository.load() }
  } catch (error) {
    return {
      snapshot: { schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION, batches: [] },
      error: toAppErrorState(error, 'storage-read-failed', '下载历史读取失败。'),
    }
  }
}
