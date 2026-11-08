import { AppError, MusicSourceError } from '@any-music/core'
import type { CancellationSignal, HttpClient, HttpResponse } from '@any-music/core'

import { createDouyinABogus } from './a-bogus'
import type { DouyinPageSignatureProvider } from './runtime-contracts'
import type { DouyinWebRequestState, DouyinWebRequestStateProvider } from './runtime-contracts'
import type { DouyinTargetCookieStateProvider } from './runtime-contracts'
import type { DouyinBrowserCatalog } from './runtime-contracts'
import type { DouyinBrowserImportTarget } from './runtime-contracts'
import { hasPlayableDouyinAwemeMedia } from './track-mappers'
import type {
  DouyinAweme,
  DouyinCollectedAwemeData,
  DouyinCollectedMusicData,
  DouyinCollectsListData,
  DouyinCursorAwemeData,
  DouyinDetailData,
  DouyinMixListData,
  DouyinMusic,
  DouyinMusicDetailData,
  DouyinProfileData,
  DouyinSearchData,
} from './types'

const API_ROOT = 'https://www.douyin.com'
const HJ_API_ROOT = 'https://www-hj.douyin.com'
const SHARE_ROOT = 'https://www.iesdouyin.com'
const REQUEST_TIMEOUT_MS = 20_000
const MAX_JSON_BYTES = 12 * 1024 * 1024
const MAX_PAGE_BYTES = 8 * 1024 * 1024

const SHARE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

type QueryValue = string | number | boolean | undefined

/** Portable Douyin protocol. The host supplies transport, device state and optional page capabilities. */
export class DouyinApi {
  private readonly cancellation?: CancellationSignal
  private readonly httpClient: HttpClient
  private readonly getRequestState: DouyinWebRequestStateProvider
  private readonly getPageSignature?: DouyinPageSignatureProvider
  private readonly getTargetCookieState?: DouyinTargetCookieStateProvider
  private readonly browserCatalog?: DouyinBrowserCatalog

  constructor(
    httpClient: HttpClient,
    getRequestState: DouyinWebRequestStateProvider,
    getPageSignature?: DouyinPageSignatureProvider,
    getTargetCookieState?: DouyinTargetCookieStateProvider,
    browserCatalog?: DouyinBrowserCatalog,
    cancellation?: CancellationSignal,
  ) {
    this.httpClient = httpClient
    this.cancellation = cancellation
    this.getRequestState = getRequestState
    this.getPageSignature = getPageSignature
    this.getTargetCookieState = getTargetCookieState
    this.browserCatalog = browserCatalog
  }

  /** The operation-scoped API keeps concurrent lists from changing each other's signal. */
  withCancellation(cancellation?: CancellationSignal): DouyinApi {
    return cancellation
      ? new DouyinApi(
          this.httpClient,
          this.getRequestState,
          this.getPageSignature,
          this.getTargetCookieState,
          this.browserCatalog,
          cancellation,
        )
      : this
  }

