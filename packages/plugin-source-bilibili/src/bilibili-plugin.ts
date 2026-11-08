import {
  AppError,
  MusicSourceError,
  normalizePageSize,
  selectMediaLoadingStrategy,
  toAppErrorState,
} from '@any-music/core'
import type {
  MediaQuality,
  MediaResolveOptions,
  MusicSourcePlugin,
  MusicSourceSession,
  ResolvedMediaSource,
  Track,
  TrackListing,
  TrackPage,
} from '@any-music/core'

import { BilibiliApi } from './bilibili-api'
import { BILIBILI_MUSIC_SOURCE_DESCRIPTOR } from './descriptor'
import {
  createBilibiliDashQualityCandidates,
  createBilibiliHtml5Qualities,
  createBilibiliLegacyAudioQuality,
  selectBilibiliQuality,
} from './media-quality'
import {
  mapAudioSong,
  mapFavoriteMedia,
  mapSearchVideo,
  mapSeasonArchive,
  mapUpperVideo,
  mapVideoView,
} from './track-mappers'
import { parseBilibiliImportUrl } from './url-parser'

const PAGE_SIZE_POLICY = { defaultSize: 30, maxSize: 50 } as const
const VIDEO_METADATA_CONCURRENCY = 3
const EAGER_MEDIA_DURATION_MS = 10 * 60 * 1000
// B 站媒体 CDN 对 GM 二进制下载同样校验来源；固定官方页面来源，避免泄漏当前宿主页。
const BILIBILI_MEDIA_REQUEST_HEADERS = { Referer: 'https://www.bilibili.com/' } as const

/** 两端共用的 Bilibili 协议；HTTP 与媒体环境能力由所属运行端注入。 */
export class BilibiliMusicSourcePlugin implements MusicSourcePlugin {
  readonly descriptor = BILIBILI_MUSIC_SOURCE_DESCRIPTOR

  private readonly api: BilibiliApi
  private readonly canUseDirectDashAudio: () => boolean
  private readonly crossSiteQualities = new Map<string, readonly MediaQuality[]>()

  constructor(api: BilibiliApi, canUseDirectDashAudio = isBilibiliPage) {
    this.api = api
    this.canUseDirectDashAudio = canUseDirectDashAudio
  }

  checkAvailability() {
    return Promise.resolve({ status: 'available' as const, checkedAtMs: Date.now() })
  }

  validateImportUrl(url: string): void {
    parseBilibiliImportUrl(url)
  }

  async getSession(): Promise<MusicSourceSession> {
    try {
      const nav = await this.api.getNav()
      if (!nav.isLogin) return { status: 'signed-out' }
      return {
        status: 'signed-in',
        user: { id: String(nav.mid), name: nav.uname, avatarUrl: nav.face },
      }
    } catch (error) {
      return {
        status:
          error instanceof AppError && error.code === 'not-authenticated'
            ? 'expired'
            : 'unavailable',
        error: toAppErrorState(error, 'upstream-error', '无法检查 B 站登录状态。'),
      }
    }
  }

  getLoginUrl(): string {
    return 'https://passport.bilibili.com/login'
  }

  search(request: { query: string; pageSize?: number }): TrackListing {
    const listing = this.searchWithApi(request)
    return {
      ...listing,
      pages: (options) =>
        options?.cancellation
          ? new BilibiliMusicSourcePlugin(
              this.api.withCancellation(options?.cancellation),
              this.canUseDirectDashAudio,
            )
              .searchWithApi(request)
              .pages(options)
          : listing.pages(options),
    }
  }

  private searchWithApi(request: { query: string; pageSize?: number }): TrackListing {
    const query = request.query.trim()
    if (!query) throw new MusicSourceError('invalid-input', '搜索关键词不能为空。')
    const pageSize = normalizePageSize(request.pageSize, PAGE_SIZE_POLICY)

    return createListing({
      id: `bilibili:search:${query}`,
      title: `搜索：${query}`,
      loadPage: async (pageNumber) => {
        const data = await this.api.searchVideos(query, pageNumber, pageSize)
        const items = await this.resolveVideoTrackMetadata((data.result ?? []).map(mapSearchVideo))
        return {
          items,
          pageNumber: data.page,
          pageSize: data.pagesize,
          total: data.numResults,
          hasMore: data.page * data.pagesize < data.numResults,
        }
      },
    })
  }

