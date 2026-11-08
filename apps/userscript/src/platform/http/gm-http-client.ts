import { GM_xmlhttpRequest } from '$'
import type { GmXmlhttpRequestOption } from '$'
import { AppError } from '@any-music/core'
import type { HttpClient, HttpRequest, HttpResponse } from '@any-music/core'

import { GmResponseTooLargeError } from './gm-errors'
import { getGmProxyConfiguration, type GmProxyConfiguration } from './gm-proxy'

type GmHttpRequestDetails = GmXmlhttpRequestOption<'text' | 'arraybuffer'> & {
  // vite-plugin-monkey 8.1 的类型尚未收录 Tampermonkey 的 fetch 传输开关。
  fetch?: boolean
  // vite-plugin-monkey 8.1 的类型尚未收录 Tampermonkey 5.5 新增的 Firefox proxy 字段。
  proxy?: GmProxyConfiguration
}

/**
 * Userscript 统一通过 GM 请求访问平台 API，避免请求继承任意宿主网页的 origin 和 CORS 限制。
 * 是否携带目标站点 Cookie 只由 core 的 credentials 契约决定：内置平台显式 include，
 * 声明式自定义插件显式 omit，不能根据当前页面域名隐式切换传输方式。
 */
let cachedClient: HttpClient | undefined
export function configureGmHttpCache(client?: HttpClient): void {
  cachedClient = client
}
export const gmHttpClient: HttpClient = {
  request: (input) => (cachedClient ?? gmHttpTransport).request(input),
}
export const gmHttpTransport: HttpClient = {
  request(request: HttpRequest): Promise<HttpResponse> {
    if (request.cancellation?.isCancelled()) {
      return Promise.reject(new Error(`Userscript request aborted: ${request.url}`))
    }
    return new Promise((resolve, reject) => {
      let settled = false
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      let unsubscribeCancellation: () => void = noop
      const proxy = getGmProxyConfiguration()
      const settle = (callback: () => void): void => {
        if (settled) return
        settled = true
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
        unsubscribeCancellation()
        callback()
      }
      const rejectOversizedResponse = (finalUrl?: string): void => {
        settle(() => {
          // 先把 Promise 标记为完成再中止，避免同步 onabort 覆盖真正的大小错误。
          requestHandle.abort()
          reject(new GmResponseTooLargeError(request.maxResponseBytes!, finalUrl))
        })
      }
      const requestDetails: GmHttpRequestDetails = {
        method: request.method ?? 'GET',
        url: request.url,
        data: request.body,
        headers: request.headers,
        timeout: request.timeoutMs,
        // 脚本宿主页并不稳定，GM 层只有收到显式 include 才能发送目标域 Cookie。
        anonymous: request.credentials !== 'include',
        responseType: request.responseType === 'bytes' ? 'arraybuffer' : 'text',
        // Chrome 的 GM XHR 通道对小型鉴权 API 有明显固定延迟；文本响应无需进度事件时改用
        // Tampermonkey fetch 通道。媒体与受大小上限保护的响应仍使用 XHR，以便在头部/进度阶段中止。
        ...(shouldUseFetchTransport(request) ? { fetch: true } : {}),
        // 所有 API、媒体下载与 Range 请求共用这一入口，因此全局代理在此统一生效。
        ...(proxy ? { proxy } : {}),
        onreadystatechange(response) {
          if (response.readyState !== 2 || settled || request.maxResponseBytes === undefined) return
          const contentLength = readContentLength(response.responseHeaders)
          if (contentLength !== undefined && contentLength > request.maxResponseBytes) {
            // CDN 忽略 Range 时通常会在响应头直接暴露完整文件大小，无需再下载到上限才发现。
            rejectOversizedResponse(response.finalUrl)
          }
        },
        onprogress(response) {
          if (
            request.maxResponseBytes !== undefined &&
            response.loaded > request.maxResponseBytes &&
            !settled
          ) {
            rejectOversizedResponse(response.finalUrl)
          }
        },
        onload(response) {
          // 少数 GM 实现把断网作为 status=0 的完成事件上报，而不是调用 onerror。
          if (response.status === 0) {
            settle(() => reject(createNetworkError(response.status, response.statusText)))
            return
          }
          const body =
            request.responseType === 'bytes'
              ? new Uint8Array(response.response as ArrayBuffer)
              : response.responseText
          // 某些 GM 实现不会稳定触发 progress；完成时再次校验，不能只信任传输事件。
          const responseBytes =
            typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength
          if (request.maxResponseBytes !== undefined && responseBytes > request.maxResponseBytes) {
            settle(() =>
              reject(new GmResponseTooLargeError(request.maxResponseBytes!, response.finalUrl)),
            )
            return
          }
          settle(() =>
            resolve({
              status: response.status,
              statusText: response.statusText,
              headers: response.responseHeaders,
              body,
            }),
          )
        },
        onerror(response) {
          settle(() => reject(createNetworkError(response.status, response.statusText)))
        },
        ontimeout() {
          settle(() => reject(createRequestTimeoutError(request.url)))
        },
        onabort() {
          settle(() => reject(new Error(`Userscript request aborted: ${request.url}`)))
        },
      }
      const requestHandle = GM_xmlhttpRequest(requestDetails)
      // Tampermonkey 在 Chrome 的 fetch 模式会忽略 details.timeout，因此无论底层传输为何都由
      // 适配器维护同一份超时语义，并通过请求 handle 尽早释放网络与回调。
      if (request.timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          settle(() => {
            requestHandle.abort()
            reject(createRequestTimeoutError(request.url))
          })
        }, request.timeoutMs)
      }
      if (request.cancellation) {
        // GM_xmlhttpRequest 的 handle 是唯一能立即停止大媒体传输的边界。
        const cancelRequest = () => {
          // 先占用 settle，再中止传输；同步 onerror 不得把主动取消误报为断网。
          settle(() => {
            requestHandle.abort()
            // 部分脚本管理器不会稳定回调 onabort，因此主动完成 Promise。
            reject(new Error(`Userscript request aborted: ${request.url}`))
          })
        }
        unsubscribeCancellation = request.cancellation.subscribe(cancelRequest)
        if (request.cancellation.isCancelled()) cancelRequest()
      }
    })
  },
}

function noop(): void {}

function createNetworkError(status: number, statusText: string): AppError {
  return new AppError(
    'network-error',
    typeof navigator !== 'undefined' && navigator.onLine === false
      ? '当前设备处于离线状态，请联网后重试。'
      : '无法连接音乐源，请检查网络或代理设置后重试。',
    { cause: new Error(`Userscript request failed: ${status} ${statusText}`) },
  )
}

/** 传输层只给出稳定网络语义，目标地址留在 cause 供当前请求诊断。 */
function createRequestTimeoutError(url: string): AppError {
  return new AppError('request-timeout', '连接音乐源超时，请检查网络或代理设置后重试。', {
    cause: new Error(`Userscript request timed out: ${url}`),
  })
}

function shouldUseFetchTransport(request: HttpRequest): boolean {
  return request.responseType !== 'bytes' && request.maxResponseBytes === undefined
}

function readContentLength(rawHeaders: string | undefined): number | undefined {
  if (!rawHeaders) return undefined
  for (const line of rawHeaders.split(/\r?\n/)) {
    const [name, ...valueParts] = line.split(':')
    if (name?.trim().toLowerCase() !== 'content-length') continue
    const value = Number(valueParts.join(':').trim())
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }
  return undefined
}
