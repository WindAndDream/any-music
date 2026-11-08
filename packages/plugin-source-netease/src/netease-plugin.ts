import {
  AppError,
  MusicSourceError,
  normalizePageSize,
  sanitizeTrackMetadataUrl,
  toAppErrorState,
} from '@any-music/core'
import type {
  MediaResolveOptions,
  MusicSourcePlugin,
  MusicSourceSession,
  ResolvedMediaSource,
  Track,
  TrackListing,
} from '@any-music/core'

import { NETEASE_MUSIC_SOURCE_DESCRIPTOR } from './descriptor'
import { NETEASE_QUALITY_LEVELS, NeteaseApi } from './netease-api'
import type { NeteaseQualityLevel } from './netease-api'
import { array, mapNeteaseSong, nonNegative, record, resourceId } from './types'
import { parseNeteaseImportUrl, validateNeteaseId } from './url-parser'

const PAGE_POLICY = { defaultSize: 30, maxSize: 100 } as const
const QUALITY_LABELS = [
  '标准',
  '较高',
  '极高',
  '无损',
  'Hi-Res',
  '高清环绕声',
  '沉浸环绕声',
  '超清母带',
] as const

export class NeteaseMusicSourcePlugin implements MusicSourcePlugin {
  readonly descriptor = NETEASE_MUSIC_SOURCE_DESCRIPTOR
  private readonly api: NeteaseApi
  constructor(api: NeteaseApi) {
    this.api = api
  }
  checkAvailability() {
    return Promise.resolve({ status: 'available' as const, checkedAtMs: Date.now() })
  }
  validateImportUrl(url: string): void {
    parseNeteaseImportUrl(url)
  }
  getLoginUrl(): string {
    return 'https://music.163.com/'
  }
  async getSession(): Promise<MusicSourceSession> {
    try {
      const value = await this.api.getSession()
      if (value.profile === null && value.account === null) return { status: 'signed-out' }
      const profile = record(value.profile)
      if (typeof profile.nickname !== 'string' || !profile.nickname.trim())
        throw new MusicSourceError('invalid-response', '网易云未返回有效用户信息。')
      const id = resourceId(profile.userId)
      if (resourceId(record(value.account).id) !== id)
        throw new MusicSourceError('invalid-response', '网易云账号与用户资料不匹配。')
      return {
        status: 'signed-in',
        user: {
          id,
          name: profile.nickname,
          avatarUrl: sanitizeTrackMetadataUrl(profile.avatarUrl),
        },
      }
    } catch (error) {
      return {
        status:
          error instanceof AppError && error.code === 'not-authenticated'
            ? 'expired'
            : 'unavailable',
        error: toAppErrorState(error, 'upstream-error', '无法检查网易云登录状态。'),
      }
    }
  }
  search(request: { query: string; pageSize?: number }): TrackListing {
    const query = request.query.trim()
    if (!query || query.length > 512)
      throw new MusicSourceError('invalid-input', '搜索关键词需为 1–512 个字符。')
    const size = normalizePageSize(request.pageSize, PAGE_POLICY)
    const api = this.api
    const listing: TrackListing = {
      id: `netease:search:${query}`,
      title: `搜索：${query}`,
      async *pages(options) {
        const scoped = api.withCancellation(options?.cancellation)
        for (let page = startPage(options); ; page++) {
          // Consumption is the backpressure boundary: do not prefetch subsequent pages.
          // eslint-disable-next-line no-await-in-loop
          const result = await scoped.search(query, size, (page - 1) * size)
          const total = nonNegative(result.songCount)
          if (total === undefined || !Number.isSafeInteger(total))
            throw new MusicSourceError('invalid-response', '网易云未返回有效的搜索总数。')
          const items = array(result.songs ?? (total === 0 ? [] : undefined)).map(mapNeteaseSong)
          const hasMore = items.length > 0 && page * size < total
          listing.estimatedTotal = total
          scoped.assertActive()
          yield {
            items,
            pageNumber: page,
            pageSize: size,
            total,
            hasMore,
            continuation: hasMore ? { kind: 'page' as const, nextPage: page + 1 } : undefined,
          }
          if (!hasMore) return
        }
      },
    }
    return listing
  }
  importFromUrl(request: { url: string; pageSize?: number }): TrackListing {
    const target = parseNeteaseImportUrl(request.url)
    const size = normalizePageSize(request.pageSize, PAGE_POLICY)
    const api = this.api
    const listing: TrackListing = {
      id: `netease:${target.kind}:${target.id}`,
      title: '网易云音乐',
      sourceUrl: target.url,
      async *pages(options) {
        const scoped = api.withCancellation(options?.cancellation)
        const first = startPage(options)
        let ids: string[] | undefined
        let songs: unknown[] | undefined
        if (target.kind === 'song') ids = [target.id]
        else if (target.kind === 'playlist') {
          const data = await scoped.getPlaylist(target.id)
          listing.title = typeof data.name === 'string' ? data.name : listing.title
          ids = array(data.trackIds).map((value) => resourceId(record(value).id))
        } else {
          const data =
            target.kind === 'album'
              ? await scoped.getAlbum(target.id)
              : await scoped.getArtist(target.id)
          const info = record(data[target.kind])
          listing.title =
            typeof info.name === 'string'
              ? `${info.name}${target.kind === 'artist' ? ' · 热门歌曲' : ''}`
              : listing.title
          songs = array(data[target.kind === 'album' ? 'songs' : 'hotSongs'])
        }
        const total = (ids ?? songs)!.length
        listing.estimatedTotal = total
        // Playlist detail provides the complete ID manifest; song detail is fetched only as consumed.
        for (let page = first; ; page++) {
          scoped.assertActive()
          const offset = (page - 1) * size
          let values: unknown[]
          if (ids) {
            // eslint-disable-next-line no-await-in-loop -- Request only the page the consumer asks for.
            values = await scoped.getSongs(ids.slice(offset, offset + size))
          } else values = songs!.slice(offset, offset + size)
          const items = values.map(mapNeteaseSong)
          const hasMore = offset + size < total
          scoped.assertActive()
          yield {
            items,
            pageNumber: page,
            pageSize: size,
            total,
            hasMore,
            continuation: hasMore ? { kind: 'page' as const, nextPage: page + 1 } : undefined,
          }
          if (!hasMore) return
        }
      },
    }
    return listing
  }
  async resolveMedia(
    track: Track,
    options: MediaResolveOptions = {},
  ): Promise<ResolvedMediaSource> {
    if (track.source.pluginId !== 'netease' || track.source.mediaKind !== 'audio')
      throw new MusicSourceError('invalid-input', '该曲目不属于网易云歌曲来源。')
    validateNeteaseId(track.source.resourceId)
    const requested = options.qualityId?.replace(/^netease:/, '')
    if (
      options.qualityId !== undefined &&
      (options.qualityId !== `netease:${requested}` ||
        !NETEASE_QUALITY_LEVELS.includes(requested as NeteaseQualityLevel))
    )
      throw new MusicSourceError('invalid-input', '所选网易云音质无效。')
    const api = this.api.withCancellation(options.cancellation)
    const media = await api.getMedia(
      track.source.resourceId,
      (requested ?? 'jymaster') as NeteaseQualityLevel,
    )
    if (media.code !== 200 || media.freeTrialInfo != null || !media.url)
      throw new MusicSourceError(
        'access-denied',
        '该歌曲不可完整播放，请检查版权、会员或购买权限。',
        { cause: media },
      )
    let url: URL
    try {
      url = new URL(String(media.url))
    } catch {
      throw new MusicSourceError('invalid-response', '网易云返回的播放地址无效。')
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !(url.hostname.endsWith('.music.126.net') || url.hostname.endsWith('.music.163.com'))
    )
      throw new MusicSourceError('invalid-response', '网易云返回了非官方媒体地址。')
    const rank = NETEASE_QUALITY_LEVELS.indexOf(media.level as NeteaseQualityLevel)
    if (rank < 0 || typeof media.encodeType !== 'string')
      throw new MusicSourceError('invalid-response', '网易云未返回实际音质和编码格式。')
    if (requested && requested !== media.level)
      throw new MusicSourceError('not-found', '当前账号无法取得所选音质，请重新选择。')
    const quality = {
      id: `netease:${media.level}`,
      label: QUALITY_LABELS[rank]!,
      rank,
      bitrate: nonNegative(media.br),
    }
    api.assertActive()
    return {
      type: 'remote-url',
      url: url.toString().replace(/^http:/, 'https:'),
      backupUrls: [],
      quality,
      availableQualities: [quality],
      requestHeaders: { Referer: 'https://music.163.com/' },
      mimeType:
        media.encodeType === 'flac'
          ? 'audio/flac'
          : media.encodeType === 'mp3'
            ? 'audio/mpeg'
            : undefined,
      durationMs: nonNegative(media.time) ?? track.durationMs,
      loadingStrategy: 'range',
    }
  }
}

function startPage(options: Parameters<TrackListing['pages']>[0]): number {
  if (options?.continuation && options.continuation.kind !== 'page')
    throw new MusicSourceError('invalid-input', '网易云列表不支持该分页游标。')
  const page = options?.continuation?.nextPage ?? options?.startPage ?? 1
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
    throw new MusicSourceError('invalid-input', '分页位置无效。')
  return page
}
