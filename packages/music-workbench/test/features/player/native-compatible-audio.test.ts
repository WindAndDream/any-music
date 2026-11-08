import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { RemoteResolvedMediaSource, Track } from '@any-music/core'
import { EncodedPacket } from 'mediabunny'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('#workbench/runtime/http', () => ({
  runtimeHttpClient: { request: requestMock },
}))

import {
  createNativeAudioMimeType,
  createNativeCompatibleAudioFile,
  isNativeAudioInputUnavailableError,
  NativeAudioInputUnavailableError,
  NativeAudioStartupTimeoutError,
  normalizeEncodedAudioPacketTimestamp,
  selectNativeAudioStartPacket,
  shouldSkipNativeAudioExtraction,
} from '#workbench/features/player/native-compatible-audio'

interface RangeRequest {
  url: string
  headers: Record<string, string>
  maxResponseBytes: number
  cancellation: { subscribe(listener: () => void): () => void }
}

const fixture = new Uint8Array(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/music/“好听”!Everlasting Truth (Album Mix).mp3', import.meta.url),
    ),
  ),
)

const track: Track = {
  id: 'douyin:video:test',
  title: '音轨抽取测试',
  artists: [{ name: '测试' }],
  source: { pluginId: 'douyin', mediaKind: 'video', resourceId: 'test' },
}
const source: RemoteResolvedMediaSource = {
  type: 'remote-url',
  url: 'https://media.example/test.mp3',
  backupUrls: [],
  quality: { id: 'audio:128k', label: 'MP3 · 128 kbps', rank: 128_000 },
  availableQualities: [{ id: 'audio:128k', label: 'MP3 · 128 kbps', rank: 128_000 }],
  requestHeaders: { Referer: 'https://www.douyin.com/' },
  loadingStrategy: 'range',
}

