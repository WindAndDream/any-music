import { AppError } from '@any-music/core'
import type { CancellationSignal } from '@any-music/core'
import type { DouyinCursorAwemeData } from '@any-music/plugin-source-douyin/contracts'
import type {
  DouyinProtectedAwemeKind,
  DouyinProtectedPageSource,
} from '@any-music/plugin-source-douyin/contracts'
export type {
  DouyinProtectedAwemeKind,
  DouyinProtectedPageSource,
} from '@any-music/plugin-source-douyin/contracts'

interface CapturedAwemePage {
  kind: DouyinProtectedAwemeKind
  requestCursor: number
  data: DouyinCursorAwemeData
}

interface PendingCapture {
  kind: DouyinProtectedAwemeKind
  cursor: number
  resolve: (data: DouyinCursorAwemeData | undefined) => void
  timer: ReturnType<typeof setTimeout>
}

interface FetchRequestProjection {
  url: string
  body?: string
}

interface XhrRequestProjection {
  url: string
  body?: string
}

type CaptureSink = (url: string, body: string | undefined, responseText: string) => void

interface PagePatchState {
  sinks: Set<CaptureSink>
}

type PageWindow = Window & typeof globalThis

const PAGE_PATCH_KEY = '__anyMusicDouyinPageCapture__'
const CAPTURE_WAIT_MS = 4_000
const MAX_CAPTURED_PAGES_PER_KIND = 24
const MAX_CAPTURED_RESPONSE_CHARS = 12 * 1024 * 1024

/**
 * 仅在内存中保存当前文档已加载的分页响应，并按请求游标去重。
 * 页面刷新会自然清空缓存，避免把账号私有列表跨会话复用。
 */
export class DouyinPageCaptureStore implements DouyinProtectedPageSource {
  private readonly getPageUrl: () => string
  private readonly pages: CapturedAwemePage[] = []
  private readonly pending = new Set<PendingCapture>()

  constructor(getPageUrl: () => string) {
    this.getPageUrl = getPageUrl
  }

  isCurrentPage(kind: DouyinProtectedAwemeKind): boolean {
    return isMatchingSelfPage(this.getPageUrl(), kind)
  }

  getCapturedAwemePage(
    kind: DouyinProtectedAwemeKind,
    cursor: number,
    cancellation?: CancellationSignal,
  ): Promise<DouyinCursorAwemeData | undefined> {
    if (cancellation?.isCancelled()) return Promise.reject(new AppError('operation-cancelled'))
    const captured = this.findPage(kind, cursor)
    if (captured) return Promise.resolve(captured.data)
    if (!this.isCurrentPage(kind)) return Promise.resolve(undefined)

    let detach: (() => void) | undefined
    const result = new Promise<DouyinCursorAwemeData | undefined>((resolve) => {
      const pending: PendingCapture = {
        kind,
        cursor,
        resolve,
        timer: setTimeout(() => {
          this.pending.delete(pending)
          resolve(undefined)
        }, CAPTURE_WAIT_MS),
      }
      this.pending.add(pending)
      detach = cancellation?.subscribe(() => {
        clearTimeout(pending.timer)
        this.pending.delete(pending)
        resolve(undefined)
      })
    })
    return result
      .then((page) => {
        if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
        return page
      })
      .finally(() => detach?.())
  }

  /** 页面回退任务用同步读取轮询，避免为长游标任务累计多个超时 Promise。 */
  readCapturedAwemePage(
    kind: DouyinProtectedAwemeKind,
    cursor: number,
  ): DouyinCursorAwemeData | undefined {
    return this.findPage(kind, cursor)?.data
  }

  capture(url: string, requestBody: string | undefined, responseText: string): void {
    const page = parseCapturedAwemePage(url, requestBody, responseText)
    if (!page) return

    const existingIndex = this.pages.findIndex(
      (candidate) => candidate.kind === page.kind && candidate.requestCursor === page.requestCursor,
    )
    if (existingIndex >= 0) this.pages.splice(existingIndex, 1, page)
    else this.pages.push(page)

    const sameKind = this.pages.filter((candidate) => candidate.kind === page.kind)
    if (sameKind.length > MAX_CAPTURED_PAGES_PER_KIND) {
      const oldest = sameKind[0]
      if (oldest) this.pages.splice(this.pages.indexOf(oldest), 1)
    }

    for (const pending of this.pending) {
      if (pending.kind !== page.kind || pending.cursor !== page.requestCursor) continue
      clearTimeout(pending.timer)
      this.pending.delete(pending)
      pending.resolve(page.data)
    }
  }

