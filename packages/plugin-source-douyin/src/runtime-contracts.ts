import type { CancellationSignal, HttpResponse } from '@any-music/core'

// Runtime capabilities are injected; this module never reads page or userscript globals.
import type { DouyinCursorAwemeData } from './types'
export type * from './types'

/** Stable import scopes; runtimes construct official URLs and never accept arbitrary URLs. */
export type DouyinBrowserImportTarget =
  | { kind: 'self-history' | 'self-favorites' | 'self-collected-videos' | 'self-collected-mixes' }
  | { kind: 'mix'; mixId: string }

export interface DouyinBrowserImportReader {
  load(cursor: number): Promise<HttpResponse>
  close(): Promise<void>
}

/** Optional account-owned official-page transport. Protocol parsing and mapping stay portable. */
export interface DouyinBrowserCatalog {
  getSelfProfile(): Promise<HttpResponse>
  /** Fresh official detail API or React Flight page; never reuse listing media URLs. */
  getAwemeDetail?(awemeId: string, pageKind: 'video' | 'note'): Promise<HttpResponse>
  openImport?(target: DouyinBrowserImportTarget): DouyinBrowserImportReader
  openSearch(query: string): {
    load(offset: number): Promise<HttpResponse>
    /** Inspect ambiguous empty pages and reconcile authentication in the owning runtime. */
    reportFailure?(
      code: 'not-authenticated' | 'verification-required' | 'pagination-unavailable',
    ): Promise<'not-authenticated' | 'verification-required' | 'pagination-unavailable'>
    close(): Promise<void>
  }
}

export interface DouyinPageSigningRequest {
  url: string
  method: 'GET' | 'POST'
  body?: string
}

export interface DouyinPageSignature {
  msToken: string
  aBogus: string
  timestamp?: string
  webSignature?: string
  webExpire?: string
}

export type DouyinPageSignatureProvider = (
  request: DouyinPageSigningRequest,
) => Promise<DouyinPageSignature | undefined>

export interface DouyinTargetCookieState {
  uifid: string
  verifyFp: string
}

export type DouyinTargetCookieStateProvider = () => Promise<DouyinTargetCookieState>

export type DouyinProtectedAwemeKind =
  | 'self-favorites'
  | 'self-collected-videos'
  | 'self-recommendations'

/**
 * 抖音页面受保护列表的只读数据源。
 *
 * 该契约只暴露已经由抖音页面成功加载的业务响应；实现可以读取当前页，或在 GM 请求
 * 未得到可用响应后打开后台抖音页。请求 Cookie、查询签名和安全头不会进入应用状态。
 */
export interface DouyinProtectedPageSource {
  isCurrentPage(kind: DouyinProtectedAwemeKind): boolean
  getCapturedAwemePage(
    kind: DouyinProtectedAwemeKind,
    cursor: number,
    cancellation?: CancellationSignal,
  ): Promise<DouyinCursorAwemeData | undefined>
}

export interface DouyinWebRequestState {
  userAgent: string
  browserFingerprint: string
  browserLanguage: string
  browserPlatform: string
  browserName: string
  browserVersion: string
  browserOnline: string
  cookieEnabled: string
  engineName: string
  engineVersion: string
  osName: string
  osVersion: string
  cpuCoreCount: string
  deviceMemory: string
  screenWidth: string
  screenHeight: string
  downlink: string
  effectiveType: string
  roundTripTime: string
  supportDash: string
  supportH265: string
  pcLibraDivert: string
  webId: string
  uifid: string
  verifyFp: string
  msToken: string
}

export type DouyinWebRequestStateProvider = () => DouyinWebRequestState