  assertActive(): void {
    if (this.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
  }

  getSelfProfile(): Promise<DouyinProfileData> {
    if (this.browserCatalog)
      return this.browserCatalog
        .getSelfProfile()
        .then((response) => parseDouyinApiResponse(response) as DouyinProfileData)
    return this.getJson('/aweme/v1/web/user/profile/self/')
  }

  /** Browser rejections retain their recovery action; never replay them through local signing. */
  get hasBrowserImport(): boolean {
    return Boolean(this.browserCatalog?.openImport)
  }

  openImport(target: DouyinBrowserImportTarget) {
    const reader = this.browserCatalog?.openImport?.(target)
    if (!reader) return undefined
    return {
      load: async (cursor: number) => parseDouyinApiResponse(await reader.load(cursor)),
      close: () => reader.close(),
    }
  }

  /** One reader per iterator keeps browser targets isolated even for identical keywords. */
  openSearch(keyword: string, count: number) {
    const source = this.browserCatalog?.openSearch(keyword)
    return {
      load: async (offset: number): Promise<DouyinSearchData> => {
        let data: DouyinSearchData
        try {
          data = source
            ? (parseDouyinApiResponse(await source.load(offset)) as DouyinSearchData)
            : await this.searchAwemes(keyword, offset, count)
          if (
            (data.search_nil_info?.search_nil_type ?? data.searchNilInfo?.searchNilType) ===
            'verify_check'
          )
            throw new MusicSourceError(
              'verification-required',
              '抖音搜索需要完成安全验证；请打开对应搜索页完成验证后重试。',
            )
        } catch (error) {
          if (
            source?.reportFailure &&
            error instanceof MusicSourceError &&
            (error.code === 'not-authenticated' || error.code === 'verification-required')
          ) {
            let code: 'not-authenticated' | 'verification-required'
            try {
              const reported = await source.reportFailure(error.code)
              code = reported === 'pagination-unavailable' ? error.code : reported
            } catch (cause) {
              if (cause instanceof AppError && cause.code === 'operation-cancelled') throw cause
              // A failed status update cannot hide the original recovery action.
              throw new MusicSourceError(error.code, error.message, { cause })
            }
            if (code !== error.code)
              throw new MusicSourceError(code, '抖音账号需要验证，请完成官方验证后重试搜索。', {
                cause: error,
              })
          }
          throw error
        }
        if (source?.reportFailure && Array.isArray(data.data) && !data.data.length) {
          // A challenge can arrive without a marker in the response. Inspect
          // the still-owned official page, including on the first page, before
          // the consumer closes its target and caches a successful empty result.
          let code: 'not-authenticated' | 'verification-required' | 'pagination-unavailable'
          try {
            code = await source.reportFailure('pagination-unavailable')
          } catch (cause) {
            if (cause instanceof AppError && cause.code === 'operation-cancelled') throw cause
            // An unavailable diagnostic cannot turn exhaustion into an auth failure.
            return data
          }
          if (code !== 'pagination-unavailable')
            throw new MusicSourceError(
              code,
              code === 'verification-required'
                ? '抖音搜索需要完成安全验证，请点击验证后重试。'
                : '抖音登录已失效，请重新登录后重试。',
            )
        }
        return data
      },
      close: () => source?.close() ?? Promise.resolve(),
    }
  }

  getUserProfile(secUid: string): Promise<DouyinProfileData> {
    return this.getJson('/aweme/v1/web/user/profile/other/', { sec_user_id: secUid })
  }

  searchAwemes(keyword: string, offset: number, count: number): Promise<DouyinSearchData> {
    return this.getJson('/aweme/v1/web/general/search/stream/', {
      search_channel: 'aweme_general',
      enable_history: 1,
      keyword,
      search_source: 'normal_search',
      query_correct_type: 1,
      is_filter_search: 0,
      from_group_id: '',
      disable_rs: 0,
      offset,
      count,
      need_filter_settings: 1,
      // 浏览器当前的 stream 接口使用 single；multi 会返回混合卡片并增加映射歧义。
      list_type: 'single',
      pc_search_top_1_params: '{"enable_ai_search_top_1":1}',
    })
  }

  getUserPosts(secUid: string, maxCursor: number, count: number): Promise<DouyinCursorAwemeData> {
    return this.getJson('/aweme/v1/web/aweme/post/', {
      sec_user_id: secUid,
      max_cursor: maxCursor,
      count,
    })
  }

  getUserFavorites(
    secUid: string,
    maxCursor: number,
    count: number,
  ): Promise<DouyinCursorAwemeData> {
    return this.getJson(
      '/aweme/v1/web/aweme/favorite/',
      {
        sec_user_id: secUid,
        max_cursor: maxCursor,
        min_cursor: 0,
        whale_cut_token: '',
        cut_version: 1,
        count,
      },
      HJ_API_ROOT,
    )
  }

  getSelfRecommendations(
    secUid: string,
    maxCursor: number,
    count: number,
  ): Promise<DouyinCursorAwemeData> {
    return this.getJson('/aweme/v1/web/familiar/recommend/feed/', {
      sec_user_id: secUid,
      max_cursor: maxCursor,
      min_cursor: 0,
      whale_cut_token: '',
      count,
      from: 1,
    })
  }

  /** Watch history is account-private and paginates with descending timestamp cursors. */
  getSelfHistory(maxCursor: number, count: number): Promise<DouyinCursorAwemeData> {
    return this.getJson(
      '/aweme/v1/web/history/read/',
      { max_cursor: maxCursor, count },
      HJ_API_ROOT,
    )
  }

  getMixAwemes(mixId: string, cursor: number, count: number): Promise<DouyinCursorAwemeData> {
    return this.getJson('/aweme/v1/web/mix/aweme/', { mix_id: mixId, cursor, count })
  }

  getUserMixes(secUid: string, cursor: number, count: number): Promise<DouyinMixListData> {
    return this.getJson(
      '/aweme/v1/web/mix/list/',
      {
        sec_user_id: secUid,
        req_from: 'channel_pc_web',
        cursor,
        count,
        list_scene: 3,
      },
      HJ_API_ROOT,
    )
  }

  /** “喜欢”是公开用户维度列表；“收藏视频”是仅当前登录账号可见的独立 POST 接口。 */
  getCollectedAwemes(cursor: number, count: number): Promise<DouyinCollectedAwemeData> {
    return this.postFormJson(
      '/aweme/v1/web/aweme/listcollection/',
      {},
      { count, cursor },
      // 2026-08-30 复测首屏与翻页都由 www-hj 承载。
      HJ_API_ROOT,
    )
  }

  getCollectedMixes(cursor: number, count: number): Promise<DouyinMixListData> {
    return this.getJson('/aweme/v1/web/mix/listcollection/', { cursor, count }, HJ_API_ROOT)
  }

  getCollectedMusic(cursor: number, count: number): Promise<DouyinCollectedMusicData> {
    return this.getJson('/aweme/v1/web/music/listcollection/', { cursor, count }, HJ_API_ROOT)
  }

  getCollectFolders(cursor: number, count: number): Promise<DouyinCollectsListData> {
    return this.getJson('/aweme/v1/web/collects/list/', { cursor, count }, HJ_API_ROOT)
  }

  getCollectFolderAwemes(
    collectsId: string,
    cursor: number,
    count: number,
  ): Promise<DouyinCursorAwemeData> {
    return this.getJson(
      '/aweme/v1/web/collects/video/list/',
      { collects_id: collectsId, cursor, count },
      HJ_API_ROOT,
    )
  }

  async getMusicDetail(musicId: string): Promise<DouyinMusic> {
    const data = await this.getJson<DouyinMusicDetailData>('/aweme/v1/web/music/detail/', {
      music_id: musicId,
    })
    const music = data.music_info ?? data.musicInfo
    if (!music) throw new MusicSourceError('not-found', '抖音音乐不存在、不可见或已失效。')
    return music
  }

  get hasBrowserAwemeDetail(): boolean {
    return Boolean(this.browserCatalog?.getAwemeDetail)
  }

  async getAwemeDetail(
    awemeId: string,
    pageKind: 'video' | 'note' = 'video',
  ): Promise<DouyinAweme> {
    let data: DouyinDetailData
    if (this.browserCatalog?.getAwemeDetail) {
      const response = await this.browserCatalog.getAwemeDetail(awemeId, pageKind)
      const text =
        typeof response.body === 'string' ? response.body : new TextDecoder().decode(response.body)
      if (text.trimStart().startsWith('<')) {
        assertDouyinHttpSuccess(response.status)
        const aweme = parseFlightAweme(text, awemeId)
        if (!aweme || !hasPlayableDouyinAwemeMedia(aweme))
          throw new MusicSourceError('not-found', '抖音官方详情页未返回该作品的可播放媒体。')
        return aweme
      }
      data = parseDouyinApiResponse(response) as DouyinDetailData
    } else {
      data = await this.getJson<DouyinDetailData>('/aweme/v1/web/aweme/detail/', {
        aweme_id: awemeId,
        request_source: 600,
        origin_type: 'quick_player',
      })
    }
    const aweme = data.aweme_detail ?? data.awemeDetail
    if (!aweme) throw new MusicSourceError('not-found', '抖音作品不存在、不可见或已失效。')
    if ((aweme.aweme_id ?? aweme.awemeId) !== awemeId)
      throw new MusicSourceError('invalid-response', '抖音作品详情与请求标识不一致。')
    return aweme
  }

  /**
   * 签名详情偶发空结果时使用公开详情页；HTML 仅作同站回退，不缓存其中的短时媒体 URL。
   */
  async getAwemeFromPage(
    awemeId: string,
    pageKind: 'video' | 'note' = 'video',
  ): Promise<DouyinAweme> {
    const pageKinds =
      pageKind === 'video' ? (['video', 'note'] as const) : (['note', 'video'] as const)
    for (const candidateKind of pageKinds) {
      try {
        // 搜索 modal URL 不暴露作品类型，因此主路径失败时交换 video/note 再试一次。
        // oxlint-disable-next-line no-await-in-loop
        const pageHtml = await this.requestText(`${API_ROOT}/${candidateKind}/${awemeId}`, {
          'User-Agent': this.getRequestState().userAgent,
          Referer: `${API_ROOT}/`,
        })
        const flightAweme = parseFlightAweme(pageHtml, awemeId)
        // React Flight 常先出现只有卡片元数据的同 ID 对象；它不能提前截断后续分享页回退。
        if (flightAweme && hasPlayableDouyinAwemeMedia(flightAweme)) return flightAweme
      } catch (error) {
        if (error instanceof AppError && error.code === 'operation-cancelled') throw error
        // 公开页面是详情 API 的尽力回退；单一路径 404 不应阻止尝试另一种作品形态。
      }
    }

    try {
      const shareHtml = await this.requestText(`${SHARE_ROOT}/share/video/${awemeId}/`, {
        'User-Agent': SHARE_USER_AGENT,
        Referer: `${SHARE_ROOT}/`,
      })
      const shareAweme = parseRouterAweme(shareHtml, awemeId)
      if (shareAweme && hasPlayableDouyinAwemeMedia(shareAweme)) return shareAweme
    } catch (error) {
      if (error instanceof AppError && error.code === 'operation-cancelled') throw error
      // 移动分享页并非所有图文/地区都可用，失败后统一报告详情缺失。
    }

    throw new MusicSourceError('not-found', '抖音详情接口和公开页面均未返回该作品。')
  }

  private async getJson<T>(
    path: string,
    endpointParams: Readonly<Record<string, QueryValue>> = {},
    root = API_ROOT,
  ): Promise<T> {
    const requestState = await this.getCurrentRequestState()
    const signedRequest = await createSignedParams(
      path,
      endpointParams,
      'GET',
      requestState,
      `${root}${path}`,
      this.getPageSignature,
    )

    const response = await this.request(
      `${root}${path}?${signedRequest.params.toString()}`,
      MAX_JSON_BYTES,
      {
        Accept: 'application/json, text/plain, */*',
        Referer: `${API_ROOT}/`,
        'User-Agent': requestState.userAgent,
        ...(requestState.uifid ? { UIFID: requestState.uifid } : {}),
        ...signedRequest.headers,
      },
      'bytes',
    )
    const body = parseDouyinApiResponse(response)
    return body as T
  }

  private async postFormJson<T>(
    path: string,
    endpointParams: Readonly<Record<string, QueryValue>>,
    form: Readonly<Record<string, QueryValue>>,
    root = API_ROOT,
  ): Promise<T> {
    const formBody = new URLSearchParams()
    for (const [key, value] of Object.entries(form)) {
      if (value !== undefined) formBody.set(key, String(value))
    }
    const requestState = await this.getCurrentRequestState()
    const signedRequest = await createSignedParams(
      path,
      endpointParams,
      'POST',
      requestState,
      `${root}${path}`,
      this.getPageSignature,
      formBody.toString(),
    )
    const response = await this.request(
      `${root}${path}?${signedRequest.params.toString()}`,
      MAX_JSON_BYTES,
      {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: API_ROOT,
        Referer: `${API_ROOT}/user/self?showTab=favorite_collection`,
        'User-Agent': requestState.userAgent,
        ...(requestState.uifid ? { UIFID: requestState.uifid } : {}),
        ...signedRequest.headers,
      },
      'bytes',
      'POST',
      formBody.toString(),
    )
    const body = parseDouyinApiResponse(response)
    return body as T
  }

  /** 目标域 Cookie 只覆盖跨站页面读不到的同站字段，不改写真实浏览器设备快照。 */
  private async getCurrentRequestState(): Promise<DouyinWebRequestState> {
    const requestState = this.getRequestState()
    const targetCookies = await this.getTargetCookieState?.()
    if (!targetCookies) return requestState
    return {
      ...requestState,
      uifid: targetCookies.uifid || requestState.uifid,
      verifyFp: targetCookies.verifyFp || requestState.verifyFp,
    }
  }

  private async requestText(url: string, headers: Record<string, string>): Promise<string> {
    const response = await this.request(url, MAX_PAGE_BYTES, headers)
    assertDouyinHttpSuccess(response.status)
    if (typeof response.body !== 'string') {
      throw new MusicSourceError('invalid-response', '抖音页面意外返回了二进制数据。')
    }
    return response.body
  }

  private async request(
    url: string,
    maxResponseBytes: number,
    headers: Record<string, string>,
    responseType: 'text' | 'bytes' = 'text',
    method: 'GET' | 'POST' = 'GET',
    body?: string,
  ): Promise<HttpResponse> {
    let response
    try {
      // 无论脚本当前挂在哪个网站，内置抖音源都显式携带 douyin.com 登录态。
      if (this.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
      response = await this.httpClient.request({
        cancellation: this.cancellation,
        url,
        method,
        body,
        headers,
        credentials: 'include',
        responseType,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxResponseBytes,
      })
    } catch (error) {
      // GM 已区分断网和超时；平台层不可把它们重新包装成业务上游异常。
      if (
        error instanceof AppError &&
        (error.code === 'network-error' ||
          error.code === 'request-timeout' ||
          error.code === 'operation-cancelled')
      ) {
        throw error
      }
      throw new MusicSourceError('upstream-error', '无法连接抖音，请稍后重试。', { cause: error })
    }

    this.assertActive()
    return response
  }
}

function createBaseParams(
  path: string,
  endpointParams: Readonly<Record<string, QueryValue>>,
  state: DouyinWebRequestState,
): URLSearchParams {
  if (path === '/aweme/v1/web/general/search/stream/') {
    return createSearchParams(endpointParams, state)
  }

  const params = new URLSearchParams([
    ['device_platform', 'webapp'],
    ['aid', '6383'],
    ['channel', 'channel_pc_web'],
  ])
  // 业务参数位于稳定应用标识与设备参数之间；a_bogus 对最终顺序敏感。
  for (const [key, value] of Object.entries(endpointParams)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const profile = getRequestProfile(path)
  const applicationParams: ReadonlyArray<readonly [string, string]> = [
    ...(profile === 'favorite' || profile === 'collection'
      ? ([['publish_video_strategy_type', '2']] as const)
      : []),
    // 收藏视频的当前网页管线先附加两个 PC 字段；其余 17.4 管线先附加更新版本。
    ...(profile === 'collection'
      ? ([
          ['pc_client_type', '1'],
          ['pc_libra_divert', state.pcLibraDivert],
          ['update_version_code', '170400'],
        ] as const)
      : ([
          ['update_version_code', '170400'],
          ['pc_client_type', '1'],
          ['pc_libra_divert', state.pcLibraDivert],
        ] as const)),
    ['support_h265', state.supportH265],
    ['support_dash', state.supportDash],
    ...(profile === 'detail'
      ? ([
          ['webcast_sdk_version', '170400'],
          ['webcast_version_code', '170400'],
        ] as const)
      : []),
    ...(profile === 'collection' ? [] : ([['cpu_core_num', state.cpuCoreCount]] as const)),
    ['version_code', '170400'],
    ['version_name', '17.4.0'],
    ['cookie_enabled', state.cookieEnabled],
    ['screen_width', state.screenWidth],
    ['screen_height', state.screenHeight],
    ['browser_language', state.browserLanguage],
    ['browser_platform', state.browserPlatform],
    ['browser_name', state.browserName],
    ['browser_version', state.browserVersion],
    ['browser_online', state.browserOnline],
    ['engine_name', state.engineName],
    ['engine_version', state.engineVersion],
    ['os_name', state.osName],
    ['os_version', state.osVersion],
    ...(profile === 'collection' ? ([['cpu_core_num', state.cpuCoreCount]] as const) : []),
    ['device_memory', state.deviceMemory],
    ['platform', 'PC'],
    ['downlink', state.downlink],
    ['effective_type', state.effectiveType],
    ['round_trip_time', state.roundTripTime],
    ['webid', state.webId],
    ['uifid', state.uifid],
  ]
  for (const [key, value] of applicationParams) {
    params.set(key, value)
  }
  return params
}

function createSearchParams(
  endpointParams: Readonly<Record<string, QueryValue>>,
  state: DouyinWebRequestState,
): URLSearchParams {
  const values: Record<string, QueryValue> = {
    aid: 6383,
    browser_language: state.browserLanguage,
    browser_name: state.browserName,
    browser_online: state.browserOnline,
    browser_platform: state.browserPlatform,
    browser_version: state.browserVersion,
    channel: 'channel_pc_web',
    cookie_enabled: state.cookieEnabled,
    cpu_core_num: state.cpuCoreCount,
    device_memory: state.deviceMemory,
    device_platform: 'webapp',
    downlink: state.downlink,
    effective_type: state.effectiveType,
    engine_name: state.engineName,
    engine_version: state.engineVersion,
    os_name: state.osName,
    os_version: state.osVersion,
    pc_client_type: 1,
    pc_libra_divert: state.pcLibraDivert,
    platform: 'PC',
    round_trip_time: state.roundTripTime,
    screen_height: state.screenHeight,
    screen_width: state.screenWidth,
    support_dash: state.supportDash,
    support_h265: state.supportH265,
    uifid: state.uifid,
    update_version_code: 0,
    version_code: 190600,
    version_name: '19.6.0',
    webid: state.webId,
    ...endpointParams,
  }
  const params = new URLSearchParams()
  // 2026-08-30 实测 search/stream 在签名前会按键名字典序重建查询串。
  for (const key of Object.keys(values).toSorted()) {
    const value = values[key]
    if (value !== undefined) params.set(key, String(value))
  }
  return params
}

type DouyinRequestProfile = 'standard' | 'search' | 'detail' | 'favorite' | 'collection'

interface DouyinSignedRequest {
  params: URLSearchParams
  headers: Record<string, string>
}

function getRequestProfile(path: string): DouyinRequestProfile {
  if (path === '/aweme/v1/web/general/search/stream/') return 'search'
  if (path === '/aweme/v1/web/aweme/detail/') return 'detail'
  if (path === '/aweme/v1/web/aweme/favorite/') return 'favorite'
  if (path === '/aweme/v1/web/aweme/listcollection/') return 'collection'
  return 'standard'
}

async function createSignedParams(
  path: string,
  endpointParams: Readonly<Record<string, QueryValue>>,
  method: 'GET' | 'POST',
  state: DouyinWebRequestState,
  absolutePath: string,
  getPageSignature?: DouyinPageSignatureProvider,
  body?: string,
): Promise<DouyinSignedRequest> {
  const params = createBaseParams(path, endpointParams, state)
  const profile = getRequestProfile(path)
  if (profile !== 'search') {
    // 登录态列表和个人资料把 verifyFp/fp 纳入 a_bogus 覆盖的最终查询前缀。
    params.set('verifyFp', state.verifyFp)
    params.set('fp', state.verifyFp)
  }
  const pageSignature = await getPageSignature?.({
    url: `${absolutePath}?${params.toString()}`,
    method,
    body,
  })
  // 优先使用同站或跨站沙箱 BDMS；SDK 超时才退回纯 TypeScript 尽力签名。
  params.set('msToken', pageSignature?.msToken || state.msToken)
  params.set(
    'a_bogus',
    pageSignature?.aBogus ||
      createDouyinABogus(params.toString(), method, {
        userAgent: state.userAgent,
        browserFingerprint: state.browserFingerprint,
      }),
  )
  if (profile === 'search') {
    // 搜索流与 17.4 个人列表的安全字段顺序不同；顺序本身属于签名契约。
    params.set('verifyFp', state.verifyFp)
    params.set('fp', state.verifyFp)
  }
  if (usesWebSecuritySignature(profile)) {
    params.set('timestamp', pageSignature?.timestamp ?? '')
    params.set('x-secsdk-web-signature', pageSignature?.webSignature ?? '')
  }
  return {
    params,
    headers: usesWebSecuritySignature(profile)
      ? {
          ...(pageSignature?.webSignature
            ? { 'x-secsdk-web-signature': pageSignature.webSignature }
            : {}),
          ...(pageSignature?.webExpire ? { 'x-secsdk-web-expire': pageSignature.webExpire } : {}),
        }
      : {},
  }
}

/** 详情与账号受保护接口都经过当前网页 Web SecSDK；普通公开列表仍只使用 BDMS。 */
function usesWebSecuritySignature(profile: DouyinRequestProfile): boolean {
  return profile === 'detail' || profile === 'favorite' || profile === 'collection'
}

/** 解析普通 JSON，或合并抖音 search stream 中按十六进制长度封装的多个 JSON 消息。 */
export function parseDouyinJsonBody(body: string | Uint8Array): Record<string, unknown> {
  const input = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const firstContentByte = input.find((byte) => !isAsciiWhitespace(byte))
  if (firstContentByte === 123) return parseJsonDocument(new TextDecoder().decode(input).trim())

  const frames = decodeChunkFrames(input)
  const combined = joinUtf8Chunks(
    frames,
    frames.reduce((sum, frame) => sum + frame.length, 0),
  )
  try {
    // 兼容标准 HTTP chunked 语义：一个 JSON 文档可能被任意切成多帧。
    return JSON.parse(combined) as Record<string, unknown>
  } catch (error) {
    if (error instanceof AppError && error.code === 'operation-cancelled') throw error
    // 当前 search stream 也会把每批结果和 {"ack":-1} 分别放在独立帧中。
    // 这些帧不能直接字符串拼接，必须逐帧解析后合并 data。
    const documents = frames.map((frame) => parseJsonDocument(new TextDecoder().decode(frame)))
    return mergeFramedJsonDocuments(documents)
  }
}

function decodeChunkFrames(input: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = []
  let offset = 0

  while (offset < input.length) {
    const lineEnd = findCrlf(input, offset)
    if (lineEnd < 0) break
    const sizeLine = new TextDecoder().decode(input.subarray(offset, lineEnd)).split(';')[0]?.trim()
    if (!sizeLine || !/^[\dA-Fa-f]+$/.test(sizeLine)) break
    const size = Number.parseInt(sizeLine, 16)
    if (!Number.isFinite(size) || size < 0) break
    offset = lineEnd + 2
    if (size === 0) return chunks
    if (offset + size > input.length) break

    const chunk = input.slice(offset, offset + size)
    chunks.push(chunk)
    offset += size
    if (input[offset] === 13 && input[offset + 1] === 10) offset += 2
  }

  throw new MusicSourceError('invalid-response', '抖音返回了不完整的流式数据。')
}

function parseJsonDocument(document: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(document) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new TypeError('Expected a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new MusicSourceError('invalid-response', '抖音返回了无法解析的数据。', {
      cause: error,
    })
  }
}

function mergeFramedJsonDocuments(
  documents: readonly Record<string, unknown>[],
): Record<string, unknown> {
  // 业务错误帧必须优先返回给 assertDouyinSuccess，不能被后续 ack 或成功帧覆盖。
  const errorDocument = documents.find((document) => {
    const code = numberValue(document.status_code ?? document.statusCode)
    return code !== undefined && code !== 0
  })
  if (errorDocument) return errorDocument

  const payloadDocuments = documents.filter(
    (document) =>
      document.status_code !== undefined ||
      document.statusCode !== undefined ||
      Array.isArray(document.data),
  )
  if (payloadDocuments.length === 0) {
    throw new MusicSourceError('invalid-response', '抖音搜索流未返回结果数据。')
  }

  const mergedData = payloadDocuments.flatMap((document) =>
    Array.isArray(document.data) ? document.data : [],
  )
  // 每帧可能只补充部分元数据；保留已出现的游标/分页标记，后续显式值（包括 0）仍覆盖前值。
  // 只取最后一帧会把缺字段误当成 has_more=false，导致首屏曲目后静默停止分页。
  const metadata: Record<string, unknown> = {}
  for (const document of payloadDocuments) Object.assign(metadata, document)
  // 只有真实结果帧才能提供 data；元数据/ack 不能凭空制造一个“成功空列表”。
  return payloadDocuments.some((document) => Array.isArray(document.data))
    ? { ...metadata, data: mergedData }
    : metadata
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 9 || byte === 10 || byte === 13 || byte === 32
}

function findCrlf(input: Uint8Array, start: number): number {
  for (let index = start; index + 1 < input.length; index += 1) {
    if (input[index] === 13 && input[index + 1] === 10) return index
  }
  return -1
}

function joinUtf8Chunks(chunks: readonly Uint8Array[], totalLength: number): string {
  const joined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(joined)
}

/** 精确标识业务码 2483，让 UI 提供由用户决定是否打开的人工验证入口。 */
export class DouyinRiskControlError extends MusicSourceError {
  readonly douyinStatusCode = 2_483