  private findPage(kind: DouyinProtectedAwemeKind, cursor: number): CapturedAwemePage | undefined {
    return this.pages.find(
      (candidate) => candidate.kind === kind && candidate.requestCursor === cursor,
    )
  }
}

/**
 * 先复用当前抖音页内存中的响应，未命中时才启动跨标签页加载。调用方会在 HTTP、
 * 业务码或响应结构任一环节失败后进入这里，由抖音页面自己的运行时完成请求。
 */
export class DouyinFallbackProtectedPageSource implements DouyinProtectedPageSource {
  private readonly localSource: DouyinProtectedPageSource
  private readonly loadInVerificationPage: (
    kind: DouyinProtectedAwemeKind,
    cursor: number,
    cancellation?: CancellationSignal,
  ) => Promise<DouyinCursorAwemeData | undefined>

  constructor(
    localSource: DouyinProtectedPageSource,
    loadInVerificationPage: (
      kind: DouyinProtectedAwemeKind,
      cursor: number,
      cancellation?: CancellationSignal,
    ) => Promise<DouyinCursorAwemeData | undefined>,
  ) {
    this.localSource = localSource
    this.loadInVerificationPage = loadInVerificationPage
  }

  isCurrentPage(kind: DouyinProtectedAwemeKind): boolean {
    return this.localSource.isCurrentPage(kind)
  }

  async getCapturedAwemePage(
    kind: DouyinProtectedAwemeKind,
    cursor: number,
    cancellation?: CancellationSignal,
  ): Promise<DouyinCursorAwemeData | undefined> {
    const localPage = await this.localSource.getCapturedAwemePage(kind, cursor, cancellation)
    if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    return localPage ?? this.loadInVerificationPage(kind, cursor, cancellation)
  }
}

/**
 * 必须在 document-start 调用，先于抖音页面首批 fetch/XHR 安装只读响应监听。
 * 监听器只克隆两个受保护列表的响应体，不修改页面请求和返回值。
 */
export function installDouyinPageCapture(
  targetWindow: PageWindow,
  captureStore: DouyinPageCaptureStore,
): void {
  const pageWindow = targetWindow as PageWindow & {
    [PAGE_PATCH_KEY]?: PagePatchState
  }
  if (!isDouyinHost(pageWindow.location.hostname)) return

  const sink: CaptureSink = (url, body, responseText) =>
    captureStore.capture(url, body, responseText)
  const existing = pageWindow[PAGE_PATCH_KEY]
  if (existing) {
    existing.sinks.add(sink)
    return
  }

  const state: PagePatchState = { sinks: new Set([sink]) }
  Object.defineProperty(pageWindow, PAGE_PATCH_KEY, {
    configurable: false,
    enumerable: false,
    value: state,
  })
  patchFetch(pageWindow, state)
  patchXmlHttpRequest(pageWindow, state)
}

function patchFetch(pageWindow: PageWindow, state: PagePatchState): void {
  const originalFetch = pageWindow.fetch
  pageWindow.fetch = async function patchedDouyinFetch(...args): Promise<Response> {
    // 先放行真实请求，再并行读取 Request clone，不能让监听器改变页面请求时序。
    const requestProjectionPromise = projectFetchRequest(args[0], args[1])
    const response = await originalFetch.apply(this, args)
    const requestProjection = await requestProjectionPromise
    if (requestProjection && isProtectedAwemePath(requestProjection.url)) {
      void readResponseClone(response).then((responseText) => {
        if (responseText === undefined) return
        emitCapture(state, requestProjection.url, requestProjection.body, responseText)
      })
    }
    return response
  }
}

function patchXmlHttpRequest(pageWindow: PageWindow, state: PagePatchState): void {
  const requestByXhr = new WeakMap<XMLHttpRequest, XhrRequestProjection>()
  type XhrOpen = (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) => void
  const originalOpen = pageWindow.XMLHttpRequest.prototype.open as XhrOpen
  const originalSend = pageWindow.XMLHttpRequest.prototype.send

  pageWindow.XMLHttpRequest.prototype.open = function patchedDouyinXhrOpen(
    method: string,
    url: string | URL,
    async = true,
    username?: string | null,
    password?: string | null,
  ): void {
    requestByXhr.set(this, { url: String(url) })
    originalOpen.call(this, method, url, Boolean(async), username, password)
  }

  pageWindow.XMLHttpRequest.prototype.send = function patchedDouyinXhrSend(
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const request = requestByXhr.get(this)
    if (request && isProtectedAwemePath(request.url)) {
      request.body = projectBody(body)
      this.addEventListener(
        'loadend',
        () => {
          const responseText = readXhrText(this)
          if (responseText !== undefined)
            emitCapture(state, request.url, request.body, responseText)
        },
        { once: true },
      )
    }
    originalSend.call(this, body)
  }
}

