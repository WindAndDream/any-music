import { AppError, normalizeAppError } from '@any-music/core'
import type { ResolvedMediaSource, Track } from '@any-music/core'

import { runtimeHttpClient } from '../runtime/http'

const MAX_EXPORT_SOURCE_BYTES = 512 * 1024 * 1024

export interface LoadedMediaFile {
  bytes: Uint8Array
  mimeType?: string
}

/**
 * 导出必须读取媒体字节，统一走注入的运行端 HTTP，避免继承 renderer 的 CORS 限制。
 * 声明式自定义源仍强制匿名；内置源可携带目标平台登录态。
 */
export async function loadResolvedMediaFile(
  track: Track,
  source: ResolvedMediaSource,
  options: { signal?: AbortSignal } = {},
): Promise<LoadedMediaFile> {
  throwIfCancelled(options.signal)
  if (source.type === 'complete-binary') {
    return { bytes: new Uint8Array(source.bytes), mimeType: source.mimeType }
  }

  const errors: string[] = []
  for (const url of [source.url, ...source.backupUrls]) {
    throwIfCancelled(options.signal)
    try {
      // 备用节点按优先级串行尝试；并发请求会浪费大体积媒体流量。
      // eslint-disable-next-line no-await-in-loop
      const response = await runtimeHttpClient.request({
        url,
        // 请求头来自当前解析会话，不会写入资料库；平台防盗链规则仍留在对应插件边界。
        headers: source.requestHeaders ? { ...source.requestHeaders } : undefined,
        credentials: track.source.pluginId.startsWith('custom-') ? 'omit' : 'include',
        responseType: 'bytes',
        maxResponseBytes: MAX_EXPORT_SOURCE_BYTES,
        timeoutMs: 120_000,
        cancellation: options.signal ? createCancellationSignal(options.signal) : undefined,
      })
      throwIfCancelled(options.signal)
      if (response.status < 200 || response.status >= 300 || typeof response.body === 'string') {
        throw new AppError('network-error', `HTTP ${response.status} ${response.statusText}`)
      }
      return { bytes: response.body, mimeType: source.mimeType }
    } catch (error) {
      throwIfCancelled(options.signal)
      errors.push(normalizeAppError(error, 'network-error', '未知下载错误').message)
    }
  }

  throw new AppError('media-unavailable', `所有媒体节点均下载失败：${errors.join('；')}`)
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

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new AppError('operation-cancelled', '下载已由用户中止。')
}