  constructor() {
    super('verification-required', '抖音要求完成安全验证；你可以前往对应抖音页面完成验证后重试。')
    this.name = 'DouyinRiskControlError'
  }
}

/** HTTP 状态只留在抖音适配器的 cause 中，供详情回退区分传输拒绝与业务权限拒绝。 */
class DouyinHttpResponseError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Douyin HTTP ${status}`)
    this.name = 'DouyinHttpResponseError'
    this.status = status
  }
}

/** 判断 MusicSourceError 是否由指定的抖音 HTTP 状态触发，不向通用错误状态泄漏平台细节。 */
export function isDouyinHttpStatusError(error: unknown, status: number): boolean {
  return (
    error instanceof MusicSourceError &&
    error.cause instanceof DouyinHttpResponseError &&
    error.cause.status === status
  )
}

/** An official search response, rather than disappearance of a captcha, confirms verification. */
export function isDouyinSearchVerificationComplete(response: HttpResponse): boolean {
  try {
    const data = parseDouyinApiResponse(response)
    const nil = (data.search_nil_info ?? data.searchNilInfo) as
      | { search_nil_type?: string; searchNilType?: string }
      | undefined
    return (
      numberValue(data.status_code ?? data.statusCode) === 0 &&
      Array.isArray(data.data) &&
      (data.data.length > 0 ||
        ((data.has_more === 0 ||
          data.has_more === false ||
          data.hasMore === 0 ||
          data.hasMore === false) &&
          (data.result_status === undefined || data.result_status === 0))) &&
      (nil?.search_nil_type ?? nil?.searchNilType) !== 'verify_check'
    )
  } catch (error) {
    if (error instanceof AppError && error.code === 'operation-cancelled') throw error
    return false
  }
}

function parseDouyinApiResponse(response: HttpResponse): Record<string, unknown> {
  let body: Record<string, unknown>
  try {
    body = parseDouyinJsonBody(response.body)
  } catch (error) {
    // 非 JSON 拒绝页按 HTTP 类型报告；受保护列表调用方会对任一不可用结果统一回退。
    if (response.status < 200 || response.status >= 300) {
      assertDouyinHttpSuccess(response.status)
    }
    throw error
  }

  assertDouyinSuccess(body)
  assertDouyinHttpSuccess(response.status)
  return body
}

function assertDouyinHttpSuccess(status: number): void {
  if (status >= 200 && status < 300) return
  const options: ErrorOptions = { cause: new DouyinHttpResponseError(status) }
  if (status === 401) {
    throw new MusicSourceError('not-authenticated', '抖音登录已失效，请重新登录后重试。', options)
  }
  if (status === 403) {
    throw new MusicSourceError('access-denied', '抖音拒绝了该请求，请确认内容权限。', options)
  }
  if (status === 404) {
    throw new MusicSourceError('not-found', '抖音内容不存在或已失效。', options)
  }
  if (status === 429) {
    throw new MusicSourceError('rate-limited', '抖音请求过于频繁，请稍后重试。', options)
  }
  throw new MusicSourceError('upstream-error', `抖音接口返回 HTTP ${status}。`, options)
}

function assertDouyinSuccess(body: Record<string, unknown>): void {
  const code = numberValue(body.status_code ?? body.statusCode)
  const nested = body.data as { verify_url?: unknown } | undefined
  if (code === 2_483) throw new DouyinRiskControlError()
  if (
    [body.verify_url, nested?.verify_url].some(
      (value) => typeof value === 'string' && value.length > 0,
    )
  )
    throw new MusicSourceError('verification-required', '抖音要求完成安全验证，请验证后重试。')
  if (code === undefined || code === 0) return
  const message = String(body.status_msg ?? body.statusMsg ?? '')
  if (code === 8 || code === 9 || code === 10_002) {
    throw new MusicSourceError('not-authenticated', '抖音登录已失效，请重新登录后重试。')
  }
  if (code === 2_198 || code === 2_205) {
    throw new MusicSourceError('access-denied', message || '该抖音内容不可见或无权访问。')
  }
  throw new MusicSourceError('upstream-error', message || `抖音接口错误（${code}）。`)
}

function numberValue(value: unknown): number | undefined {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : undefined
}

function parseFlightAweme(html: string, awemeId: string): DouyinAweme | undefined {
  const marker = 'self.__pace_f.push('
  let offset = 0
  while (offset < html.length) {
    const start = html.indexOf(marker, offset)
    if (start < 0) return undefined
    const scriptEnd = html.indexOf('</script>', start)
    if (scriptEnd < 0) return undefined
    const expression = html
      .slice(start + marker.length, scriptEnd)
      .trim()
      .replace(/\);?$/, '')
    offset = scriptEnd + 9
    if (!expression.includes(awemeId)) continue

    try {
      const tuple = JSON.parse(expression) as unknown
      if (!Array.isArray(tuple) || typeof tuple[1] !== 'string') continue
      for (const line of tuple[1].split('\n')) {
        const colon = line.indexOf(':')
        const serialized = colon >= 0 ? line.slice(colon + 1) : line
        if (
          !serialized.includes(awemeId) ||
          (!serialized.startsWith('[') && !serialized.startsWith('{'))
        ) {
          continue
        }
        const aweme = findAweme(JSON.parse(serialized) as unknown, awemeId)
        if (aweme) return aweme
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'operation-cancelled') throw error
      // Flight 中存在非 JSON 引用记录；跳过当前 script，继续尝试后续完整记录。
    }
  }
  return undefined
}

function parseRouterAweme(html: string, awemeId: string): DouyinAweme | undefined {
  const match = /window\._ROUTER_DATA\s*=\s*(\{.+?\})\s*<\/script>/s.exec(html)
  if (!match?.[1]) return undefined
  try {
    return findAweme(JSON.parse(match[1]) as unknown, awemeId)
  } catch (error) {
    if (error instanceof AppError && error.code === 'operation-cancelled') throw error
    return undefined
  }
}

function findAweme(value: unknown, awemeId: string, depth = 0): DouyinAweme | undefined {
  if (depth > 14 || value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (String(record.aweme_id ?? record.awemeId ?? '') === awemeId) return record as DouyinAweme
  for (const child of Object.values(record)) {
    const aweme = findAweme(child, awemeId, depth + 1)
    if (aweme) return aweme
  }
  return undefined
}
