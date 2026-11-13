import type { HttpRequest, HttpResponse, RemoteResolvedMediaSource, Track } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResponseTooLargeError } from '#workbench/media/response-too-large-error'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('#workbench/runtime/http', () => ({
  runtimeHttpClient: { request: requestMock },
}))

import { RangeMediaReader } from '#workbench/media/range-media-source'

const track: Track = {
  id: 'bilibili:video:test',
  title: '测试音频',
  artists: [{ name: '测试' }],
  source: { pluginId: 'bilibili', mediaKind: 'video', resourceId: 'test' },
}
const source: RemoteResolvedMediaSource = {
  type: 'remote-url',
  url: 'https://media.example/audio.m4s',
  backupUrls: [],
  quality: { id: 'dash:high', label: 'AAC · 128 kbps', rank: 128_000 },
  availableQualities: [{ id: 'dash:high', label: 'AAC · 128 kbps', rank: 128_000 }],
  requestHeaders: { Referer: 'https://www.bilibili.com/' },
  loadingStrategy: 'range',
}

describe('RangeMediaReader', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it('probes the size and reads only the byte range requested by the decoder', async () => {
    requestMock
      .mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: 'Content-Range: bytes 0-0/100\r\n',
        body: new Uint8Array([0]),
      })
      .mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: 'Content-Range: bytes 10-13/100\r\n',
        body: new Uint8Array([10, 11, 12, 13]),
      })

    const reader = new RangeMediaReader(track, source)
    await expect(reader.getSize()).resolves.toBe(100)
    await expect(reader.read(10, 14)).resolves.toEqual(new Uint8Array([10, 11, 12, 13]))
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        headers: { Referer: 'https://www.bilibili.com/', Range: 'bytes=10-13' },
        credentials: 'include',
        maxResponseBytes: 4,
        timeoutMs: 30_000,
      }),
    )
    expect(requestMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ timeoutMs: 5_000 }))
  })

  it('reuses a small complete response when the server ignores Range', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: 'Content-Length: 4\r\n',
      body: new Uint8Array([1, 2, 3, 4]),
    })

    const reader = new RangeMediaReader(track, source)
    await expect(reader.getSize()).resolves.toBe(4)
    await expect(reader.read(1, 3)).resolves.toEqual(new Uint8Array([2, 3]))
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('retries Range against an ephemeral final CDN URL after a redirect returns a large body', async () => {
    const finalUrl = 'https://cdn.example/ephemeral/audio.mp4?token=test'
    requestMock
      .mockRejectedValueOnce(new ResponseTooLargeError(1024 * 1024, finalUrl))
      .mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: 'Content-Range: bytes 0-0/100\r\n',
        body: new Uint8Array([0]),
      })

    await expect(new RangeMediaReader(track, source).getSize()).resolves.toBe(100)

    expect(requestMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: source.url }))
    expect(requestMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: finalUrl }))
  })

  it('keeps declarative custom media requests anonymous', async () => {
    requestMock.mockResolvedValueOnce({
      status: 206,
      statusText: 'Partial Content',
      headers: 'Content-Range: bytes 0-0/10\r\n',
      body: new Uint8Array([0]),
    })
    const customTrack = {
      ...track,
      source: { ...track.source, pluginId: 'custom-demo' },
    }

    await new RangeMediaReader(customTrack, source).getSize()

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({ credentials: 'omit' }))
  })

  it('cancels an in-flight GM range request when the reader is disposed', async () => {
    requestMock.mockImplementationOnce(
      (request: {
        cancellation: { isCancelled(): boolean; subscribe(listener: () => void): () => void }
      }) =>
        new Promise((_resolve, reject) => {
          expect(request.cancellation.isCancelled()).toBe(false)
          request.cancellation.subscribe(() => reject(new Error('aborted')))
        }),
    )

    const reader = new RangeMediaReader(track, source)
    const pending = reader.getSize().catch((error: unknown) => error)
    await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1))
    reader.dispose()

    await expect(pending).resolves.toMatchObject({ code: 'operation-cancelled' })
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    '',
    'Content-Range: bytes 10-99/50',
    'Content-Range: bytes 9-12/100',
    'Content-Range: bytes 10-12/100',
    'Content-Range: bytes 10-13/*',
    'Content-Range: bytes 10-13/13',
    'Content-Range: bytes 10-13/9007199254740992',
  ])('rejects an unverifiable 206 range: %s', async (headers) => {
    requestMock.mockResolvedValue({
      status: 206,
      statusText: 'Partial Content',
      headers,
      body: new Uint8Array(4),
    })
    const reader = new RangeMediaReader(track, source)
    try {
      await expect(reader.read(10, 14)).rejects.toMatchObject({ code: 'media-range-invalid' })
    } finally {
      reader.dispose()
    }
  })

  it('validates the size probe interval and body before caching its result', async () => {
    requestMock
      .mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: 'Content-Range: bytes 1-1/100',
        body: new Uint8Array([0]),
      })
      .mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: 'Content-Range: bytes 0-0/100',
        body: new Uint8Array([0]),
      })
    const reader = new RangeMediaReader(track, source)
    try {
      await expect(reader.getSize()).rejects.toMatchObject({ code: 'media-range-invalid' })
      await expect(reader.getSize()).resolves.toBe(100)
      expect(requestMock).toHaveBeenCalledTimes(2)
    } finally {
      reader.dispose()
    }
  })

  it.each(['probe', 'read'])('rejects a truncated %s response', async (operation) => {
    requestMock.mockResolvedValueOnce({
      status: 206,
      statusText: 'Partial Content',
      headers:
        operation === 'probe' ? 'Content-Range: bytes 0-0/100' : 'Content-Range: bytes 10-13/100',
      body: new Uint8Array(operation === 'probe' ? 0 : 3),
    })
    const reader = new RangeMediaReader(track, source)
    try {
      await expect(
        operation === 'probe' ? reader.getSize() : reader.read(10, 14),
      ).rejects.toMatchObject({ code: 'media-range-invalid' })
    } finally {
      reader.dispose()
    }
  })

  it('rejects a changed total size after the successful probe', async () => {
    requestMock
      .mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: 'Content-Range: bytes 0-0/100',
        body: new Uint8Array([0]),
      })
      .mockResolvedValueOnce({
        status: 206,
        statusText: 'Partial Content',
        headers: 'Content-Range: bytes 10-13/101',
        body: new Uint8Array(4),
      })
    const reader = new RangeMediaReader(track, source)
    try {
      await reader.getSize()
      await expect(reader.read(10, 14)).rejects.toMatchObject({ code: 'media-range-invalid' })
      await expect(reader.read(99, 101)).rejects.toMatchObject({ code: 'media-range-invalid' })
      expect(requestMock).toHaveBeenCalledTimes(2)
    } finally {
      reader.dispose()
    }
  })

  it('coalesces concurrent size probes and permits a retry after transport failure', async () => {
    requestMock.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({
      status: 206,
      statusText: 'Partial Content',
      headers: 'Content-Range: bytes 0-0/100',
      body: new Uint8Array([0]),
    })
    const reader = new RangeMediaReader(track, source)
    try {
      const first = reader.getSize()
      expect(reader.getSize()).toBe(first)
      await expect(first).rejects.toThrow('temporary failure')
      const retried = reader.getSize()
      expect(reader.getSize()).toBe(retried)
      await expect(retried).resolves.toBe(100)
      expect(requestMock).toHaveBeenCalledTimes(2)
    } finally {
      reader.dispose()
    }
  })

  it('bounds a large read to three requests and assembles chunks in byte order', async () => {
    const requests = controlRequests()
    const reader = new RangeMediaReader(track, source)
    const size = 32 * 1024 * 1024
    const result = reader.read(0, size)
    const outcome = result.catch((error: unknown) => error)
    try {
      await vi.waitFor(() => expect(requests.entries.length).toBeGreaterThanOrEqual(3))
      expect(requests.entries).toHaveLength(3)
      // Complete the first window in reverse order, then let the remaining windows roll forward.
      requests.entries[2]!.resolve(size, 3)
      requests.entries[1]!.resolve(size, 2)
      requests.entries[0]!.resolve(size, 1)
      for (let index = 3; index < 16; index++) {
        // eslint-disable-next-line no-await-in-loop
        await vi.waitFor(() => expect(requests.entries.length).toBeGreaterThan(index))
        requests.entries[index]!.resolve(size, index + 1)
      }
      const bytes = await result
      expect(bytes).toHaveLength(size)
      for (let index = 0; index < 16; index++) {
        expect(bytes[index * 2 * 1024 * 1024]).toBe(index + 1)
        expect(bytes[(index + 1) * 2 * 1024 * 1024 - 1]).toBe(index + 1)
      }
      expect(requests.entries).toHaveLength(16)
      expect(requests.peak()).toBe(3)
      expect(requests.active()).toBe(0)
    } finally {
      reader.dispose()
      await outcome
    }
  })

  it('shares its three-request budget across concurrent reads and size probes', async () => {
    const requests = controlRequests()
    const reader = new RangeMediaReader(track, source)
    const work = [
      reader.read(0, 8 * 1024 * 1024),
      reader.read(8 * 1024 * 1024, 16 * 1024 * 1024),
      reader.getSize(),
    ].map((promise) => promise.catch((error: unknown) => error))
    try {
      await vi.waitFor(() => expect(requests.entries.length).toBeGreaterThanOrEqual(3))
      expect(requests.entries).toHaveLength(3)
      requests.entries[0]!.resolve(32 * 1024 * 1024)
      await vi.waitFor(() => expect(requests.entries).toHaveLength(4))
      expect(requests.active()).toBe(3)
      expect(requests.peak()).toBe(3)
    } finally {
      reader.dispose()
      await Promise.all(work)
    }
    expect(requestMock).toHaveBeenCalledTimes(4)
  })

  it.each(['transport', 'range'])(
    'cancels siblings and stops new chunk claims after a %s failure, then allows a fresh read',
    async (failure) => {
      const requests = controlRequests()
      const reader = new RangeMediaReader(track, source)
      const outcome = reader.read(0, 32 * 1024 * 1024).catch((error: unknown) => error)
      try {
        await vi.waitFor(() => expect(requests.entries.length).toBeGreaterThanOrEqual(3))
        if (failure === 'transport') requests.entries[0]!.reject(new Error('chunk failed'))
        else requests.entries[0]!.resolve(32 * 1024 * 1024, 0, '')
        const error = await outcome
        if (failure === 'transport') expect(error).toMatchObject({ message: 'chunk failed' })
        else expect(error).toMatchObject({ code: 'media-range-invalid' })
        expect(requests.entries).toHaveLength(3)
        expect(
          requests.entries.slice(1).every((entry) => entry.request.cancellation!.isCancelled()),
        ).toBe(true)
        await vi.waitFor(() => expect(requests.active()).toBe(0))
        requestMock.mockResolvedValueOnce({
          status: 206,
          statusText: 'Partial Content',
          headers: 'Content-Range: bytes 10-13/33554432',
          body: new Uint8Array([1, 2, 3, 4]),
        })
        await expect(reader.read(10, 14)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]))
      } finally {
        reader.dispose()
        await outcome
      }
    },
  )

  it('keeps another read usable when one concurrent read group fails', async () => {
    const requests = controlRequests()
    const reader = new RangeMediaReader(track, source)
    const failed = reader.read(0, 8 * 1024 * 1024).catch((error: unknown) => error)
    const surviving = reader.read(10, 14)
    const survivingOutcome = surviving.catch((error: unknown) => error)
    try {
      await vi.waitFor(() => expect(requests.entries).toHaveLength(3))
      requests.entries[0]!.reject(new Error('group failed'))
      await expect(failed).resolves.toMatchObject({ message: 'group failed' })
      await vi.waitFor(() => expect(requests.entries).toHaveLength(4))
      expect(requests.entries[3]!.request.cancellation!.isCancelled()).toBe(false)
      requests.entries[3]!.resolve(32 * 1024 * 1024, 7)
      await expect(surviving).resolves.toEqual(new Uint8Array([7, 7, 7, 7]))
    } finally {
      reader.dispose()
      await survivingOutcome
    }
  })

  it.each(['dispose', 'external abort'])(
    'rejects queued and in-flight work on %s without dispatching more requests',
    async (action) => {
      const requests = controlRequests()
      const controller = new AbortController()
      const reader = new RangeMediaReader(track, source, source.url, { signal: controller.signal })
      const work = [
        reader.read(0, 8 * 1024 * 1024),
        reader.read(8 * 1024 * 1024, 16 * 1024 * 1024),
        reader.getSize(),
      ].map((promise) => promise.catch((error: unknown) => error))
      await vi.waitFor(() => expect(requests.entries).toHaveLength(3))
      if (action === 'dispose') reader.dispose()
      else controller.abort()
      for (const error of await Promise.all(work))
        expect(error).toMatchObject({ code: 'operation-cancelled' })
      expect(requestMock).toHaveBeenCalledTimes(3)
      expect(requests.active()).toBe(0)
      await expect(reader.getSize()).rejects.toMatchObject({ code: 'operation-cancelled' })
      await expect(reader.read(0, 1)).rejects.toMatchObject({ code: 'operation-cancelled' })
      reader.dispose()
    },
  )

  it.each(['range', 'size probe'])(
    'rejects a settled %s response when disposal precedes its continuation',
    async (operation) => {
      const reader = new RangeMediaReader(track, source)
      requestMock.mockImplementationOnce(() => {
        const response = Promise.resolve({
          status: 206,
          statusText: 'Partial Content',
          headers: 'Content-Range: bytes 0-0/100',
          body: new Uint8Array([1]),
        })
        queueMicrotask(() => reader.dispose())
        return response
      })
      await expect(
        operation === 'range' ? reader.read(0, 1) : reader.getSize(),
      ).rejects.toMatchObject({ code: 'operation-cancelled' })
      expect(requestMock).toHaveBeenCalledTimes(1)
    },
  )

  it('does not serve cached size or complete bytes after an external abort', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: '',
      body: new Uint8Array([1, 2, 3, 4]),
    })
    const controller = new AbortController()
    const reader = new RangeMediaReader(track, source, source.url, { signal: controller.signal })
    await expect(reader.getSize()).resolves.toBe(4)
    controller.abort()
    await expect(reader.getSize()).rejects.toMatchObject({ code: 'operation-cancelled' })
    await expect(reader.read(1, 3)).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('does not start a redirected retry after cancellation', async () => {
    const reader = new RangeMediaReader(track, source)
    requestMock.mockImplementationOnce(() => {
      queueMicrotask(() => reader.dispose())
      return Promise.reject(new ResponseTooLargeError(1024 * 1024, 'https://cdn.example/audio'))
    })
    await expect(reader.getSize()).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(requestMock).toHaveBeenCalledTimes(1)
  })
})

function controlRequests() {
  let active = 0
  let peak = 0
  const entries: {
    request: HttpRequest
    resolve(size: number, fill?: number, headers?: string): void
    reject(error: unknown): void
  }[] = []
  requestMock.mockImplementation((request: HttpRequest) => {
    active++
    peak = Math.max(peak, active)
    let unsubscribe: (() => void) | undefined
    return new Promise<HttpResponse>((resolve, reject) => {
      entries.push({
        request,
        resolve(size, fill = 0, headers) {
          const [start, end] = request.headers!.Range!.slice(6).split('-').map(Number)
          resolve({
            status: 206,
            statusText: 'Partial Content',
            headers: headers ?? `Content-Range: bytes ${start}-${end}/${size}`,
            body: new Uint8Array(end! - start! + 1).fill(fill),
          })
        },
        reject,
      })
      unsubscribe = request.cancellation!.subscribe(() => reject(new Error('transport aborted')))
    }).finally(() => {
      active--
      unsubscribe?.()
    })
  })
  return { entries, active: () => active, peak: () => peak }
}
