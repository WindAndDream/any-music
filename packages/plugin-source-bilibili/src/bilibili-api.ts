import { AppError, MusicSourceError } from '@any-music/core'
import type { CancellationSignal, HttpClient } from '@any-music/core'

import type {
  BilibiliApiEnvelope,
  BilibiliAudioUrlData,
  BilibiliFavoriteData,
  BilibiliNavData,
  BilibiliPlayUrlData,
  BilibiliSearchData,
  BilibiliSeasonData,
  BilibiliUpperAudioData,
  BilibiliUpperVideoData,
  BilibiliVideoViewData,
} from './types'
import { createWbiMixinKey, signWbiQuery } from './wbi-signature'
import type { BilibiliQueryValue } from './wbi-signature'

const API_ROOT = 'https://api.bilibili.com'
const WBI_KEY_TTL_MS = 10 * 60 * 1000

/** B 站原始接口集中在此处，映射层不会自行拼 URL 或处理响应码。 */
export class BilibiliApi {
  private readonly cancellation?: CancellationSignal
  private readonly httpClient: HttpClient
  private readonly state: { wbiKeyCache?: { key: string; expiresAtMs: number } }

  constructor(
    httpClient: HttpClient,
    cancellation?: CancellationSignal,
    state: { wbiKeyCache?: { key: string; expiresAtMs: number } } = {},
  ) {
    this.httpClient = httpClient
    this.cancellation = cancellation
    this.state = state
  }

  /** Each operation owns cancellation; only signing material is shared across operations. */
  withCancellation(cancellation?: CancellationSignal): BilibiliApi {
    return cancellation ? new BilibiliApi(this.httpClient, cancellation, this.state) : this
  }

  getNav(): Promise<BilibiliNavData> {
    return this.get('/x/web-interface/nav')
  }

  searchVideos(query: string, page: number, pageSize: number): Promise<BilibiliSearchData> {
    return this.getWbi('/x/web-interface/wbi/search/type', {
      search_type: 'video',
      keyword: query,
      page,
      page_size: pageSize,
      platform: 'pc',
      highlight: 1,
      order: 'totalrank',
    })
  }

