import type { ResolvedMediaSource, Track } from '@any-music/core'
import { AppError, DOWNLOAD_HISTORY_SCHEMA_VERSION } from '@any-music/core'
import { createAppErrorState } from '@any-music/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useDownloadManager } from '#workbench/features/downloads/use-download-manager'
import { usePlayerDownload } from '#workbench/features/downloads/use-player-download'
import type { SourceInvalidation } from '#workbench/runtime/workbench-runtime'

const repositoryMock = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}))
const exportAudioSegmentsMock = vi.hoisted(() => vi.fn())
const downloadBlobMock = vi.hoisted(() => vi.fn())
const createDownloadArchiveMock = vi.hoisted(() => vi.fn())

vi.mock('#workbench/storage/download-history-repository', () => ({
  downloadHistoryRepository: repositoryMock,
}))
vi.mock('#workbench/features/audio-export/audio-exporter', () => ({
  exportAudioSegments: exportAudioSegmentsMock,
}))
vi.mock('#workbench/media/resolved-media-loader', () => ({
  loadResolvedMediaFile: vi.fn(),
}))
vi.mock('#workbench/features/audio-export/download-audio', () => ({
  createAudioDownloadFileName: (title: string, extension: string) => `${title}.${extension}`,
  downloadBlob: downloadBlobMock,
}))
vi.mock('#workbench/features/downloads/download-archive', () => ({
  createDownloadArchive: createDownloadArchiveMock,
}))

const track: Track = {
  id: 'source:audio:1',
  title: '下载测试',
  artists: [{ name: '测试歌手' }],
  durationMs: 1_000,
  source: { pluginId: 'source', mediaKind: 'audio', resourceId: '1' },
}

