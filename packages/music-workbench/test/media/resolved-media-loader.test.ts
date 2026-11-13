import type { RemoteResolvedMediaSource, ResolvedMediaSource, Track } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('#workbench/runtime/http', () => ({
  runtimeHttpClient: { request: requestMock },
}))

import { loadResolvedMediaFile } from '#workbench/media/resolved-media-loader'

const track: Track = {
  id: 'bilibili:video:BV-test',
  title: '测试视频',
  artists: [{ name: '测试 UP' }],
  source: { pluginId: 'bilibili', mediaKind: 'video', resourceId: 'BV-test' },
}
const remoteSource: RemoteResolvedMediaSource = {
  type: 'remote-url',
  url: 'https://media.example/primary.m4s',
  backupUrls: ['https://backup.example/audio.m4s'],
  quality: { id: 'audio', label: 'Audio', rank: 1 },
  availableQualities: [],
  loadingStrategy: 'range',
}

describe('loadResolvedMediaFile', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it('forwards ephemeral media headers to every GM binary download attempt', async () => {
    requestMock
      .mockResolvedValueOnce({ status: 403, statusText: 'Forbidden', headers: '', body: '' })
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: 'content-type: audio/mp4',
        body: new Uint8Array([1, 2, 3]),
      })
    const source: ResolvedMediaSource = {
      type: 'remote-url',
      url: 'https://media.example/primary.m4s',
      backupUrls: ['https://backup.example/audio.m4s'],
      quality: { id: 'dash:high', label: 'AAC · 128 kbps', rank: 128_000 },
      availableQualities: [{ id: 'dash:high', label: 'AAC · 128 kbps', rank: 128_000 }],
      requestHeaders: { Referer: 'https://www.bilibili.com/' },
      mimeType: 'audio/mp4',
      loadingStrategy: 'range',
    }

    await expect(loadResolvedMediaFile(track, source)).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/mp4',
    })
    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: source.url,
        headers: { Referer: 'https://www.bilibili.com/' },
        credentials: 'include',
        responseType: 'bytes',
      }),
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: source.backupUrls[0],
        headers: { Referer: 'https://www.bilibili.com/' },
      }),
    )
  })

  it('stops before trying backup media nodes after cancellation', async () => {
    const controller = new AbortController()
    requestMock.mockImplementationOnce((request: { cancellation?: { isCancelled(): boolean } }) => {
      expect(request.cancellation?.isCancelled()).toBe(false)
      controller.abort()
      return Promise.reject(new Error('request aborted'))
    })
    const source: ResolvedMediaSource = {
      type: 'remote-url',
      url: 'https://media.example/primary.m4s',
      backupUrls: ['https://backup.example/audio.m4s'],
      quality: { id: 'dash:high', label: 'AAC · 128 kbps', rank: 128_000 },
      availableQualities: [{ id: 'dash:high', label: 'AAC · 128 kbps', rank: 128_000 }],
      loadingStrategy: 'range',
    }

    await expect(
      loadResolvedMediaFile(track, source, { signal: controller.signal }),
    ).rejects.toThrow('下载已由用户中止')
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('rejects already settled media bytes if cancellation precedes the await continuation', async () => {
    const controller = new AbortController()
    requestMock.mockImplementationOnce(() => {
      const response = Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: '',
        body: new Uint8Array([1, 2, 3]),
      })
      queueMicrotask(() => controller.abort())
      return response
    })
    await expect(
      loadResolvedMediaFile(track, remoteSource, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('does not read a remote source or an existing binary after pre-cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const binarySource: ResolvedMediaSource = {
      ...remoteSource,
      type: 'complete-binary',
      bytes: new Uint8Array([1]),
      mimeType: 'audio/mp4',
      loadingStrategy: 'eager',
    }
    for (const source of [remoteSource, binarySource]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        loadResolvedMediaFile(track, source, { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'operation-cancelled' })
    }
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('keeps custom reads anonymous with the existing complete-file byte and timeout budgets', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: '',
      body: new Uint8Array([1]),
    })
    const customTrack = { ...track, source: { ...track.source, pluginId: 'custom-audit' } }
    await expect(loadResolvedMediaFile(customTrack, remoteSource)).resolves.toEqual({
      bytes: new Uint8Array([1]),
    })
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: 'omit',
        maxResponseBytes: 512 * 1024 * 1024,
        timeoutMs: 120_000,
        responseType: 'bytes',
      }),
    )
  })

  it('permits an explicit new attempt after all nodes failed', async () => {
    requestMock
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockRejectedValueOnce(new Error('backup failed'))
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: '',
        body: new Uint8Array([9]),
      })
    await expect(loadResolvedMediaFile(track, remoteSource)).rejects.toMatchObject({
      code: 'media-unavailable',
    })
    await expect(loadResolvedMediaFile(track, remoteSource)).resolves.toEqual({
      bytes: new Uint8Array([9]),
    })
    expect(requestMock.mock.calls.map(([request]) => request.url)).toEqual([
      remoteSource.url,
      remoteSource.backupUrls[0],
      remoteSource.url,
    ])
  })
})