  getUpperVideos(
    mid: string,
    keyword: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<BilibiliUpperVideoData> {
    return this.getWbi('/x/space/wbi/arc/search', {
      mid,
      keyword: keyword ?? '',
      pn: page,
      ps: pageSize,
      tid: 0,
      order: 'pubdate',
      order_avoided: true,
      platform: 'web',
    })
  }

  getSeason(
    mid: string,
    seasonId: string,
    page: number,
    pageSize: number,
  ): Promise<BilibiliSeasonData> {
    return this.get('/x/polymer/web-space/seasons_archives_list', {
      mid,
      season_id: seasonId,
      sort_reverse: false,
      page_num: page,
      page_size: pageSize,
    })
  }

  getUpperAudio(mid: string, page: number, pageSize: number): Promise<BilibiliUpperAudioData> {
    return this.get('/audio/music-service/web/song/upper', {
      uid: mid,
      pn: page,
      ps: pageSize,
      order: 1,
    })
  }

  getFavorite(mediaId: string, page: number, pageSize: number): Promise<BilibiliFavoriteData> {
    return this.get('/x/v3/fav/resource/list', {
      media_id: mediaId,
      pn: page,
      ps: pageSize,
      keyword: '',
      order: 'mtime',
      type: 0,
      tid: 0,
      platform: 'web',
    })
  }

  getVideoView(bvid: string): Promise<BilibiliVideoViewData> {
    return this.get('/x/web-interface/view', { bvid })
  }

  getVideoPlayUrl(bvid: string, cid: string): Promise<BilibiliPlayUrlData> {
    return this.get('/x/player/playurl', {
      bvid,
      cid,
      qn: 16,
      fnver: 0,
      // fnval=16 请求 DASH，播放器只选取其中的 audio representation。
      fnval: 16,
      fourk: 0,
    })
  }

  /**
   * 获取可由非 B 站宿主页原生媒体元素读取的渐进式地址。
   *
   * B 站 DASH CDN 会校验页面来源，跨站直接交给 `<audio>` 时返回 403；HTML5 模式的
   * durl 保留浏览器 Range 加载能力，避免退化为 GM 整段下载和大对象 URL。
   */
  getHtml5VideoPlayUrl(bvid: string, cid: string, quality = 127): Promise<BilibiliPlayUrlData> {
    return this.get('/x/player/playurl', {
      bvid,
      cid,
      qn: quality,
      fnver: 0,
      fnval: 0,
      fourk: 1,
      platform: 'html5',
      high_quality: 1,
    })
  }

  getAudioPlayUrl(songId: string): Promise<BilibiliAudioUrlData> {
    return this.get('/audio/music-service-c/web/url', {
      sid: songId,
      privilege: 2,
      quality: 2,
    })
  }

  private async get<T>(
    path: string,
    params: Readonly<Record<string, BilibiliQueryValue>> = {},
  ): Promise<T> {
    const query = createQuery(params)
    return this.requestJson<T>(`${API_ROOT}${path}${query ? `?${query}` : ''}`)
  }

  private async getWbi<T>(
    path: string,
    params: Readonly<Record<string, BilibiliQueryValue>>,
  ): Promise<T> {
    const key = await this.getWbiKey()
    return this.requestJson<T>(`${API_ROOT}${path}?${signWbiQuery(params, key)}`)
  }

  private async getWbiKey(): Promise<string> {
    const now = Date.now()
    if (this.state.wbiKeyCache && this.state.wbiKeyCache.expiresAtMs > now)
      return this.state.wbiKeyCache.key

    const nav = await this.getNav()
    if (!nav.wbi_img) {
      throw new MusicSourceError('invalid-response', 'B 站未返回 WBI 签名材料。')
    }

    const key = createWbiMixinKey(nav.wbi_img.img_url, nav.wbi_img.sub_url)
    this.state.wbiKeyCache = { key, expiresAtMs: now + WBI_KEY_TTL_MS }
    return key
  }

  private async requestJson<T>(url: string): Promise<T> {
    let response
    try {
      // B 站的登录态属于目标平台；即使脚本挂载在其他网站，也应由 GM 请求携带 B 站 Cookie。
      if (this.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
      response = await this.httpClient.request({
        cancellation: this.cancellation,
        url,
        timeoutMs: 15_000,
        credentials: 'include',
      })
    } catch (error) {
      // 平台适配器保留传输层的网络/超时语义，供列表给出正确恢复入口。
      if (
        error instanceof AppError &&
        (error.code === 'network-error' ||
          error.code === 'request-timeout' ||
          error.code === 'operation-cancelled')
      ) {
        throw error
      }
      throw new MusicSourceError('upstream-error', '无法连接哔哩哔哩，请稍后重试。', {
        cause: error,
      })
    }

    if (this.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    if (response.status < 200 || response.status >= 300) {
      throw new MusicSourceError('upstream-error', `B 站接口返回 HTTP ${response.status}。`)
    }

    let envelope: BilibiliApiEnvelope<T>
    try {
      if (typeof response.body !== 'string') {
        throw new TypeError('B 站 JSON 接口意外返回了二进制内容。')
      }
      envelope = JSON.parse(response.body) as BilibiliApiEnvelope<T>
    } catch (error) {
      throw new MusicSourceError('invalid-response', 'B 站返回了无法解析的数据。', {
        cause: error,
      })
    }

    if (envelope.code !== 0) throw mapBilibiliError(envelope.code, envelope.message)
    return envelope.data
  }
}

function createQuery(params: Readonly<Record<string, BilibiliQueryValue>>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value))
  }
  return query.toString()
}

function mapBilibiliError(code: number, message: string): MusicSourceError {
  if (code === -101) {
    return new MusicSourceError('not-authenticated', 'B 站登录已失效，请重新登录后重试。')
  }
  if (code === -403) return new MusicSourceError('access-denied', message || '无权访问该内容。')
  if (code === -404) return new MusicSourceError('not-found', message || 'B 站内容不存在或已失效。')
  if (code === -352 || code === -412) {
    return new MusicSourceError('rate-limited', 'B 站触发了风控，请稍后在正常页面操作后重试。')
  }
  return new MusicSourceError('upstream-error', message || `B 站接口错误（${code}）。`)
}
