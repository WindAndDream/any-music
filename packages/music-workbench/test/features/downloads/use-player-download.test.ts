import { createAppErrorState } from '@any-music/core'
import type { DownloadHistoryBatch, DownloadItemStatus, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import {
  formatPlayerDownloadNotice,
  getDownloadedTrackIds,
  getPlayerDownloadStatusLabel,
  usePlayerDownload,
} from '#workbench/features/downloads/use-player-download'

const track: Track = {
  id: 'song:1',
  title: '第一首歌',
  artists: [{ name: '歌手' }],
  source: { pluginId: 'test', mediaKind: 'audio', resourceId: '1' },
}

function batch(
  status: DownloadItemStatus,
  overrides: Partial<DownloadHistoryBatch> = {},
): DownloadHistoryBatch {
  return {
    id: 'batch:1',
    origin: { kind: 'player', label: '播放器' },
    status: 'running',
    startedAtMs: 1,
    concurrency: 1,
    items: [{ id: 'item:1', track, status, requestedAtMs: 1, maxRetryCount: 3, attempts: [] }],
    ...overrides,
  }
}

function setup(initial: DownloadHistoryBatch[] = []) {
  const batches = shallowRef<readonly DownloadHistoryBatch[]>(initial)
  const isBusy = shallowRef(false)
  const startDownload = vi.fn<(value: Track) => Promise<string | undefined>>()
  const onNotice = vi.fn()
  const player = usePlayerDownload({ batches, isBusy, startDownload, onNotice })
  return { batches, isBusy, startDownload, onNotice, player }
}

describe('player download notices', () => {
  it('shares actual saved history with bulk actions and allows failed or cancelled saves to retry', () => {
    expect(getDownloadedTrackIds([batch('succeeded', { status: 'completed' })])).toEqual(
      new Set([track.id]),
    )
    for (const entry of [
      batch('succeeded'),
      batch('succeeded', { status: 'cancelled' }),
      batch('succeeded', { status: 'interrupted' }),
      batch('succeeded', {
        status: 'completed',
        archiveError: createAppErrorState('archive-failed', '保存失败'),
      }),
      batch('failed', { status: 'completed' }),
      batch('cancelled', { status: 'completed' }),
      batch('interrupted', { status: 'completed' }),
    ])
      expect(getDownloadedTrackIds([entry])).toEqual(new Set())
    expect(
      getDownloadedTrackIds([
        batch('failed', { status: 'completed' }),
        batch('succeeded', { status: 'completed' }),
      ]),
    ).toEqual(new Set())
  })
  it('starts only once on rapid clicks and tracks queue, generation and actual saving', async () => {
    const view = setup()
    let complete!: (id: string) => void
    view.startDownload.mockImplementation(() => {
      view.batches.value = [batch('queued')]
      return new Promise((resolve) => {
        complete = resolve
      })
    })
    view.player.requestDownload(track)
    view.player.requestDownload(track)
    expect(view.startDownload).toHaveBeenCalledExactlyOnceWith(track)
    expect(view.player.notice.value).toMatchObject({ trackTitle: track.title, status: 'queued' })
    expect(view.onNotice).toHaveBeenCalledTimes(2)
    view.batches.value = [batch('downloading')]
    expect(view.player.notice.value?.status).toBe('downloading')
    view.batches.value = [batch('succeeded')]
    expect(view.player.notice.value?.status).toBe('downloading')
    view.batches.value = [batch('succeeded', { status: 'completed' })]
    complete('batch:1')
    await Promise.resolve()
    expect(view.player.notice.value?.status).toBe('succeeded')
    expect(view.onNotice).toHaveBeenCalledTimes(2)
    view.player.requestDownload(track)
    expect(view.startDownload).toHaveBeenCalledTimes(2)
    expect(view.onNotice).toHaveBeenCalledTimes(3)
    expect(view.onNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({ trackTitle: track.title, status: 'queued' }),
    )
  })

  it('submits saved history again so the runtime can verify the actual file', () => {
    const view = setup([batch('succeeded', { status: 'completed' })])
    view.startDownload.mockImplementation(async () => {
      view.batches.value = [batch('queued')]
      return 'batch:2'
    })
    view.player.requestDownload(track)
    expect(view.player.notice.value).toMatchObject({ trackId: track.id, status: 'queued' })
    expect(view.startDownload).toHaveBeenCalledOnce()
    expect(view.onNotice).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ trackTitle: track.title, status: 'queued' }),
    )
  })

  it('restarts a failed save on the next download click', () => {
    const view = setup([
      batch('succeeded', {
        status: 'completed',
        archiveError: createAppErrorState('archive-failed', '磁盘保存失败'),
      }),
    ])
    view.startDownload.mockImplementation(async () => {
      view.batches.value = [batch('queued')]
      return 'batch:2'
    })
    view.player.requestDownload(track)
    expect(view.startDownload).toHaveBeenCalledOnce()
    expect(view.player.notice.value?.status).toBe('queued')
    expect(view.onNotice).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'queued' }),
    )
  })

  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'restarts a previous %s task on the next download click',
    (status) => {
      const view = setup([batch(status, { status: 'completed' })])
      view.startDownload.mockImplementation(async () => {
        view.batches.value = [batch('downloading', { id: 'batch:2' }), ...view.batches.value]
        return 'batch:2'
      })
      view.player.requestDownload(track)
      expect(view.player.notice.value?.status).toBe('downloading')
      expect(view.startDownload).toHaveBeenCalledExactlyOnceWith(track)
      expect(view.onNotice).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ status: 'downloading' }),
      )
    },
  )

  it.each(['cancelled', 'interrupted'] as const)(
    'does not treat generated output in a %s batch as downloaded',
    (status) => {
      const view = setup()
      view.startDownload.mockImplementation(() => {
        view.batches.value = [batch('downloading')]
        return new Promise(() => {})
      })
      view.player.requestDownload(track)
      view.batches.value = [batch('succeeded', { status })]
      expect(view.player.notice.value?.status).toBe(status)
    },
  )

  it('recognizes AM-1005 and prevents an old completion from clearing a pending retry', async () => {
    const view = setup()
    let finishOld!: (id: string) => void
    let failRetry!: (error: Error) => void
    view.startDownload
      .mockImplementationOnce(() => {
        view.batches.value = [batch('downloading')]
        return new Promise((resolve) => {
          finishOld = resolve
        })
      })
      .mockImplementationOnce(() => {
        // 启动尚未写入新历史时，仍需保持这次重试的防重复标记。
        view.batches.value = []
        return new Promise((_resolve, reject) => {
          failRetry = reject
        })
      })
    view.player.requestDownload(track)
    view.batches.value = [
      batch('succeeded', {
        status: 'completed',
        archiveError: createAppErrorState('operation-cancelled', '已取消保存文件。'),
      }),
    ]
    expect(view.player.notice.value?.status).toBe('cancelled')
    expect(formatPlayerDownloadNotice(view.player.notice.value!)).toContain('AM-1005')
    expect(formatPlayerDownloadNotice(view.player.notice.value!)).toContain(track.title)
    expect(view.onNotice).toHaveBeenCalledOnce()
    view.player.requestDownload(track)
    expect(view.startDownload).toHaveBeenCalledTimes(2)
    finishOld('batch:1')
    await Promise.resolve()
    view.player.requestDownload(track)
    expect(view.startDownload).toHaveBeenCalledTimes(2)
    failRetry(new Error('重试启动失败'))
    await Promise.resolve()
    expect(view.player.notice.value?.detail).toContain('重试启动失败')
  })

  it('blocks a new song during other work and isolates late startup errors', async () => {
    const view = setup()
    let reject!: (error: Error) => void
    view.startDownload.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    view.player.requestDownload(track)
    const other = { ...track, id: 'song:2', title: '第二首歌' }
    view.player.requestDownload(other)
    expect(view.player.notice.value).toMatchObject({ trackTitle: other.title, status: 'busy' })
    reject(new Error('旧歌曲启动失败'))
    await Promise.resolve()
    await Promise.resolve()
    expect(view.player.notice.value?.trackId).toBe(other.id)
    expect(view.player.notice.value?.status).toBe('busy')
    expect(view.startDownload).toHaveBeenCalledOnce()
    expect(view.onNotice).toHaveBeenCalledTimes(2)
  })

  it('reports a startup error and reserves wording for a future paused task', async () => {
    const view = setup()
    view.startDownload.mockRejectedValue(new Error('来源暂不可用'))
    view.player.requestDownload(track)
    await vi.waitFor(() => expect(view.player.notice.value?.status).toBe('failed'))
    expect(view.player.notice.value?.detail).toContain('来源暂不可用')
    expect(view.onNotice).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        detail: expect.stringContaining('来源暂不可用'),
      }),
    )
    view.startDownload.mockImplementation(async () => {
      view.batches.value = [batch('downloading')]
      return 'batch:2'
    })
    view.player.requestDownload(track)
    expect(view.startDownload).toHaveBeenCalledTimes(2)
    expect(view.player.notice.value?.status).toBe('downloading')
    expect(getPlayerDownloadStatusLabel('paused')).toBe('下载暂停中')
  })
})
