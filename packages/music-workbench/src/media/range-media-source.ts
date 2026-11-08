import { AppError } from '@any-music/core'
import type { RemoteResolvedMediaSource, Track } from '@any-music/core'
import { CustomSource } from 'mediabunny'

import { runtimeHttpClient } from '../runtime/http'
import { ResponseTooLargeError } from './response-too-large-error'

const RANGE_PROBE_MAX_BYTES = 1024 * 1024
const RANGE_REQUEST_CHUNK_BYTES = 2 * 1024 * 1024
// Bound the entire reader, including simultaneous decoder reads and size probes.
const RANGE_REQUEST_CONCURRENCY = 3
const MEDIA_SOURCE_CACHE_BYTES = 16 * 1024 * 1024
// Range 首探测只负责确认节点能力；长时间等待会在每个备用节点上被成倍放大。
const RANGE_PROBE_TIMEOUT_MS = 5_000
const RANGE_REQUEST_TIMEOUT_MS = 30_000

interface RangeMediaReaderOptions {
  signal?: AbortSignal
}

/**
 * 把运行端 HTTP 能力适配为 Mediabunny 的随机读取源。
 * 读取严格限定在解封装器请求的字节范围内；只有服务器忽略 Range 且完整资源小于探测上限时，
 * 才把这个小资源作为当前播放会话的完整内存副本复用。
 */
export class RangeMediaReader {
  private readonly track: Track
  private readonly source: RemoteResolvedMediaSource
  private readonly controller = new AbortController()
  private removeExternalAbortListener: () => void = noop
  private completeBytes?: Uint8Array
  private sizePromise?: Promise<number>
  private mediaSize?: number
  private resolvedUrl: string
  private activeRequests = 0
  private readonly requestQueue: (() => void)[] = []

  constructor(
    track: Track,
    source: RemoteResolvedMediaSource,
    url = source.url,
    options: RangeMediaReaderOptions = {},
  ) {
    this.track = track
    this.source = source
    this.resolvedUrl = url
    const externalSignal = options.signal
    if (externalSignal?.aborted) {
      this.dispose()
    } else if (externalSignal) {
      const abort = () => this.dispose()
      externalSignal.addEventListener('abort', abort, { once: true })
      this.removeExternalAbortListener = () => externalSignal.removeEventListener('abort', abort)
    }
  }

  getSize(): Promise<number> {
    if (this.controller.signal.aborted) return Promise.reject(createCancellationError())
    if (!this.sizePromise) {
      const pending = this.runRequest(this.controller.signal, () => this.probeSize())
      this.sizePromise = pending
      void pending.catch(() => {
        if (this.sizePromise === pending) this.sizePromise = undefined
      })
    }
    return this.sizePromise
  }

  async read(start: number, end: number): Promise<Uint8Array> {
    throwIfCancelled(this.controller.signal)
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      (this.mediaSize !== undefined && end > this.mediaSize)
    ) {
      throw new AppError('media-range-invalid', '媒体字节范围无效。')
    }
    if (this.completeBytes) return this.completeBytes.slice(start, end)

    const singleChunk = end - start <= RANGE_REQUEST_CHUNK_BYTES
    let result: Uint8Array | undefined = singleChunk ? undefined : new Uint8Array(end - start)
    const group = new AbortController()
    const abort = () => group.abort()
    this.controller.signal.addEventListener('abort', abort, { once: true })
    let nextOffset = start
    let failure: { cause: unknown } | undefined

    const readChunks = async () => {
      while (nextOffset < end) {
        throwIfCancelled(group.signal)
        const chunkStart = nextOffset
        const chunkEnd = Math.min(end, chunkStart + RANGE_REQUEST_CHUNK_BYTES)
        nextOffset = chunkEnd
        // Workers claim only their next chunk; the reader-wide queue bounds other reads too.
        // eslint-disable-next-line no-await-in-loop
        await this.runRequest(group.signal, async () => {
          try {
            const chunk = await this.requestRange(chunkStart, chunkEnd, group.signal)
            throwIfCancelled(group.signal)
            if (singleChunk) result = chunk
            else result!.set(chunk, chunkStart - start)
          } catch (error) {
            failure ??= { cause: error }
            // Cancel siblings before releasing this slot, so failed groups cannot dispatch queued work.
            group.abort()
            throw error
          }
        })
      }
    }