  importFromUrl(request: { url: string; pageSize?: number }): TrackListing {
    const listing = this.importWithApi(request)
    return {
      ...listing,
      pages: (options) =>
        options?.cancellation
          ? new BilibiliMusicSourcePlugin(
              this.api.withCancellation(options?.cancellation),
              this.canUseDirectDashAudio,
            )
              .importWithApi(request)
              .pages(options)
          : listing.pages(options),
    }
  }

  private importWithApi(request: { url: string; pageSize?: number }): TrackListing {
    const target = parseBilibiliImportUrl(request.url)
    const pageSize = normalizePageSize(request.pageSize, PAGE_SIZE_POLICY)

    switch (target.kind) {
      case 'season':
        return this.createSeasonListing(target.mid, target.seasonId, target.url, pageSize)
      case 'upper-video':
        return this.createUpperVideoListing(target.mid, target.keyword, target.url, pageSize)
      case 'upper-audio':
        return this.createUpperAudioListing(target.mid, target.url, pageSize)
      case 'favorite':
        return this.createFavoriteListing(target.mediaId, target.url, pageSize)
      case 'video':
        return this.createVideoListing(target.bvid, target.url, target.page)
    }
  }

  async resolveMedia(
    track: Track,
    options: MediaResolveOptions = {},
  ): Promise<ResolvedMediaSource> {
    const api = options.cancellation ? this.api.withCancellation(options.cancellation) : this.api
    if (track.source.pluginId !== this.descriptor.id) {
      throw new MusicSourceError('invalid-input', '该曲目不属于 B 站插件。')
    }

    if (track.source.mediaKind === 'audio') {
      if (options.qualityId && options.qualityId !== 'legacy-audio:default') {
        throw new MusicSourceError('invalid-input', '所选 B 站音频音质当前不可用。')
      }
      const data = await api.getAudioPlayUrl(track.source.resourceId)
      const [url, ...backupUrls] = data.cdns ?? []
      if (!url) throw new MusicSourceError('not-found', 'B 站未返回该音频的播放地址。')
      const quality = createBilibiliLegacyAudioQuality(url, data.size, track.durationMs)
      return {
        type: 'remote-url',
        url,
        backupUrls,
        quality,
        availableQualities: [quality],
        requestHeaders: BILIBILI_MEDIA_REQUEST_HEADERS,
        durationMs: track.durationMs,
        loadingStrategy: selectMediaLoadingStrategy(track.durationMs, EAGER_MEDIA_DURATION_MS),
      }
    }

    if (track.source.mediaKind !== 'video') {
      throw new MusicSourceError('invalid-input', 'B 站插件无法直接解析自定义曲目。')
    }

    let cid = track.source.partId
    let durationMs = track.durationMs
    if (!cid) {
      const target = track.source.pageUrl ? parseBilibiliImportUrl(track.source.pageUrl) : undefined
      if (target && (target.kind !== 'video' || target.bvid !== track.source.resourceId)) {
        throw new MusicSourceError('invalid-input', 'B 站视频 URL 与曲目来源不一致。')
      }
      const view = await api.getVideoView(track.source.resourceId)
      const selected = mapVideoView(view, target?.page ?? 1)
      cid = selected.source.partId
      durationMs = selected.durationMs
    }
    if (!cid) throw new MusicSourceError('invalid-response', 'B 站视频缺少可播放分 P。')

    if (!this.canUseDirectDashAudio()) {
      return this.resolveCrossSiteVideoMedia(track, cid, durationMs, options)
    }

    const data = await api.getVideoPlayUrl(track.source.resourceId, cid)
    const candidates = createBilibiliDashQualityCandidates(data.dash?.audio ?? [])
    const selected = selectBilibiliQuality(candidates, options.qualityId)
    const audio = selected.stream
    const url = audio?.baseUrl ?? audio?.base_url
    if (!audio || !url) throw new MusicSourceError('not-found', 'B 站未返回可播放的 DASH 音频流。')

    return {
      type: 'remote-url',
      url,
      backupUrls: audio.backupUrl ?? audio.backup_url ?? [],
      quality: selected.quality,
      availableQualities: candidates.map((candidate) => candidate.quality),
      requestHeaders: BILIBILI_MEDIA_REQUEST_HEADERS,
      mimeType: audio.mimeType ?? audio.mime_type,
      codecs: audio.codecs,
      durationMs: data.timelength ?? durationMs,
      loadingStrategy: selectMediaLoadingStrategy(
        data.timelength ?? durationMs,
        EAGER_MEDIA_DURATION_MS,
      ),
    }
  }