async function projectFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<FetchRequestProjection | undefined> {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  if (!isProtectedAwemePath(url)) return undefined

  const initBody = projectBody(init?.body)
  if (initBody !== undefined) return { url, body: initBody }
  if (typeof input === 'string' || input instanceof URL) return { url }

  try {
    return { url, body: await input.clone().text() }
  } catch {
    return { url }
  }
}

function projectBody(body: BodyInit | Document | null | undefined): string | undefined {
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return undefined
}

async function readResponseClone(response: Response): Promise<string | undefined> {
  try {
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_CAPTURED_RESPONSE_CHARS)
      return undefined
    const responseText = await response.clone().text()
    return responseText.length <= MAX_CAPTURED_RESPONSE_CHARS ? responseText : undefined
  } catch {
    return undefined
  }
}

function readXhrText(xhr: XMLHttpRequest): string | undefined {
  try {
    if (xhr.responseType !== '' && xhr.responseType !== 'text') return undefined
    return xhr.responseText.length <= MAX_CAPTURED_RESPONSE_CHARS ? xhr.responseText : undefined
  } catch {
    return undefined
  }
}

function emitCapture(
  state: PagePatchState,
  url: string,
  body: string | undefined,
  responseText: string,
): void {
  for (const sink of state.sinks) sink(url, body, responseText)
}

function parseCapturedAwemePage(
  rawUrl: string,
  requestBody: string | undefined,
  responseText: string,
): CapturedAwemePage | undefined {
  let url: URL
  try {
    url = new URL(rawUrl, 'https://www.douyin.com/')
  } catch {
    return undefined
  }

  const kind = kindFromPath(url.pathname)
  if (!kind) return undefined
  const requestCursor = readRequestCursor(kind, url, requestBody)
  if (requestCursor === undefined) return undefined

  try {
    const data = JSON.parse(responseText) as DouyinCursorAwemeData
    const statusCode = Number(data.status_code ?? data.statusCode ?? 0)
    if (!Number.isFinite(statusCode) || statusCode !== 0) return undefined
    if (!Array.isArray(data.aweme_list ?? data.awemeList)) return undefined
    return { kind, requestCursor, data }
  } catch {
    return undefined
  }
}

function readRequestCursor(
  kind: DouyinProtectedAwemeKind,
  url: URL,
  requestBody: string | undefined,
): number | undefined {
  if (kind === 'self-favorites' || kind === 'self-recommendations')
    return readNonNegativeNumber(url.searchParams.get('max_cursor')) ?? 0
  const body = new URLSearchParams(requestBody)
  return (
    readNonNegativeNumber(body.get('cursor')) ??
    readNonNegativeNumber(url.searchParams.get('cursor')) ??
    0
  )
}

function readNonNegativeNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const result = Number(value)
  return Number.isFinite(result) && result >= 0 ? result : undefined
}

function kindFromPath(pathname: string): DouyinProtectedAwemeKind | undefined {
  if (pathname === '/aweme/v1/web/aweme/favorite/') return 'self-favorites'
  if (pathname === '/aweme/v1/web/aweme/listcollection/') return 'self-collected-videos'
  if (pathname === '/aweme/v1/web/familiar/recommend/feed/') return 'self-recommendations'
  return undefined
}

function isProtectedAwemePath(rawUrl: string): boolean {
  try {
    return kindFromPath(new URL(rawUrl, 'https://www.douyin.com/').pathname) !== undefined
  } catch {
    return false
  }
}

function isMatchingSelfPage(rawUrl: string, kind: DouyinProtectedAwemeKind): boolean {
  try {
    const url = new URL(rawUrl)
    if (!isDouyinHost(url.hostname) || url.pathname !== '/user/self') return false
    const showTab = url.searchParams.get('showTab')
    if (kind === 'self-favorites') return showTab === 'like'
    if (kind === 'self-recommendations') return showTab === 'recommend'
    const showSubTab = url.searchParams.get('showSubTab')
    return showTab === 'favorite_collection' && (!showSubTab || showSubTab === 'video')
  } catch {
    return false
  }
}

function isDouyinHost(hostname: string): boolean {
  return hostname === 'douyin.com' || hostname.endsWith('.douyin.com')
}