    try {
      const workerCount = Math.min(
        RANGE_REQUEST_CONCURRENCY,
        Math.ceil((end - start) / RANGE_REQUEST_CHUNK_BYTES),
      )
      await Promise.all(Array.from({ length: workerCount }, readChunks))
      throwIfCancelled(group.signal)
      return result!
    } catch (error) {
      group.abort()
      if (failure) throw failure.cause
      throw error
    } finally {
      this.controller.signal.removeEventListener('abort', abort)
    }
  }

  /** Input 释放或播放器切歌时，立即终止仍在等待的运行端请求。 */
  dispose(): void {
    this.removeExternalAbortListener()
    this.removeExternalAbortListener = noop
    this.controller.abort()
    this.completeBytes = undefined
    this.sizePromise = undefined
    this.mediaSize = undefined
  }

  private async probeSize(): Promise<number> {
    const response = await this.requestBytes(0, 1, RANGE_PROBE_MAX_BYTES, RANGE_PROBE_TIMEOUT_MS)
    throwIfCancelled(this.controller.signal)
    if (response.status === 206) {
      this.validateRangeResponse(response, 0, 1)
      return this.mediaSize!
    }

    if (response.status === 200 && response.body.byteLength <= RANGE_PROBE_MAX_BYTES) {
      this.setMediaSize(response.body.byteLength)
      this.completeBytes = response.body
      return response.body.byteLength
    }
    throw new AppError(
      'media-range-invalid',
      `媒体来源不支持可验证的字节范围请求：HTTP ${response.status}。`,
    )
  }

  private async requestRange(start: number, end: number, signal: AbortSignal): Promise<Uint8Array> {
    const response = await this.requestBytes(
      start,
      end,
      end - start,
      RANGE_REQUEST_TIMEOUT_MS,
      signal,
    )
    throwIfCancelled(signal)
    if (response.status === 206) {
      this.validateRangeResponse(response, start, end)
      return response.body
    }

    if (
      response.status === 200 &&
      response.body.byteLength >= end &&
      response.body.byteLength <= RANGE_PROBE_MAX_BYTES
    ) {
      this.setMediaSize(response.body.byteLength)
      this.completeBytes = response.body
      return response.body.slice(start, end)
    }
    throw new AppError(
      'media-range-invalid',
      `媒体字节范围 ${start}-${end - 1} 请求失败：HTTP ${response.status}。`,
    )
  }

  private validateRangeResponse(
    response: { headers: string; body: Uint8Array },
    start: number,
    end: number,
  ): void {
    const range = parseContentRange(readHeader(response.headers, 'content-range'))
    if (
      !range ||
      range.start !== start ||
      range.end !== end - 1 ||
      response.body.byteLength !== end - start
    ) {
      throw new AppError('media-range-invalid', `媒体范围响应与请求 ${start}-${end - 1} 不匹配。`)
    }
    this.setMediaSize(range.size)
  }

  private setMediaSize(size: number): void {
    if (this.mediaSize !== undefined && this.mediaSize !== size) {
      throw new AppError('media-range-invalid', '媒体范围响应的资源大小发生变化。')
    }
    this.mediaSize = size
  }

  private async runRequest<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    await this.acquireRequestSlot(signal)
    try {
      throwIfCancelled(signal)
      const result = await operation()
      throwIfCancelled(signal)
      return result
    } finally {
      this.activeRequests--
      this.requestQueue.shift()?.()
    }
  }

  private acquireRequestSlot(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(createCancellationError())
        return
      }
      const abort = () => {
        const index = this.requestQueue.indexOf(start)
        if (index >= 0) this.requestQueue.splice(index, 1)
        reject(createCancellationError())
      }
      const start = () => {
        signal.removeEventListener('abort', abort)
        this.activeRequests++
        resolve()
      }
      if (this.activeRequests < RANGE_REQUEST_CONCURRENCY) start()
      else {
        this.requestQueue.push(start)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
  }

  private async requestBytes(
    start: number,
    end: number,
    maxResponseBytes: number,
    timeoutMs: number,
    signal = this.controller.signal,
  ) {
    const request = () => {
      throwIfCancelled(signal)
      return runtimeHttpClient.request({
        url: this.resolvedUrl,
        headers: {
          ...this.source.requestHeaders,
          Range: `bytes=${start}-${end - 1}`,
        },
        credentials: this.track.source.pluginId.startsWith('custom-') ? 'omit' : 'include',
        responseType: 'bytes',
        maxResponseBytes,
        timeoutMs,
        cancellation: createCancellationSignal(signal),
      })
    }

    let response
    try {
      response = await request()
    } catch (error) {
      throwIfCancelled(signal)
      const redirectedUrl = readRetryableRedirectUrl(error, this.resolvedUrl)
      if (!redirectedUrl) throw error
      // 抖音播放入口会忽略 Range 并重定向到短时 CDN；复用响应头里的最终地址再次请求，
      // 避免完整下载入口响应。地址只保存在当前 reader 内，dispose 后随播放会话释放。
      this.resolvedUrl = redirectedUrl
      response = await request().catch((retryError: unknown) => {
        throwIfCancelled(signal)
        throw retryError
      })
    }
    throwIfCancelled(signal)
    if (typeof response.body === 'string') {
      throw new AppError('media-range-invalid', '媒体范围请求没有返回二进制数据。')
    }
    return { ...response, body: response.body }
  }
}

