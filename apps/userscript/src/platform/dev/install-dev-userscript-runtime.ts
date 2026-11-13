/**
 * Vite 预览页不经过脚本管理器，因此只在该页面提供最小 GM 兼容运行时。
 * 生产入口不会导入本模块；跨域 Cookie、权限确认和真实下载仍必须在 Tampermonkey 中验收。
 */

interface DevGmResponse {
  finalUrl: string
  loaded: number
  readyState: number
  response: string | ArrayBuffer
  responseHeaders: string
  responseText: string
  status: number
  statusText: string
}

interface DevGmRequestDetails {
  anonymous?: boolean
  data?: BodyInit | null
  headers?: Record<string, string>
  method?: string
  onabort?: (response: DevGmResponse) => void
  onerror?: (response: DevGmResponse) => void
  onload?: (response: DevGmResponse) => void
  onprogress?: (response: DevGmResponse) => void
  onreadystatechange?: (response: DevGmResponse) => void
  ontimeout?: (response: DevGmResponse) => void
  responseType?: 'arraybuffer' | 'text'
  timeout?: number
  url: string
}

interface DevUserscriptWindow extends Window {
  GM_cookie?: {
    list: (
      details: { url?: string },
      callback: (cookies: readonly unknown[], error?: Error) => void,
    ) => void
  }
  GM_getValue?: <T>(key: string, fallback?: T) => T
  GM_setValue?: (key: string, value: unknown) => void
  GM_deleteValue?: (key: string) => void
  GM?: {
    getValue?: <T>(key: string, fallback?: T) => Promise<T | undefined>
    setValue?: (key: string, value: unknown) => Promise<void>
    deleteValue?: (key: string) => Promise<void>
    listValues?: () => Promise<string[]>
    getTab?: () => Promise<Record<string, unknown>>
    saveTab?: (tab: Record<string, unknown>) => Promise<void>
    getTabs?: () => Promise<Record<string, Record<string, unknown>>>
  }
  GM_xmlhttpRequest?: (details: DevGmRequestDetails) => { abort: () => void }
  unsafeWindow?: Window
}

const runtime = window as DevUserscriptWindow
const storagePrefix = 'any-music:dev-preview:gm:'

runtime.unsafeWindow ??= window
runtime.GM_getValue ??= <T>(key: string, fallback?: T): T => {
  try {
    const stored = localStorage.getItem(`${storagePrefix}${key}`)
    return stored === null ? (fallback as T) : (JSON.parse(stored) as T)
  } catch {
    return fallback as T
  }
}
runtime.GM_setValue ??= (key, value) => {
  localStorage.setItem(`${storagePrefix}${key}`, JSON.stringify(value))
}
runtime.GM_deleteValue ??= (key) => localStorage.removeItem(`${storagePrefix}${key}`)
// Preview-only tab inventory. pagehide removes live registrations; abandoned
// registrations fail closed rather than expiring an owner by a timer.
const tabPrefix = `${storagePrefix}tab:`
const tabId = sessionStorage.getItem(`${tabPrefix}id`) ?? crypto.randomUUID()
sessionStorage.setItem(`${tabPrefix}id`, tabId)
const tabKey = `${tabPrefix}${tabId}`
runtime.GM ??= {}
runtime.GM.getValue ??= async <T>(key: string, fallback?: T) => runtime.GM_getValue!(key, fallback)
runtime.GM.setValue ??= async (key, value) => runtime.GM_setValue!(key, value)
runtime.GM.deleteValue ??= async (key) => runtime.GM_deleteValue!(key)
runtime.GM.listValues ??= async () =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith(storagePrefix) && !key.startsWith(tabPrefix))
    .map((key) => key.slice(storagePrefix.length))
runtime.GM.getTab ??= async () => JSON.parse(localStorage.getItem(tabKey) ?? '{}')
runtime.GM.saveTab ??= async (tab) => {
  localStorage.setItem(tabKey, JSON.stringify(tab))
}
runtime.GM.getTabs ??= async () => {
  const tabs: Record<string, Record<string, unknown>> = {}
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!
    if (key.startsWith(tabPrefix)) tabs[key] = JSON.parse(localStorage.getItem(key)!)
  }
  return tabs
}
window.addEventListener('pagehide', () => localStorage.removeItem(tabKey))
runtime.GM_cookie ??= {
  // 浏览器预览不能读取目标站 Cookie；返回空集合可覆盖未登录和恢复动作的 UI。
  list: (_details, callback) => callback([]),
}
runtime.GM_xmlhttpRequest ??= createFetchBackedGmRequest

function createFetchBackedGmRequest(details: DevGmRequestDetails): { abort: () => void } {
  const controller = new AbortController()
  let didAbort = false
  let didTimeout = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const emptyResponse = createResponse(details.url)

  if (details.timeout && details.timeout > 0) {
    timeoutId = setTimeout(() => {
      didTimeout = true
      controller.abort()
    }, details.timeout)
  }

  void fetch(details.url, {
    body: details.data,
    credentials: details.anonymous ? 'omit' : 'include',
    headers: details.headers,
    method: details.method ?? 'GET',
    signal: controller.signal,
  })
    .then(async (response) => {
      const responseHeaders = [...response.headers]
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n')
      const headerResponse = createResponse(response.url || details.url, {
        readyState: 2,
        responseHeaders,
        status: response.status,
        statusText: response.statusText,
      })
      details.onreadystatechange?.(headerResponse)

      const body =
        details.responseType === 'arraybuffer'
          ? await response.arrayBuffer()
          : await response.text()
      const loaded =
        typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength
      const completeResponse = createResponse(response.url || details.url, {
        loaded,
        readyState: 4,
        response: body,
        responseHeaders,
        responseText: typeof body === 'string' ? body : '',
        status: response.status,
        statusText: response.statusText,
      })
      details.onprogress?.(completeResponse)
      details.onload?.(completeResponse)
    })
    .catch(() => {
      if (didTimeout) details.ontimeout?.(emptyResponse)
      else if (didAbort) details.onabort?.(emptyResponse)
      else details.onerror?.(emptyResponse)
    })
    .finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    })

  return {
    abort: () => {
      if (controller.signal.aborted) return
      didAbort = true
      controller.abort()
    },
  }
}

function createResponse(finalUrl: string, overrides: Partial<DevGmResponse> = {}): DevGmResponse {
  return {
    finalUrl,
    loaded: 0,
    readyState: 4,
    response: '',
    responseHeaders: '',
    responseText: '',
    status: 0,
    statusText: '',
    ...overrides,
  }
}