  private async resolveCrossSiteVideoMedia(
    track: Track,
    cid: string,
    durationMs: number | undefined,
    options: MediaResolveOptions,
  ): Promise<ResolvedMediaSource> {
    const api = options.cancellation ? this.api.withCancellation(options.cancellation) : this.api
    const cacheKey = `${track.source.resourceId}:${cid}`
    let qualities = this.crossSiteQualities.get(cacheKey)
    let data

    if (!qualities) {
      // 第一次总是请求平台允许的最高档，既满足默认最高音质，也建立真实可用的 qn 白名单。
      data = await api.getHtml5VideoPlayUrl(track.source.resourceId, cid)
      qualities = createBilibiliHtml5Qualities(data)
      this.crossSiteQualities.set(cacheKey, qualities)
    }

    const selectedQuality = selectBilibiliQuality(
      qualities.map((quality) => ({ quality })),
      options.qualityId,
    ).quality
    const requestedQuality = readHtml5QualityNumber(selectedQuality)
    const resolvedQualityId = data?.quality === undefined ? undefined : `html5:${data.quality}`
    if (!data || resolvedQualityId !== selectedQuality.id) {
      data = await api.getHtml5VideoPlayUrl(track.source.resourceId, cid, requestedQuality)
    }
    if (data.quality !== undefined && `html5:${data.quality}` !== selectedQuality.id) {
      throw new MusicSourceError('not-found', 'B 站没有返回所选的跨站兼容音质。')
    }
    const media = data.durl?.[0]
    if (!media?.url) {
      throw new MusicSourceError('not-found', 'B 站未返回可跨站播放的 HTML5 媒体流。')
    }
    const resolvedDurationMs = data.timelength ?? media.length ?? durationMs
    return {
      type: 'remote-url',
      url: media.url,
      backupUrls: media.backupUrl ?? media.backup_url ?? [],
      quality: selectedQuality,
      availableQualities: qualities,
      requestHeaders: BILIBILI_MEDIA_REQUEST_HEADERS,
      mimeType: 'video/mp4',
      durationMs: resolvedDurationMs,
      // 兼容流包含低清视频轨；始终交给浏览器按需 Range，避免短视频也被整段预加载。
      loadingStrategy: 'range',
    }
  }

  private createSeasonListing(
    mid: string,
    seasonId: string,
    sourceUrl: string,
    pageSize: number,
  ): TrackListing {
    return createListing({
      id: `bilibili:season:${seasonId}`,
      title: 'B 站合集',
      sourceUrl,
      loadPage: async (pageNumber) => {
        const data = await this.api.getSeason(mid, seasonId, pageNumber, pageSize)
        const owner = { mid: data.meta.mid, name: data.meta.name || `UP ${data.meta.mid}` }
        const items = await this.resolveVideoTrackMetadata(
          (data.archives ?? []).map((archive) => mapSeasonArchive(archive, owner)),
        )
        return {
          items,
          pageNumber: data.page.page_num,
          pageSize: data.page.page_size,
          total: data.page.total,
          hasMore: data.page.page_num * data.page.page_size < data.page.total,
        }
      },
    })
  }

  private createUpperVideoListing(
    mid: string,
    keyword: string | undefined,
    sourceUrl: string,
    pageSize: number,
  ): TrackListing {
    return createListing({
      id: `bilibili:upper-video:${mid}:${keyword ?? ''}`,
      title: keyword ? `UP 投稿搜索：${keyword}` : 'UP 视频投稿',
      sourceUrl,
      loadPage: async (pageNumber) => {
        const data = await this.api.getUpperVideos(mid, keyword, pageNumber, pageSize)
        const items = await this.resolveVideoTrackMetadata(
          (data.list?.vlist ?? []).map(mapUpperVideo),
        )
        return {
          items,
          pageNumber: data.page.pn,
          pageSize: data.page.ps,
          total: data.page.count,
          hasMore: data.page.pn * data.page.ps < data.page.count,
        }
      },
    })
  }