function readRetryableRedirectUrl(error: unknown, currentUrl: string): string | undefined {
  if (!(error instanceof ResponseTooLargeError) || !error.finalUrl) return undefined
  try {
    const redirected = new URL(error.finalUrl)
    if (!['http:', 'https:'].includes(redirected.protocol) || redirected.href === currentUrl) {
      return undefined
    }
    return redirected.href
  } catch {
    return undefined
  }
}

/** 创建只在当前播放会话中保留有限字节缓存的 Mediabunny 输入源。 */
export function createRangeMediaSource(
  track: Track,
  source: RemoteResolvedMediaSource,
  url = source.url,
  options: RangeMediaReaderOptions = {},
): CustomSource {
  const reader = new RangeMediaReader(track, source, url, options)
  return new CustomSource({
    getSize: () => reader.getSize(),
    read: (start, end) => reader.read(start, end),
    dispose: () => reader.dispose(),
    maxCacheSize: MEDIA_SOURCE_CACHE_BYTES,
    prefetchProfile: 'network',
  })
}

function createCancellationSignal(signal: AbortSignal) {
  return {
    isCancelled: () => signal.aborted,
    subscribe(listener: () => void) {
      signal.addEventListener('abort', listener, { once: true })
      return () => signal.removeEventListener('abort', listener)
    },
  }
}

function noop(): void {}

function readHeader(rawHeaders: string, name: string): string | undefined {
  const normalizedName = name.toLowerCase()
  for (const line of rawHeaders.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex < 0) continue
    if (line.slice(0, separatorIndex).trim().toLowerCase() === normalizedName) {
      return line.slice(separatorIndex + 1).trim()
    }
  }
  return undefined
}

function createCancellationError(): AppError {
  return new AppError('operation-cancelled', '媒体读取已中止。')
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw createCancellationError()
}

function parseContentRange(
  value: string | undefined,
): { start: number; end: number; size: number } | undefined {
  const match = value?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  if (!match) return undefined
  const start = Number(match[1])
  const end = Number(match[2])
  const size = Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(size) ||
    start < 0 ||
    end < start ||
    size <= end
  )
    return undefined
  return { start, end, size }
}
