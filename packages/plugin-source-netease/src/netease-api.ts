import { AppError, MusicSourceError } from '@any-music/core'
import type { CancellationSignal, HttpClient } from '@any-music/core'

import { array, record, resourceId } from './types'
import type { NeteaseRecord } from './types'
import { validateNeteaseId } from './url-parser'

export const NETEASE_QUALITY_LEVELS = [
  'standard',
  'higher',
  'exhigh',
  'lossless',
  'hires',
  'jyeffect',
  'sky',
  'jymaster',
] as const
export type NeteaseQualityLevel = (typeof NETEASE_QUALITY_LEVELS)[number]

/** Portable official protocol. Credentials, proxies, cancellation and bytes belong to the injected runtime. */
export class NeteaseApi {
  private readonly http: HttpClient
  private readonly cancellation?: CancellationSignal
  constructor(http: HttpClient, cancellation?: CancellationSignal) {
    this.http = http
    this.cancellation = cancellation
  }
  withCancellation(cancellation?: CancellationSignal): NeteaseApi {
    return cancellation ? new NeteaseApi(this.http, cancellation) : this
  }
  assertActive(): void {
    if (this.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
  }
  getSession(): Promise<NeteaseRecord> {
    return this.request('w/nuser/account/get')
  }
  async search(query: string, limit: number, offset: number): Promise<NeteaseRecord> {
    return record(
      (
        await this.request(
          'cloudsearch/pc',
          { s: query, type: 1, limit, offset, total: true },
          'POST',
        )
      ).result,
    )
  }
  async getSongs(ids: readonly string[]): Promise<unknown[]> {
    if (!ids.length) return []
    if (ids.length > 100) throw new MusicSourceError('invalid-input', '每次最多读取 100 首歌曲。')
    ids.forEach(validateNeteaseId)
    const songs = array(
      (await this.request('v3/song/detail', { c: ids.map((id) => ({ id: Number(id) })) })).songs,
    )
    const byId = new Map(songs.map((song) => [resourceId(record(song).id), song]))
    // Unavailable/deleted tracks may be absent; preserve the original playlist order.
    return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)] : []))
  }
  async getPlaylist(id: string): Promise<NeteaseRecord> {
    validateNeteaseId(id)
    return record((await this.request('v6/playlist/detail', { id, n: 0, s: 0 })).playlist)
  }
  getAlbum(id: string): Promise<NeteaseRecord> {
    validateNeteaseId(id)
    return this.request(`v1/album/${id}`)
  }
  getArtist(id: string): Promise<NeteaseRecord> {
    validateNeteaseId(id)
    return this.request(`v1/artist/${id}`)
  }
  async getMedia(id: string, level: NeteaseQualityLevel): Promise<NeteaseRecord> {
    validateNeteaseId(id)
    const items = array(
      (
        await this.request(
          'song/enhance/player/url/v1',
          { ids: [Number(id)], level, encodeType: 'flac' },
          'POST',
        )
      ).data,
    )
    const item = items.map(record).find((value) => value.id === Number(id))
    if (!item) throw new MusicSourceError('invalid-response', '网易云未返回该歌曲的媒体数据。')
    return item
  }
  private async request(
    path: string,
    params: Record<string, unknown> = {},
    method: 'GET' | 'POST' = 'GET',
  ): Promise<NeteaseRecord> {
    this.assertActive()
    const form = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [
        key,
        typeof value === 'object' ? JSON.stringify(value) : String(value),
      ]),
    )
    const response = await this.http.request({
      url: `https://music.163.com/api/${path}${method === 'GET' && form.size ? `?${form}` : ''}`,
      method,
      body: method === 'POST' ? form.toString() : undefined,
      headers: {
        Referer: 'https://music.163.com/',
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      credentials: 'include',
      responseType: 'text',
      maxResponseBytes: 4 * 1024 * 1024,
      timeoutMs: 15000,
      cancellation: this.cancellation,
    })
    this.assertActive()
    if (response.status !== 200) throw responseError(response.status, { status: response.status })
    let data: NeteaseRecord
    try {
      data = record(
        JSON.parse(
          typeof response.body === 'string'
            ? response.body
            : new TextDecoder().decode(response.body),
        ),
      )
    } catch (cause) {
      throw new MusicSourceError('invalid-response', '网易云返回了无效响应。', { cause })
    }
    if (typeof data.code !== 'number' || !Number.isInteger(data.code))
      throw new MusicSourceError('invalid-response', '网易云响应缺少有效状态码。')
    if (data.code !== 200) throw responseError(data.code, data)
    return data
  }
}

function responseError(code: number, cause: unknown): MusicSourceError {
  const kind =
    code === 301 || code === 401
      ? 'not-authenticated'
      : code === 403
        ? 'access-denied'
        : code === 404
          ? 'not-found'
          : code === 429 || code === 405
            ? 'rate-limited'
            : code === -460
              ? 'verification-required'
              : 'upstream-error'
  return new MusicSourceError(
    kind,
    kind === 'not-authenticated'
      ? '网易云登录已失效，请重新登录。'
      : '网易云请求失败，请稍后重试或检查账号权限。',
    { cause },
  )
}