  private createUpperAudioListing(mid: string, sourceUrl: string, pageSize: number): TrackListing {
    return createListing({
      id: `bilibili:upper-audio:${mid}`,
      title: 'UP 音频投稿',
      sourceUrl,
      loadPage: async (pageNumber) => {
        const data = await this.api.getUpperAudio(mid, pageNumber, pageSize)
        const items = (data.data ?? []).map(mapAudioSong)
        return {
          items,
          pageNumber: data.curPage,
          pageSize: data.pageSize,
          total: data.totalSize,
          hasMore: data.curPage * data.pageSize < data.totalSize,
        }
      },
    })
  }

  private createFavoriteListing(
    mediaId: string,
    sourceUrl: string,
    pageSize: number,
  ): TrackListing {
    return createListing({
      id: `bilibili:favorite:${mediaId}`,
      title: 'B 站收藏夹',
      sourceUrl,
      loadPage: async (pageNumber) => {
        const data = await this.api.getFavorite(mediaId, pageNumber, pageSize)
        const items = await this.resolveVideoTrackMetadata(
          (data.medias ?? [])
            .map(mapFavoriteMedia)
            .filter((track): track is Track => track !== undefined),
        )
        return {
          items,
          pageNumber,
          pageSize,
          total: data.info.media_count,
          hasMore: data.has_more,
        }
      },
    })
  }

  /** List durations may sum every part. Resolve only the consumed page, with bounded fan-out. */
  private async resolveVideoTrackMetadata(tracks: readonly Track[]): Promise<Track[]> {
    const items = [...tracks]
    let nextIndex = 0
    let failed = false
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(VIDEO_METADATA_CONCURRENCY, tracks.length) }, async () => {
        while (!failed && nextIndex < tracks.length) {
          const index = nextIndex++
          const track = tracks[index]!
          try {
            // oxlint-disable-next-line no-await-in-loop
            const view = await this.api.getVideoView(track.source.resourceId)
            const selected = mapVideoView(view)
            items[index] = { ...track, durationMs: selected.durationMs, source: selected.source }
          } catch (error) {
            if (error instanceof AppError && error.code === 'not-found') {
              // Retain unavailable rows, without displaying an aggregate duration as a song.
              items[index] = track
              continue
            }
            failed = true
            throw error
          }
        }
      }),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
    return items
  }

  private createVideoListing(bvid: string, sourceUrl: string, page = 1): TrackListing {
    return createListing({
      id: `bilibili:video:${bvid}${page > 1 ? `:p${page}` : ''}`,
      title: 'B 站视频',
      sourceUrl,
      loadPage: async (pageNumber) => {
        if (pageNumber > 1) {
          return { items: [], pageNumber, pageSize: 1, total: 1, hasMore: false }
        }
        const view = await this.api.getVideoView(bvid)
        return {
          items: [mapVideoView(view, page)],
          pageNumber: 1,
          pageSize: 1,
          total: 1,
          hasMore: false,
        }
      },
    })
  }
}

function readHtml5QualityNumber(quality: MediaQuality): number {
  const value = Number(quality.id.replace(/^html5:/, ''))
  return Number.isSafeInteger(value) && value > 0 ? value : 127
}

/** DASH 地址只有在 B 站页面来源下可直接读取；其他宿主页改用 HTML5 兼容流。 */
function isBilibiliPage(): boolean {
  if (typeof location === 'undefined') return false
  return location.hostname === 'bilibili.com' || location.hostname.endsWith('.bilibili.com')
}

interface ListingOptions {
  id: string
  title: string
  sourceUrl?: string
  loadPage: (pageNumber: number) => Promise<TrackPage>
}

function createListing(options: ListingOptions): TrackListing {
  return {
    id: options.id,
    title: options.title,
    sourceUrl: options.sourceUrl,
    async *pages({ startPage = 1, continuation } = {}) {
      if (continuation && continuation.kind !== 'page')
        throw new MusicSourceError('pagination-unavailable', 'B 站列表续载位置不兼容，请刷新列表。')
      let pageNumber = Math.max(1, Math.floor(continuation?.nextPage ?? startPage))
      while (true) {
        // 惰性迭代器必须等消费者请求后才逐页拉取，并行预取会破坏可取消语义。
        // oxlint-disable-next-line no-await-in-loop
        const page = await options.loadPage(pageNumber)
        yield {
          ...page,
          ...(page.hasMore
            ? { continuation: { kind: 'page' as const, nextPage: pageNumber + 1 } }
            : {}),
        }
        if (!page.hasMore || page.items.length === 0) return
        pageNumber += 1
      }
    },
  }
}