describe('native compatible audio', () => {
  beforeEach(() => {
    vi.useRealTimers()
    requestMock.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('creates the SourceBuffer MIME type without waiting for the first encoded packet', () => {
    expect(createNativeAudioMimeType('mp4a.40.2')).toBe('audio/mp4; codecs="mp4a.40.2"')
    expect(createNativeAudioMimeType(' opus ')).toBe('audio/mp4; codecs="opus"')
    expect(() => createNativeAudioMimeType('')).toThrow('无效的编码参数')
    expect(() => createNativeAudioMimeType('bad"codec')).toThrow('无效的编码参数')
  })

  it('skips the duplicate extraction pass for unavailable Range input or startup timeout', () => {
    expect(shouldSkipNativeAudioExtraction(new NativeAudioInputUnavailableError([]))).toBe(true)
    expect(shouldSkipNativeAudioExtraction(new NativeAudioStartupTimeoutError())).toBe(true)
    expect(shouldSkipNativeAudioExtraction(new Error('MSE codec rejected'))).toBe(false)
  })

  it('shifts negative AAC preroll timestamps onto a non-negative muxing timeline', () => {
    const packet = new EncodedPacket(new Uint8Array([1, 2, 3]), 'key', -0.16, 0.02, 0)

    const normalized = normalizeEncodedAudioPacketTimestamp(packet, 0.16)

    expect(normalized.timestamp).toBe(0)
    expect(normalized.duration).toBe(packet.duration)
    expect(normalized.data).toEqual(packet.data)
  })

  it('starts a rebuilt stream at the requested seek packet instead of remuxing from zero', async () => {
    const firstPacket = new EncodedPacket(new Uint8Array([1]), 'key', 0, 0.02, 0)
    const seekPacket = new EncodedPacket(new Uint8Array([2]), 'key', 120, 0.02, 0)
    const sink = {
      getFirstPacket: vi.fn(() => Promise.resolve(firstPacket)),
      getPacket: vi.fn(() => Promise.resolve(seekPacket)),
    }

    await expect(selectNativeAudioStartPacket(sink, 120)).resolves.toBe(seekPacket)
    expect(sink.getPacket).toHaveBeenCalledWith(120)
    expect(sink.getFirstPacket).not.toHaveBeenCalled()

    await expect(selectNativeAudioStartPacket(sink, 0)).resolves.toBe(firstPacket)
    expect(sink.getFirstPacket).toHaveBeenCalledTimes(1)
  })

  it('extracts encoded audio through GM Range into a native playable file', async () => {
    const fixtureBytes = new Uint8Array(
      readFileSync(
        fileURLToPath(
          new URL('../../fixtures/music/“好听”!Everlasting Truth (Album Mix).mp3', import.meta.url),
        ),
      ),
    )
    requestMock.mockImplementation(
      (request: { headers: Record<string, string>; maxResponseBytes: number }) => {
        const match = request.headers.Range?.match(/^bytes=(\d+)-(\d+)$/)
        if (!match) throw new Error('测试请求缺少 Range')
        const start = Number(match[1])
        const requestedEnd = Number(match[2]) + 1
        const end = Math.min(requestedEnd, fixtureBytes.byteLength)
        const body = fixtureBytes.slice(start, end)
        expect(body.byteLength).toBeLessThanOrEqual(request.maxResponseBytes)
        return Promise.resolve({
          status: 206,
          statusText: 'Partial Content',
          headers: `Content-Range: bytes ${start}-${end - 1}/${fixtureBytes.byteLength}\r\n`,
          body,
        })
      },
    )

    const file = await createNativeCompatibleAudioFile(track, source)

    expect(file.mimeType).toBe('audio/mpeg')
    expect(file.bytes.byteLength).toBeGreaterThan(100_000)
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ Referer: 'https://www.douyin.com/' }),
      }),
    )
  })

  it('hedges a stalled primary CDN node and cancels it after a backup becomes readable', async () => {
    const hedgedSource: RemoteResolvedMediaSource = {
      ...source,
      url: 'https://primary.example/test.mp3',
      backupUrls: ['https://backup.example/test.mp3'],
    }
    let isPrimaryCancelled = false
    requestMock.mockImplementation((request: RangeRequest) => {
      if (request.url.includes('primary.example')) {
        return new Promise((_resolve, reject) => {
          request.cancellation.subscribe(() => {
            isPrimaryCancelled = true
            reject(new Error('primary cancelled'))
          })
        })
      }
      return createFixtureRangeResponse(request)
    })

    const file = await createNativeCompatibleAudioFile(track, hedgedSource)

    expect(file.bytes.byteLength).toBeGreaterThan(100_000)
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://backup.example/test.mp3' }),
    )
    expect(isPrimaryCancelled).toBe(true)
  })

  it('starts all stalled CDN probes without serially waiting for earlier timeouts', async () => {
    vi.useFakeTimers()
    const hedgedSource: RemoteResolvedMediaSource = {
      ...source,
      url: 'https://primary.example/test.mp3',
      backupUrls: ['https://backup-one.example/test.mp3', 'https://backup-two.example/test.mp3'],
    }
    requestMock.mockImplementation(
      (request: RangeRequest) =>
        new Promise((_resolve, reject) => {
          const timeoutId = globalThis.setTimeout(() => reject(new Error('timeout')), 5_000)
          request.cancellation.subscribe(() => {
            globalThis.clearTimeout(timeoutId)
            reject(new Error('cancelled'))
          })
        }),
    )

    const errorPromise = createNativeCompatibleAudioFile(track, hedgedSource).catch(
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(600)
    expect(requestMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(isNativeAudioInputUnavailableError(await errorPromise)).toBe(true)
  })
})

function createFixtureRangeResponse(request: RangeRequest) {
  const match = request.headers.Range?.match(/^bytes=(\d+)-(\d+)$/)
  if (!match) throw new Error('测试请求缺少 Range')
  const start = Number(match[1])
  const requestedEnd = Number(match[2]) + 1
  const end = Math.min(requestedEnd, fixture.byteLength)
  const body = fixture.slice(start, end)
  expect(body.byteLength).toBeLessThanOrEqual(request.maxResponseBytes)
  return Promise.resolve({
    status: 206,
    statusText: 'Partial Content',
    headers: `Content-Range: bytes ${start}-${end - 1}/${fixture.byteLength}\r\n`,
    body,
  })
}