describe('useDownloadManager', () => {
  function createManager(
    verifyDownload?: (
      file: import('@any-music/core').DownloadedFileSummary,
      signal: AbortSignal,
    ) => Promise<boolean>,
  ) {
    return useDownloadManager({
      concurrency: 2,
      creatorName: '用户',
      createRecipe: (candidate) => [{ sourceTrackId: candidate.id, startMs: 0, endMs: 1000 }],
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
      verifyDownload,
    })
  }

  it('keeps one stable song record and verifies the current folder before any repeated media work', async () => {
    exportAudioSegmentsMock.mockResolvedValue({ blob: new Blob(['mp3']), extension: 'mp3' })
    const receipt = { fileName: '下载测试.mp3', sizeBytes: 3, sha256: 'a'.repeat(64) }
    downloadBlobMock.mockResolvedValue(receipt)
    const verify = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false)
    const manager = createManager(verify)
    const request = { tracks: [track, track], origin: { kind: 'queue' as const, label: '待听' } }
    await manager.startDownloadBatch(request)
    const id = manager.batches.value[0]!.items[0]!.id
    await manager.startDownloadBatch(request)
    expect(manager.batches.value).toHaveLength(1)
    expect(manager.itemCount.value).toBe(1)
    expect(manager.batches.value[0]!.items[0]).toMatchObject({
      id,
      savedFile: receipt,
      status: 'succeeded',
    })
    expect(exportAudioSegmentsMock).toHaveBeenCalledOnce()
    expect(downloadBlobMock).toHaveBeenCalledOnce()
    expect(verify).toHaveBeenCalledWith(expect.objectContaining(receipt), expect.any(AbortSignal))
    await manager.resumeDownloadItems([id])
    expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(2)
    expect(downloadBlobMock).toHaveBeenCalledTimes(2)
    expect(manager.itemCount.value).toBe(1)
    expect(manager.batches.value[0]!.items[0]!.attempts).toHaveLength(3)
  })

  it('verifies a shared saved ZIP once and skips generating or saving all its songs', async () => {
    exportAudioSegmentsMock.mockResolvedValue({ blob: new Blob(['mp3']), extension: 'mp3' })
    downloadBlobMock.mockResolvedValue({
      fileName: 'batch.zip',
      sizeBytes: 3,
      sha256: 'b'.repeat(64),
    })
    const verify = vi.fn().mockResolvedValue(true)
    const manager = createManager(verify)
    const request = {
      tracks: [track, { ...track, id: 'second' }],
      origin: { kind: 'queue' as const, label: '待听' },
    }
    await manager.startDownloadBatch(request)
    await manager.startDownloadBatch(request)
    expect(verify).toHaveBeenCalledOnce()
    expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(2)
    expect(downloadBlobMock).toHaveBeenCalledOnce()
    expect(createDownloadArchiveMock).toHaveBeenCalledOnce()
    expect(manager.itemCount.value).toBe(2)
  })

  it('does not reuse identical content under another filename or after the export recipe changes', async () => {
    exportAudioSegmentsMock.mockResolvedValue({ blob: new Blob(['mp3']), extension: 'mp3' })
    downloadBlobMock.mockResolvedValue({
      fileName: 'other.mp3',
      sizeBytes: 3,
      sha256: 'c'.repeat(64),
    })
    const verify = vi.fn().mockResolvedValue(true)
    const manager = createManager(verify)
    const request = { tracks: [track], origin: { kind: 'queue' as const, label: '待听' } }
    await manager.startDownloadBatch(request)
    await manager.startDownloadBatch(request)
    await manager.startDownloadBatch({
      ...request,
      createRecipe: () => [{ sourceTrackId: track.id, startMs: 100, endMs: 500 }],
    })
    expect(verify).not.toHaveBeenCalled()
    expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(3)
    expect(manager.itemCount.value).toBe(1)
  })

  it('cancels active, queued and paused selections without retry or saving and permits another download', async () => {
    exportAudioSegmentsMock.mockImplementation(
      (options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          })
        }),
    )
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe: (candidate) => [{ sourceTrackId: candidate.id, startMs: 0, endMs: 1000 }],
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
    })
    const pending = manager.startDownloadBatch({
      tracks: [track, { ...track, id: 'two' }, { ...track, id: 'three' }],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(exportAudioSegmentsMock).toHaveBeenCalledOnce())
    const ids = manager.activeBatch.value!.items.map((item) => item.id)
    manager.pauseDownloadItems([ids[2]!])
    manager.cancelDownloadItems(ids)
    await pending
    expect(manager.batches.value[0]!.items.every((item) => item.status === 'cancelled')).toBe(true)
    expect(exportAudioSegmentsMock).toHaveBeenCalledOnce()
    expect(downloadBlobMock).not.toHaveBeenCalled()
    exportAudioSegmentsMock.mockResolvedValue({ blob: new Blob(['mp3']), extension: 'mp3' })
    await manager.resumeDownloadItems([ids[0]!])
    expect(manager.batches.value[0]!.items[0]!.savedAtMs).toBeDefined()
    expect(downloadBlobMock).toHaveBeenCalledOnce()
  })
  it('allows immediate retry during cancellation cleanup without reviving the cancelled generation', async () => {
    let finishCancellation!: () => void
    let finishOther!: (file: { blob: Blob; extension: string }) => void
    const file = { blob: new Blob(['mp3']), extension: 'mp3' }
    exportAudioSegmentsMock
      .mockImplementationOnce(
        (options: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => {
                finishCancellation = () => reject(new Error('cancelled'))
              },
              { once: true },
            )
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOther = resolve
          }),
      )
      .mockResolvedValue(file)
    const manager = createManager()
    const pending = manager.startDownloadBatch({
      tracks: [track, { ...track, id: 'other' }],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(2))
    const id = manager.activeBatch.value!.items[0]!.id
    manager.cancelDownloadItems([id])
    await manager.resumeDownloadItems([id])
    finishCancellation()
    await vi.waitFor(() => expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(3))
    finishOther(file)
    await pending
    expect(manager.itemCount.value).toBe(2)
    expect(manager.batches.value[0]!.items[0]).toMatchObject({ id, status: 'succeeded' })
    expect(manager.batches.value[0]!.items[0]!.attempts.map((attempt) => attempt.status)).toEqual([
      'cancelled',
      'succeeded',
    ])
  })

  it('does not mark other unsaved songs downloaded after retrying only one failed save', async () => {
    exportAudioSegmentsMock.mockResolvedValue({ blob: new Blob(['mp3']), extension: 'mp3' })
    downloadBlobMock.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const manager = createManager()
    await manager.startDownloadBatch({
      tracks: [track, { ...track, id: 'other' }],
      origin: { kind: 'queue', label: '待听' },
    })
    const id = manager.batches.value[0]!.items[0]!.id
    await manager.resumeDownloadItems([id])
    expect(manager.batches.value[0]!.items[0]!.savedAtMs).toBeDefined()
    expect(manager.batches.value[0]!.items[1]).toMatchObject({ status: 'failed' })
    expect(manager.batches.value[0]!.items[1]!.savedAtMs).toBeUndefined()
  })

  it('downloads again after cancelling file saving with AM-1005 and waits for saving before reporting success', async () => {
    exportAudioSegmentsMock.mockResolvedValue({
      blob: new Blob(['mp3'], { type: 'audio/mpeg' }),
      extension: 'mp3',
    })
    let finishSaving!: () => void
    downloadBlobMock
      .mockRejectedValueOnce(new AppError('operation-cancelled', '已取消保存文件。'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSaving = resolve
          }),
      )
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe: () => [{ sourceTrackId: track.id, startMs: 0, endMs: 1_000 }],
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
    })
    const onNotice = vi.fn()
    const player = usePlayerDownload({
      batches: manager.batches,
      isBusy: manager.isBusy,
      startDownload: (candidate) =>
        manager.startDownloadBatch({
          tracks: [candidate],
          origin: { kind: 'player', label: '播放器' },
        }),
      onNotice,
    })

    player.requestDownload(track)
    await vi.waitFor(() => expect(manager.isBusy.value).toBe(false))
    expect(manager.batches.value[0]?.archiveError?.statusCode).toBe('AM-1005')
    expect(player.notice.value).toMatchObject({ status: 'cancelled' })
    expect(onNotice).toHaveBeenCalledOnce()

    player.requestDownload(track)
    await vi.waitFor(() => expect(downloadBlobMock).toHaveBeenCalledTimes(2))
    expect(player.notice.value?.status).toBe('downloading')
    expect(manager.batches.value[0]?.items[0]?.status).toBe('succeeded')
    player.requestDownload(track)
    expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(2)
    expect(onNotice).toHaveBeenCalledTimes(3)

    finishSaving()
    await vi.waitFor(() => expect(manager.isBusy.value).toBe(false))
    expect(player.notice.value?.status).toBe('succeeded')
    expect(manager.batches.value[0]?.archiveError).toBeUndefined()
    expect(onNotice).toHaveBeenCalledTimes(3)
    player.requestDownload(track)
    expect(onNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ trackTitle: track.title, status: 'queued' }),
    )
    await vi.waitFor(() => expect(manager.isBusy.value).toBe(false))
    expect(downloadBlobMock).toHaveBeenCalledTimes(3)
  })

  it('exports the player preview recipe supplied at submission and saves one MP3', async () => {
    const createRecipe = vi.fn(() => {
      throw new Error('不能重新读取当前试听时间线')
    })
    const recipe = [{ sourceTrackId: track.id, startMs: 100, endMs: 500 }]
    const preview = {
      ...track,
      id: 'preview:1',
      source: { pluginId: 'local-preview', mediaKind: 'custom' as const, resourceId: '1' },
    }
    exportAudioSegmentsMock.mockResolvedValue({
      blob: new Blob(['mp3'], { type: 'audio/mpeg' }),
      extension: 'mp3',
    })
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe,
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
    })
    await manager.startDownloadBatch({
      tracks: [preview],
      origin: { kind: 'player', label: '播放器' },
      createRecipe: () => recipe,
    })
    expect(createRecipe).not.toHaveBeenCalled()
    expect(exportAudioSegmentsMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ segments: recipe }),
    )
    expect(downloadBlobMock).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), '下载测试.mp3')
    expect(manager.batches.value[0]).toMatchObject({
      status: 'completed',
      origin: { kind: 'player' },
    })
  })

  it('cancels only the actual download account and does not retry after removal', async () => {
    const listeners = new Set<(event: SourceInvalidation) => void>()
    const resolveMedia = vi.fn(async (): Promise<ResolvedMediaSource> => ({
      type: 'complete-binary',
      accountId: 'downloading',
      bytes: new Uint8Array(),
      mimeType: 'audio/mpeg',
      loadingStrategy: 'eager',
      quality: { id: 'default', label: '默认', rank: 1 },
      availableQualities: [],
    }))
    exportAudioSegmentsMock.mockImplementation(
      async (options: { resolveMedia: typeof resolveMedia; signal: AbortSignal }) => {
        await options.resolveMedia()
        return new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(new Error('账号已删除')), {
            once: true,
          }),
        )
      },
    )
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe: () => [{ sourceTrackId: track.id, startMs: 0, endMs: 1_000 }],
      resolveTrack: () => track,
      resolveMedia,
      subscribeSourceInvalidation: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    const pending = manager.startDownloadBatch({
      tracks: [track],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(resolveMedia).toHaveBeenCalledOnce())
    const event = {
      pluginId: 'source',
      accountId: 'playing',
      trackIds: [track.id],
      error: createAppErrorState('operation-cancelled'),
    }
    for (const listener of listeners) listener(event)
    expect(manager.activeBatch.value?.items[0]?.status).toBe('downloading')
    for (const listener of listeners) listener({ ...event, accountId: 'downloading' })
    await pending
    expect(manager.batches.value[0]?.items[0]?.status).toBe('cancelled')
    expect(exportAudioSegmentsMock).toHaveBeenCalledOnce()
    expect(downloadBlobMock).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
  beforeEach(() => {
    repositoryMock.load.mockReset().mockReturnValue({
      schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
      batches: [],
    })
    repositoryMock.save.mockReset()
    exportAudioSegmentsMock.mockReset()
    downloadBlobMock.mockReset()
    createDownloadArchiveMock.mockReset().mockResolvedValue({
      blob: new Blob(['zip'], { type: 'application/zip' }),
      fileName: 'batch.zip',
    })
    let nextId = 0
    vi.stubGlobal('crypto', { randomUUID: () => `uuid-${(nextId += 1)}` })
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void) => {
        callback()
        return 1
      },
      clearTimeout: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retains every failed attempt before a successful third retry', async () => {
    exportAudioSegmentsMock
      .mockRejectedValueOnce(new Error('第一次失败'))
      .mockRejectedValueOnce(new Error('第二次失败'))
      .mockRejectedValueOnce(new Error('第三次失败'))
      .mockResolvedValue({ blob: new Blob(['mp3'], { type: 'audio/mpeg' }), extension: 'mp3' })
    const manager = useDownloadManager({
      concurrency: 5,
      creatorName: '本地用户',
      createRecipe: () => [{ sourceTrackId: track.id, startMs: 0, endMs: 1_000 }],
      resolveTrack: () => track,
      resolveMedia: vi.fn<() => Promise<ResolvedMediaSource>>(),
    })

    await manager.startDownloadBatch({
      tracks: [track],
      origin: { kind: 'queue', label: '待听' },
    })

    expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(4)
    expect(downloadBlobMock).toHaveBeenCalledTimes(1)
    expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), '下载测试.mp3')
    expect(manager.batches.value[0]).toMatchObject({
      status: 'completed',
      concurrency: 5,
      origin: { kind: 'queue', label: '待听' },
      items: [
        {
          status: 'succeeded',
          file: {
            fileName: '下载测试.mp3',
            extension: 'mp3',
            mimeType: 'audio/mpeg',
            sizeBytes: 3,
          },
        },
      ],
    })
    expect(manager.batches.value[0]?.items[0]?.attempts).toMatchObject([
      {
        attemptNumber: 1,
        status: 'failed',
        error: { code: 'download-failed', statusCode: 'AM-7201', message: '第一次失败' },
      },
      {
        attemptNumber: 2,
        status: 'failed',
        error: { code: 'download-failed', statusCode: 'AM-7201', message: '第二次失败' },
      },
      {
        attemptNumber: 3,
        status: 'failed',
        error: { code: 'download-failed', statusCode: 'AM-7201', message: '第三次失败' },
      },
      { attemptNumber: 4, status: 'succeeded' },
    ])
    expect(repositoryMock.save).toHaveBeenLastCalledWith({
      schemaVersion: DOWNLOAD_HISTORY_SCHEMA_VERSION,
      batches: manager.batches.value,
    })
  })

  it('pauses and immediately resumes the same task without duplicating it or exceeding admission', async () => {
    const second = { ...track, id: 'second', title: '第二首' }
    let completeSecond!: () => void
    let running = 0
    let peak = 0
    let firstAttempts = 0
    exportAudioSegmentsMock.mockImplementation(
      async (request: { title: string; signal: AbortSignal }) => {
        running += 1
        peak = Math.max(peak, running)
        try {
          if (request.title === track.title && firstAttempts++ === 0) {
            await new Promise<void>((_resolve, reject) =>
              request.signal.addEventListener('abort', () => reject(new Error('paused')), {
                once: true,
              }),
            )
          } else if (request.title === second.title) {
            await new Promise<void>((resolve) => {
              completeSecond = resolve
            })
          }
          return { blob: new Blob(['mp3']), extension: 'mp3' }
        } finally {
          running -= 1
        }
      },
    )
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe: () => [],
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
    })
    const pending = manager.startDownloadBatch({
      tracks: [track, second],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(exportAudioSegmentsMock).toHaveBeenCalledOnce())
    const id = manager.activeBatch.value!.items[0]!.id
    manager.pauseDownloadItems([id])
    expect(manager.activeBatch.value!.items[0]!.status).toBe('paused')
    await manager.resumeDownloadItems([id])
    await vi.waitFor(() => expect(completeSecond).toBeTypeOf('function'))
    completeSecond()
    await pending
    expect(peak).toBe(1)
    expect(manager.batches.value).toHaveLength(1)
    expect(manager.batches.value[0]!.items.map((item) => item.status)).toEqual([
      'succeeded',
      'succeeded',
    ])
    expect(
      manager.batches.value[0]!.items[0]!.attempts.map((attempt) => attempt.attemptNumber),
    ).toEqual([1, 2])
    expect(manager.batches.value[0]!.items[0]!.savedAtMs).toBeTypeOf('number')
  })

  it('retries saving failures using the original task and preview recipe', async () => {
    exportAudioSegmentsMock.mockResolvedValue({ blob: new Blob(['mp3']), extension: 'mp3' })
    downloadBlobMock
      .mockRejectedValueOnce(new AppError('storage-write-failed', '保存失败'))
      .mockResolvedValue(undefined)
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe: () => {
        throw new Error('预览已关闭')
      },
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
    })
    const recipe = [{ sourceTrackId: track.id, startMs: 1, endMs: 500 }]
    await manager.startDownloadBatch({
      tracks: [track],
      origin: { kind: 'player', label: '播放器' },
      createRecipe: () => recipe,
    })
    const id = manager.batches.value[0]!.items[0]!.id
    expect(manager.batches.value[0]!.archiveError).toBeDefined()
    await manager.resumeDownloadItems([id])
    expect(manager.batches.value).toHaveLength(1)
    expect(manager.batches.value[0]!.items[0]).toMatchObject({ id, status: 'succeeded', recipe })
    expect(manager.batches.value[0]!.archiveError).toBeUndefined()
    expect(exportAudioSegmentsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ segments: recipe }),
    )
    expect(
      manager.batches.value[0]!.items[0]!.attempts.map((attempt) => attempt.attemptNumber),
    ).toEqual([1, 2])
  })

  it('pauses a queued task without starting it and resumes historical batches through the same pool', async () => {
    const second = { ...track, id: 'second', title: '第二首' }
    let finish!: () => void
    exportAudioSegmentsMock
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        return { blob: new Blob(['mp3']), extension: 'mp3' }
      })
      .mockResolvedValue({ blob: new Blob(['mp3']), extension: 'mp3' })
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe: () => [],
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
    })
    const pending = manager.startDownloadBatch({
      tracks: [track, second],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const pausedId = manager.activeBatch.value!.items[1]!.id
    manager.pauseDownloadItems([pausedId])
    finish()
    await pending
    expect(exportAudioSegmentsMock).toHaveBeenCalledOnce()
    expect(manager.batches.value[0]!.items[1]!.status).toBe('paused')
    const savedAt = manager.batches.value[0]!.items[0]!.savedAtMs
    await manager.resumeDownloadItems([pausedId])
    expect(manager.batches.value).toHaveLength(1)
    expect(manager.batches.value[0]!.items[0]!.savedAtMs).toBe(savedAt)
    expect(manager.batches.value[0]!.items[1]!.status).toBe('succeeded')
    expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(2)
  })

  it('does not mark late encoder success as downloaded after a pause', async () => {
    let finish!: () => void
    exportAudioSegmentsMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { blob: new Blob(['mp3']), extension: 'mp3' }
    })
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '用户',
      createRecipe: () => [],
      resolveTrack: () => track,
      resolveMedia: vi.fn(),
    })
    const pending = manager.startDownloadBatch({
      tracks: [track],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    manager.pauseDownloadItems([manager.activeBatch.value!.items[0]!.id])
    // Removing while the encoder is still unwinding must not turn the pause into cancellation.
    manager.removeDownloadItems([manager.activeBatch.value!.items[0]!.id])
    finish()
    await pending
    expect(manager.batches.value[0]!.items[0]!.status).toBe('paused')
    expect(downloadBlobMock).not.toHaveBeenCalled()
    expect(manager.isBusy.value).toBe(false)
    manager.removeDownloadItems([manager.batches.value[0]!.items[0]!.id])
    expect(manager.batches.value).toEqual([])
    expect(manager.statusMessage.value).toBe('')
  })

  it('saves a multi-song batch through one ZIP download instead of one popup per song', async () => {
    const secondTrack = {
      ...track,
      id: 'source:audio:2',
      title: '第二首',
      source: { ...track.source, resourceId: '2' },
    }
    exportAudioSegmentsMock.mockResolvedValue({
      blob: new Blob(['mp3'], { type: 'audio/mpeg' }),
      extension: 'mp3',
    })
    const manager = useDownloadManager({
      concurrency: 2,
      creatorName: '本地用户',
      createRecipe: (candidate) => [{ sourceTrackId: candidate.id, startMs: 0, endMs: 1_000 }],
      resolveTrack: (trackId) => (trackId === track.id ? track : secondTrack),
      resolveMedia: vi.fn<() => Promise<ResolvedMediaSource>>(),
    })

    await manager.startDownloadBatch({
      tracks: [track, secondTrack],
      origin: { kind: 'favorites', label: '我的喜欢' },
    })

    expect(createDownloadArchiveMock).toHaveBeenCalledTimes(1)
    expect(downloadBlobMock).toHaveBeenCalledTimes(1)
    expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), 'batch.zip')
    expect(manager.batches.value[0]).toMatchObject({
      status: 'completed',
      archive: {
        fileName: 'batch.zip',
        extension: 'zip',
        mimeType: 'application/zip',
        sizeBytes: 3,
      },
      items: [{ status: 'succeeded' }, { status: 'succeeded' }],
    })
  })

  it('cancels the active song and does not trigger a browser download', async () => {
    exportAudioSegmentsMock.mockImplementation(
      (options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('下载已由用户中止。'), { name: 'AbortError' })),
            { once: true },
          )
        }),
    )
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '本地用户',
      createRecipe: () => [{ sourceTrackId: track.id, startMs: 0, endMs: 1_000 }],
      resolveTrack: () => track,
      resolveMedia: vi.fn<() => Promise<ResolvedMediaSource>>(),
    })

    const pending = manager.startDownloadBatch({
      tracks: [track],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(1))
    manager.cancelActiveBatch()
    await pending

    expect(downloadBlobMock).not.toHaveBeenCalled()
    expect(manager.isBusy.value).toBe(false)
    expect(manager.batches.value[0]).toMatchObject({
      status: 'cancelled',
      items: [{ status: 'cancelled', progressMessage: '已取消，可重新下载' }],
    })
  })

  it('aborts active work when the owning feature scope is disposed', async () => {
    exportAudioSegmentsMock.mockImplementation(
      (options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('功能已卸载。'), { name: 'AbortError' })),
            { once: true },
          )
        }),
    )
    const scope = effectScope()
    const manager = scope.run(() =>
      useDownloadManager({
        concurrency: 1,
        creatorName: '本地用户',
        createRecipe: () => [{ sourceTrackId: track.id, startMs: 0, endMs: 1_000 }],
        resolveTrack: () => track,
        resolveMedia: vi.fn<() => Promise<ResolvedMediaSource>>(),
      }),
    )!

    const pending = manager.startDownloadBatch({
      tracks: [track],
      origin: { kind: 'queue', label: '待听' },
    })
    await vi.waitFor(() => expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(1))
    scope.stop()
    await pending

    expect(downloadBlobMock).not.toHaveBeenCalled()
    expect(manager.isBusy.value).toBe(false)
    expect(manager.batches.value[0]?.status).toBe('cancelled')
  })

  it('cancels one song while continuing the remaining ZIP batch', async () => {
    const secondTrack = {
      ...track,
      id: 'source:audio:2',
      title: '继续下载',
      source: { ...track.source, resourceId: '2' },
    }
    exportAudioSegmentsMock.mockImplementation(
      (options: { title: string; signal: AbortSignal }) => {
        if (options.title === secondTrack.title) {
          return Promise.resolve({
            blob: new Blob(['mp3'], { type: 'audio/mpeg' }),
            extension: 'mp3',
          })
        }
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('first cancelled')), {
            once: true,
          })
        })
      },
    )
    const manager = useDownloadManager({
      concurrency: 1,
      creatorName: '本地用户',
      createRecipe: (candidate) => [{ sourceTrackId: candidate.id, startMs: 0, endMs: 1_000 }],
      resolveTrack: (trackId) => (trackId === track.id ? track : secondTrack),
      resolveMedia: vi.fn<() => Promise<ResolvedMediaSource>>(),
    })

    const pending = manager.startDownloadBatch({
      tracks: [track, secondTrack],
      origin: { kind: 'favorites', label: '我的喜欢' },
    })
    await vi.waitFor(() => expect(exportAudioSegmentsMock).toHaveBeenCalledTimes(1))
    const firstItemId = manager.activeBatch.value?.items[0]?.id
    expect(firstItemId).toBeTruthy()
    manager.cancelDownloadItem(firstItemId as string)
    await pending

    expect(createDownloadArchiveMock).toHaveBeenCalledTimes(1)
    expect(downloadBlobMock).toHaveBeenCalledTimes(1)
    expect(manager.batches.value[0]).toMatchObject({
      status: 'completed',
      items: [{ status: 'cancelled' }, { status: 'succeeded' }],
    })
  })
})
