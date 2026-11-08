/** core 当前允许平台适配器实现的 HTTP 方法集合。 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** 平台无关的取消契约；浏览器适配器可由 AbortSignal 映射，core 不依赖 DOM 类型。 */
export interface CancellationSignal {
  isCancelled(): boolean
  subscribe(listener: () => void): () => void
}

/** 与具体网络库无关的请求描述。 */
export interface HttpRequest {
  url: string
  method?: HttpMethod
  headers?: Record<string, string>
  body?: string
  /** 自定义插件默认 omit，站点自身接口可以显式 include。 */
  credentials?: 'omit' | 'same-origin' | 'include'
  responseType?: 'text' | 'bytes'
  /** 完整二进制读取可声明硬上限；平台适配器应在进度阶段尽早中止。 */
  maxResponseBytes?: number
  /** 超时时间，单位为毫秒；省略时采用平台默认值。 */
  timeoutMs?: number
  /** 取消后平台适配器应尽快中止底层传输并拒绝请求。 */
  cancellation?: CancellationSignal
}

/** 供领域服务消费的最小文本响应，避免泄漏平台专属对象。 */
export interface HttpResponse {
  status: number
  statusText: string
  /** 保留平台返回的原始响应头文本。 */
  headers: string
  body: string | Uint8Array
}

/** 由 Userscript、Tauri 等运行端分别实现的 HTTP 端口。 */
export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>
}
