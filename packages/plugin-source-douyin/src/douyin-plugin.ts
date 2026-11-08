import {
  AppError,
  MusicSourceError,
  normalizeAppError,
  normalizePageSize,
  toAppErrorState,
} from '@any-music/core'
import type {
  CancellationSignal,
  MediaResolveOptions,
  MusicSourcePlugin,
  MusicSourceSession,
  ResolvedMediaSource,
  Track,
  TrackListing,
} from '@any-music/core'

import { DOUYIN_MUSIC_SOURCE_DESCRIPTOR } from './descriptor'
import { DouyinApi, isDouyinHttpStatusError } from './douyin-api'
import type { DouyinProtectedAwemeKind, DouyinProtectedPageSource } from './runtime-contracts'
import type { DouyinBrowserImportTarget } from './runtime-contracts'
import {
  mapDouyinAweme,
  mapDouyinMusic,
  resolveDouyinAwemeMedia,
  resolveDouyinMusicMedia,
} from './track-mappers'
import type {
  DouyinAweme,
  DouyinCollectedMusicData,
  DouyinCollectsInfo,
  DouyinCursorAwemeData,
  DouyinMixInfo,
  DouyinSearchData,
  DouyinSearchEntry,
  DouyinUser,
} from './types'
import { createDouyinSearchPageUrl, parseDouyinImportUrl } from './url-parser'

const PAGE_SIZE_POLICY = { defaultSize: 18, maxSize: 20 } as const
// 综合搜索当前固定请求 10 条；复用账号列表的 18 条会得到 HTTP 200 但业务数据为空。
const SEARCH_PAGE_SIZE_POLICY = { defaultSize: 10, maxSize: 10 } as const

/** 将抖音搜索、作品、图文、合集、用户内容及个人收藏接入统一音乐源契约。 */
export class DouyinMusicSourcePlugin implements MusicSourcePlugin {
  readonly descriptor = DOUYIN_MUSIC_SOURCE_DESCRIPTOR

  private readonly cancellation?: CancellationSignal
  private readonly api: DouyinApi
  private readonly protectedPageSource?: DouyinProtectedPageSource

  constructor(
    api: DouyinApi,
    protectedPageSource?: DouyinProtectedPageSource,
    cancellation?: CancellationSignal,
  ) {
    this.api = api
    this.cancellation = cancellation
    this.protectedPageSource = protectedPageSource
  }

  checkAvailability() {
    return Promise.resolve({ status: 'available' as const, checkedAtMs: Date.now() })
  }

  validateImportUrl(url: string): void {
    parseDouyinImportUrl(url)
  }

  async getSession(): Promise<MusicSourceSession> {
    try {
      const data = await this.api.getSelfProfile()
      if (!data.user) return { status: 'signed-out' }
      return {
        status: 'signed-in',
        user: {
          id: getUserStableId(data.user) ?? 'douyin:self',
          name: data.user.nickname || '抖音用户',
          avatarUrl: firstUserAvatar(data.user),
        },
      }
    } catch (error) {
      if (error instanceof AppError && error.code === 'operation-cancelled') throw error
      if (error instanceof MusicSourceError && error.code === 'not-authenticated') {
        return { status: 'signed-out' }
      }
      return {
        status: 'unavailable',
        error: toAppErrorState(error, 'upstream-error', '无法检查抖音登录状态。'),
      }
    }
  }

  getLoginUrl(): string {
    return 'https://www.douyin.com/'
  }

  search(request: { query: string; pageSize?: number }): TrackListing {
    const listing = this.searchWithApi(request)
    return {
      ...listing,
      pages: (options) =>
        options?.cancellation
          ? new DouyinMusicSourcePlugin(
              this.api.withCancellation(options?.cancellation),
              this.protectedPageSource,
              options?.cancellation,
            )
              .searchWithApi(request)
              .pages(options)
          : listing.pages(options),
    }
  }

  private searchWithApi(request: { query: string; pageSize?: number }): TrackListing {
    const query = request.query.trim()
    if (!query) throw new MusicSourceError('invalid-input', '搜索关键词不能为空。')
    return this.createSearchListing(
      query,
      normalizePageSize(request.pageSize, SEARCH_PAGE_SIZE_POLICY),
    )
  }

  importFromUrl(request: { url: string; pageSize?: number }): TrackListing {
    const listing = this.importWithApi(request)
    return {
      ...listing,
      pages: (options) =>
        options?.cancellation
          ? new DouyinMusicSourcePlugin(
              this.api.withCancellation(options?.cancellation),
              this.protectedPageSource,
              options?.cancellation,
            )
              .importWithApi(request)
              .pages(options)
          : listing.pages(options),
    }
  }

  private importWithApi(request: { url: string; pageSize?: number }): TrackListing {
    const target = parseDouyinImportUrl(request.url)
    const pageSize = normalizePageSize(request.pageSize, PAGE_SIZE_POLICY)

    if (
      target.kind === 'self-history' ||
      target.kind === 'self-favorites' ||
      target.kind === 'self-collected-videos' ||
      target.kind === 'self-collected-mixes' ||
      target.kind === 'mix'
    ) {
      const listing = this.createBrowserImportListing(target, target.url, pageSize)
      if (listing) return listing
    }

    switch (target.kind) {
      case 'search':
        return this.createSearchListing(
          target.query,
          normalizePageSize(request.pageSize, SEARCH_PAGE_SIZE_POLICY),
        )
      case 'video':
        return this.createAwemeListing(target.awemeId, target.pageKind, target.url, pageSize)
      case 'mix':
        return this.createMixListing(target.mixId, target.url, pageSize)
      case 'user-mixes':
        return this.createUserMixesListing(target.secUid, target.url, pageSize)
      case 'user-posts':
        return this.createUserListing(target.secUid, false, target.url, pageSize)
      case 'user-favorites':
        return this.createUserListing(target.secUid, true, target.url, pageSize)
      case 'self-posts':
        return this.createSelfListing(false, target.url, pageSize)
      case 'self-history':
        return createCursorListing({
          id: 'douyin:self:history',
          title: '我的抖音观看历史',
          sourceUrl: target.url,
          pageSize,
          load: async (cursor) =>
            assertProtectedAwemePage(await this.api.getSelfHistory(cursor, pageSize), '观看历史'),
        })
      case 'self-recommendations':
        return this.createSelfRecommendationsListing(target.url, pageSize)
      case 'self-mixes':
        return this.createSelfMixesListing(target.url, pageSize)
      case 'self-favorites':
        return this.createSelfListing(true, target.url, pageSize)
      case 'self-collected-videos':
        return this.createSelfCollectedVideosListing(target.url, pageSize)
      case 'self-collected-music':
        return this.createSelfCollectedMusicListing(target.url, pageSize)
      case 'self-collected-mixes':
        return this.createSelfCollectedMixesListing(target.url, pageSize)
      case 'self-collection-folders':
        return this.createSelfCollectionFoldersListing(target.url, pageSize)
    }
  }

  private createBrowserImportListing(
    target: DouyinBrowserImportTarget,
    sourceUrl: string,
    pageSize: number,
  ): TrackListing | undefined {
    // Capability checking is lazy: opening a native target belongs to pages().
    if (!this.api.hasBrowserImport) return undefined
    const api = this.api
    const id =
      target.kind === 'mix'
        ? `douyin:mix:${target.mixId}`
        : `douyin:self:${target.kind === 'self-favorites' ? 'favorites' : target.kind.slice(5)}`
    const title =
      target.kind === 'mix'
        ? '抖音合集'
        : target.kind === 'self-history'
          ? '我的抖音观看历史'
          : target.kind === 'self-favorites'
            ? '我的抖音喜欢'
            : target.kind === 'self-collected-mixes'
              ? '我的抖音收藏合集'
              : '我的抖音收藏视频'
    return {
      id,
      title,
      sourceUrl,
      async *pages(options) {
        const reader = api.openImport(target)!
        let activeMix: ReturnType<DouyinApi['openImport']>
        try {
          if (target.kind !== 'self-collected-mixes') {
            yield* createCursorListing({
              id,
              title,
              sourceUrl,
              pageSize,
              load: async (cursor) =>
                assertProtectedAwemePage(
                  (await reader.load(cursor)) as DouyinCursorAwemeData,
                  title,
                ),
            }).pages(options)
            return
          }
          yield* createFlattenedMixesListing({
            id,
            title,
            sourceUrl,
            pageSize,
            loadMixDirectory: async (cursor) => {
              const data = await reader.load(cursor)
              if (!Array.isArray(data.mix_infos ?? data.mixInfos)) {
                throw new MusicSourceError('invalid-response', '抖音收藏合集响应缺少合集目录。')
              }
              return data
            },
            loadMixPage: async (mixId, cursor) => {
              if (cursor === 0) {
                await activeMix?.close()
                activeMix = api.openImport({ kind: 'mix', mixId })
              }
              return assertProtectedAwemePage(
                (await activeMix!.load(cursor)) as DouyinCursorAwemeData,
                '合集',
              )
            },
          }).pages(options)
        } finally {
          await activeMix?.close()
          await reader.close()
        }
      },
    }
  }

  async resolveMedia(
    track: Track,
    options: MediaResolveOptions = {},
  ): Promise<ResolvedMediaSource> {
    if (options.cancellation) {
      return new DouyinMusicSourcePlugin(
        this.api.withCancellation(options.cancellation),
        this.protectedPageSource,
        options?.cancellation,
      ).resolveMedia(track, { ...options, cancellation: undefined })
    }
    if (this.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    if (track.source.pluginId !== this.descriptor.id) {
      throw new MusicSourceError('invalid-input', '该曲目不是可由抖音插件解析的作品。')
    }
    if (track.source.mediaKind === 'audio' && track.source.partId === 'music') {
      const music = await this.api.getMusicDetail(track.source.resourceId)
      return resolveDouyinMusicMedia(music, track.durationMs, options)
    }
    if (track.source.mediaKind !== 'video') {
      throw new MusicSourceError('invalid-input', '该抖音曲目缺少可识别的媒体解析配方。')
    }
    const pageKind = track.source.partId === 'note' ? 'note' : 'video'
    const aweme = await this.loadAwemeDetail(track.source.resourceId, pageKind)
    // 只返回当前播放会话使用的短时地址；Track 本身仍只保存 aweme id 和解析配方。
    return resolveDouyinAwemeMedia(aweme, track.durationMs, options)
  }

  private createSearchListing(query: string, pageSize: number): TrackListing {
    const api = this.api
    return {
      id: `douyin:search:${query}`,
      title: `抖音搜索：${query}`,
      sourceUrl: createDouyinSearchPageUrl(query),
      async *pages({ startPage = 1, continuation } = {}) {
        if (continuation && continuation.kind !== 'cursor')
          throw new MusicSourceError(
            'pagination-unavailable',
            '抖音搜索续载位置不兼容，请刷新列表。',
          )
        const reader = api.openSearch(query, pageSize)
        try {
          let pageNumber = Math.max(1, Math.floor(continuation?.nextPage ?? startPage))
          let offset = continuation?.cursor ?? (pageNumber - 1) * pageSize
          while (true) {
            // 每次 next() 只触发当前一页；消费者停止后不会继续请求抖音。
            let data: DouyinSearchData
            try {
              // oxlint-disable-next-line no-await-in-loop
              data = await reader.load(offset)
            } catch (error) {
              if (error instanceof AppError && error.code === 'operation-cancelled') throw error
              const code = normalizeAppError(error).code
              // 网络、限流、登录和人工验证都有独立恢复动作；未知后续页故障才归入分页受限。
              if (
                pageNumber === 1 ||
                code === 'network-error' ||
                code === 'request-timeout' ||
                code === 'operation-cancelled' ||
                code === 'rate-limited' ||
                code === 'not-authenticated' ||
                code === 'access-denied' ||
                code === 'verification-required'
              ) {
                throw error
              }
              throw createDouyinSearchPaginationError(error)
            }
            // HTTP 200 和 status_code=0 只证明响应成功；缺失列表不能解释为没有搜索结果。
            if (!Array.isArray(data.data)) {
              throw new MusicSourceError('invalid-response', '抖音搜索响应缺少有效的结果列表。')
            }
            const entries = data.data
            const more = data.has_more ?? data.hasMore
            // An explicit successful terminal response can arrive after a page
            // advertised more. Ambiguous/error result statuses are not exhaustion.
            const isEmptyEnd =
              (more === 0 || more === false) &&
              (data.result_status === undefined || data.result_status === 0)
            if (pageNumber > 1 && entries.length === 0 && !isEmptyEnd) {
              throw createDouyinSearchPaginationError()
            }
            if (entries.length === 0 && toBoolean(data.has_more ?? data.hasMore)) {
              throw new MusicSourceError(
                'invalid-response',
                '抖音搜索响应声明还有结果，但未返回当前页内容。',
              )
            }
            // The first page needs the same explicit exhaustion evidence as later
            // pages; an abnormal/missing terminal status is not a successful search.
            if (entries.length === 0 && !isEmptyEnd) {
              throw new MusicSourceError(
                'invalid-response',
                '抖音搜索未返回有效的结果页，请刷新重试。',
                { cause: { result_status: data.result_status, has_more: more } },
              )
            }
            const items = entries
              .map(mapDouyinSearchEntry)
              .filter((track): track is Track => track !== undefined)
            const hasMore = toBoolean(data.has_more ?? data.hasMore) && entries.length > 0
            const nextOffset = data.cursor ?? offset + entries.length
            const cursor = nextOffset > offset ? nextOffset : offset + entries.length
            yield {
              items,
              pageNumber,
              pageSize,
              hasMore,
              ...(hasMore
                ? { continuation: { kind: 'cursor' as const, nextPage: pageNumber + 1, cursor } }
                : {}),
            }
            // 当前页可能全是直播或其他卡片；仍保留下一页入口，但不提前请求。
            if (!hasMore) return
            offset = cursor
            pageNumber += 1
          }
        } finally {
          await reader.close()
        }
      },
    }
  }

  private createMixListing(mixId: string, sourceUrl: string, pageSize: number): TrackListing {
    return createCursorListing({
      id: `douyin:mix:${mixId}`,
      title: '抖音合集',
      sourceUrl,
      pageSize,
      load: (cursor) => this.api.getMixAwemes(mixId, cursor, pageSize),
    })
  }

  private createUserListing(
    secUid: string,
    favorites: boolean,
    sourceUrl: string,
    pageSize: number,
  ): TrackListing {
    return createCursorListing({
      id: `douyin:user:${secUid}:${favorites ? 'favorites' : 'posts'}`,
      title: favorites ? '抖音用户喜欢' : '抖音用户作品',
      sourceUrl,
      pageSize,
      load: (cursor) =>
        favorites
          ? this.api.getUserFavorites(secUid, cursor, pageSize)
          : this.api.getUserPosts(secUid, cursor, pageSize),
    })
  }

  private createUserMixesListing(
    secUid: string,
    sourceUrl: string,
    pageSize: number,
  ): TrackListing {
    return createFlattenedMixesListing({
      id: `douyin:user:${secUid}:mixes`,
      title: '抖音用户合集',
      sourceUrl,
      pageSize,
      loadMixDirectory: (cursor) => this.api.getUserMixes(secUid, cursor, pageSize),
      loadMixPage: (mixId, cursor) => this.api.getMixAwemes(mixId, cursor, pageSize),
    })
  }

  private createSelfListing(favorites: boolean, sourceUrl: string, pageSize: number): TrackListing {
    let secUid: string | undefined
    return createCursorListing({
      id: `douyin:self:${favorites ? 'favorites' : 'posts'}`,
      title: favorites ? '我的抖音喜欢' : '我的抖音作品',
      sourceUrl,
      pageSize,
      load: async (cursor) => {
        if (!favorites) {
          if (!secUid) {
            const profile = await this.api.getSelfProfile()
            secUid = profile.user && getUserSecUid(profile.user)
            if (!secUid) {
              throw new MusicSourceError('not-authenticated', '请先登录抖音再导入个人内容。')
            }
          }
          return this.api.getUserPosts(secUid, cursor, pageSize)
        }

        try {
          if (!secUid) {
            const profile = await this.api.getSelfProfile()
            secUid = profile.user && getUserSecUid(profile.user)
            if (!secUid) {
              throw new MusicSourceError('not-authenticated', '请先登录抖音再导入个人内容。')
            }
          }
          const page = await this.api.getUserFavorites(secUid, cursor, pageSize)
          return assertProtectedAwemePage(page, '喜欢')
        } catch (error) {
          if (error instanceof AppError && error.code === 'operation-cancelled') throw error
          // HTTP、业务码、登录态和畸形数据都可能表示网页安全运行时拒绝了 GM 请求。
          return this.loadProtectedSelfPage('self-favorites', cursor, sourceUrl, error)
        }
      },
    })
  }

  private createSelfMixesListing(sourceUrl: string, pageSize: number): TrackListing {
    let secUid: string | undefined
    return createFlattenedMixesListing({
      id: 'douyin:self:mixes',
      title: '我的抖音合集',
      sourceUrl,
      pageSize,
      loadMixDirectory: async (cursor) => {
        if (!secUid) {
          const profile = await this.api.getSelfProfile()
          secUid = profile.user && getUserSecUid(profile.user)
          if (!secUid) {
            throw new MusicSourceError('not-authenticated', '请先登录抖音再导入个人合集。')
          }
        }
        return this.api.getUserMixes(secUid, cursor, pageSize)
      },
      loadMixPage: (mixId, cursor) => this.api.getMixAwemes(mixId, cursor, pageSize),
    })
  }

  private createSelfRecommendationsListing(sourceUrl: string, pageSize: number): TrackListing {
    let secUid: string | undefined
    return createCursorListing({
      id: 'douyin:self:recommendations',
      title: '我的抖音推荐',
      sourceUrl,
      pageSize,
      load: async (cursor) => {
        try {
          if (!secUid) {
            const profile = await this.api.getSelfProfile()
            secUid = profile.user && getUserSecUid(profile.user)
            if (!secUid) {
              throw new MusicSourceError('not-authenticated', '请先登录抖音再导入推荐内容。')
            }
          }
          const page = await this.api.getSelfRecommendations(secUid, cursor, pageSize)
          return assertProtectedAwemePage(page, '推荐')
        } catch (error) {
          if (error instanceof AppError && error.code === 'operation-cancelled') throw error
          return this.loadProtectedSelfPage('self-recommendations', cursor, sourceUrl, error)
        }
      },
    })
  }

  private createSelfCollectedVideosListing(sourceUrl: string, pageSize: number): TrackListing {
    return createCursorListing({
      id: 'douyin:self:collected-videos',
      title: '我的抖音收藏视频',
      sourceUrl,
      pageSize,
      load: async (cursor) => {
        try {
          const page = await this.api.getCollectedAwemes(cursor, pageSize)
          return assertProtectedAwemePage(page, '收藏视频')
        } catch (error) {
          if (error instanceof AppError && error.code === 'operation-cancelled') throw error
          // 任意未得到可消费列表的结果都打开页面；是否需要人工操作由页面实际 UI 决定。
          return this.loadProtectedSelfPage('self-collected-videos', cursor, sourceUrl, error)
        }
      },
    })
  }

  private async loadProtectedSelfPage(
    kind: DouyinProtectedAwemeKind,
    cursor: number,
    sourceUrl: string,
    requestError: unknown,
  ): Promise<DouyinCursorAwemeData> {
    if (this.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    const source = this.protectedPageSource
    let page: DouyinCursorAwemeData | undefined
    try {
      page = await source?.getCapturedAwemePage(kind, cursor, this.cancellation)
    } catch (error) {
      if (error instanceof AppError && error.code === 'operation-cancelled') throw error
      throw new MusicSourceError(
        'upstream-error',
        normalizeAppError(error, 'upstream-error', '抖音页面未能加载受保护列表。').message,
        {
          cause: new AggregateError(
            [requestError, error],
            'Douyin request and page fallback failed',
          ),
        },
      )
    }
    if (page) return page

    const label =
      kind === 'self-favorites' ? '喜欢' : kind === 'self-recommendations' ? '推荐' : '收藏视频'
    const guidance = source?.isCurrentPage(kind)
      ? `抖音页面尚未加载“${label}”列表，请等页面内容显示后重试。`
      : `抖音接口未正确响应，且无法从已打开的页面读取“${label}”；请保留该页并确认列表已显示。`
    throw new MusicSourceError('upstream-error', guidance, {
      cause: new AggregateError(
        [requestError, new Error(`Protected Douyin page data unavailable for ${sourceUrl}`)],
        'Douyin request and page fallback unavailable',
      ),
    })
  }

  private createSelfCollectedMusicListing(sourceUrl: string, pageSize: number): TrackListing {
    return createMusicListing({
      id: 'douyin:self:collected-music',
      title: '我的抖音收藏音乐',
      sourceUrl,
      pageSize,
      load: (cursor) => this.api.getCollectedMusic(cursor, pageSize),
    })
  }

  private createSelfCollectedMixesListing(sourceUrl: string, pageSize: number): TrackListing {
    return createFlattenedMixesListing({
      id: 'douyin:self:collected-mixes',
      title: '我的抖音收藏合集',
      sourceUrl,
      pageSize,
      loadMixDirectory: (cursor) => this.api.getCollectedMixes(cursor, pageSize),
      loadMixPage: (mixId, cursor) => this.api.getMixAwemes(mixId, cursor, pageSize),
    })
  }

  private createSelfCollectionFoldersListing(sourceUrl: string, pageSize: number): TrackListing {
    return createFlattenedFoldersListing({
      id: 'douyin:self:collection-folders',
      title: '我的抖音收藏夹',
      sourceUrl,
      pageSize,
      loadDirectory: (cursor) => this.api.getCollectFolders(cursor, pageSize),
      loadFolderPage: (collectsId, cursor) =>
        this.api.getCollectFolderAwemes(collectsId, cursor, pageSize),
    })
  }

  private createAwemeListing(
    awemeId: string,
    pageKind: 'video' | 'note' | undefined,
    sourceUrl: string,
    pageSize: number,
  ): TrackListing {
    const loadDetail = (id: string, kind: 'video' | 'note') => this.loadAwemeDetail(id, kind)
    const loadMix = (mixId: string) =>
      this.createBrowserImportListing({ kind: 'mix', mixId }, sourceUrl, pageSize) ??
      this.createMixListing(mixId, sourceUrl, pageSize)
    return {
      id: `douyin:video:${awemeId}`,
      title: pageKind === 'note' ? '抖音图文 / 合集' : '抖音作品 / 合集',
      sourceUrl,
      async *pages({ startPage = 1 } = {}) {
        const pageNumber = Math.max(1, Math.floor(startPage))
        // Only import expands a work's collection. Playback still resolves this exact work.
        // Read detail lazily once per iterator and let the owning transport page the mix.
        const aweme = await loadDetail(awemeId, pageKind ?? 'video')
        const mix = aweme.mix_info ?? aweme.mixInfo
        const mixId = mix?.mix_id ?? mix?.mixId
        if (typeof mixId === 'string' && /^\d{1,32}$/.test(mixId)) {
          yield* loadMix(mixId).pages({ startPage: pageNumber })
          return
        }
        if (pageNumber > 1) {
          yield { items: [], pageNumber, pageSize: 1, total: 1, hasMore: false }
          return
        }
        const track = mapDouyinAweme(aweme)
        if (!track) throw new MusicSourceError('invalid-response', '抖音作品缺少稳定 aweme id。')
        yield { items: [track], pageNumber: 1, pageSize: 1, total: 1, hasMore: false }
      },
    }
  }

  private async loadAwemeDetail(awemeId: string, pageKind: 'video' | 'note'): Promise<DouyinAweme> {
    try {
      return await this.api.getAwemeDetail(awemeId, pageKind)
    } catch (error) {
      if (error instanceof AppError && error.code === 'operation-cancelled') throw error
      // An account-owned official page already supplied the detail. Replaying its failure
      // through local signing/native HTTP loses that environment and can mask a challenge.
      if (this.api.hasBrowserAwemeDetail) throw error
      if (
        error instanceof MusicSourceError &&
        (error.code === 'not-authenticated' ||
          error.code === 'verification-required' ||
          (error.code === 'access-denied' && !isDouyinHttpStatusError(error, 403)))
      ) {
        throw error
      }
      try {
        // aweme/detail 可能单独拒绝 GM 请求；公开页面能返回同一作品时，403 不代表内容私密。
        return await this.api.getAwemeFromPage(awemeId, pageKind)
      } catch {
        // 页面也不可用时保留原 API 错误，避免把真实的权限/限流原因降级成详情缺失。
        throw error
      }
    }
  }
}

/** 综合搜索的 type=1 同时包含作品和直播；按实抓的作品类型排除直播，再校验媒体结构。 */
function mapDouyinSearchEntry(entry: DouyinSearchEntry): Track | undefined {
  if (entry.type !== undefined && entry.type !== 1) return undefined
  const aweme = entry.aweme_info ?? entry.awemeInfo
  if (!aweme) return undefined
  // 直播卡片也有 aweme_id，部分甚至带 video.bit_rate，不能靠 ID 或媒体字段识别。
  if (entry.doc_type === 156 || (aweme.aweme_type ?? aweme.awemeType) === 101) return undefined
  const video = aweme.video
  const hasVideo = Boolean(
    video &&
    (video.duration ||
      video.play_addr ||
      video.playAddr ||
      video.play_addr_h264 ||
      video.playAddrH264 ||
      video.bit_rate_audio_list?.length ||
      video.bitRateAudioList?.length ||
      video.bit_rate?.length ||
      video.bitRate?.length),
  )
  const hasNoteMusic = Boolean(
    (aweme.images?.length || aweme.aweme_type === 68 || aweme.awemeType === 68) && aweme.music,
  )
  if (!hasVideo && !hasNoteMusic) return undefined
  return mapDouyinAweme(aweme)
}

/** 未识别的后续页失败无法证明必然是人机验证；只保留可观察的分页不可用事实。 */
function createDouyinSearchPaginationError(cause?: unknown): MusicSourceError {
  return new MusicSourceError(
    'pagination-unavailable',
    '抖音搜索的后续结果暂时无法获取，已加载的歌曲仍可使用。请稍后重试。',
    cause === undefined ? undefined : { cause },
  )
}

/** 受保护列表必须明确携带数组；空数组是有效空页，缺字段则交给页面运行时重试。 */
function assertProtectedAwemePage(
  page: DouyinCursorAwemeData,
  label: string,
): DouyinCursorAwemeData {
  if (Array.isArray(page.aweme_list ?? page.awemeList)) return page
  throw new MusicSourceError('invalid-response', `抖音“${label}”响应缺少作品列表。`)
}

interface CursorListingOptions {
  id: string
  title: string
  sourceUrl: string
  pageSize: number
  load: (cursor: number) => Promise<DouyinCursorAwemeData>
}

interface FlattenedMixesListingOptions {
  id: string
  title: string
  sourceUrl: string
  pageSize: number
  loadMixDirectory: (cursor: number) => Promise<{
    mix_infos?: DouyinMixInfo[]
    mixInfos?: DouyinMixInfo[]
    has_more?: number | boolean
    hasMore?: number | boolean
    cursor?: number
  }>
  loadMixPage: (mixId: string, cursor: number) => Promise<DouyinCursorAwemeData>
}

interface MusicListingOptions {
  id: string
  title: string
  sourceUrl: string
  pageSize: number
  load: (cursor: number) => Promise<DouyinCollectedMusicData>
}

interface FlattenedFoldersListingOptions {
  id: string
  title: string
  sourceUrl: string
  pageSize: number
  loadDirectory: (cursor: number) => Promise<{
    collects_list?: DouyinCollectsInfo[]
    collectsList?: DouyinCollectsInfo[]
    has_more?: number | boolean
    hasMore?: number | boolean
    cursor?: number
  }>
  loadFolderPage: (collectsId: string, cursor: number) => Promise<DouyinCursorAwemeData>
}

function createCursorListing(options: CursorListingOptions): TrackListing {
  return {
    id: options.id,
    title: options.title,
    sourceUrl: options.sourceUrl,
    async *pages({ startPage = 1, continuation } = {}) {
      if (continuation && (continuation.kind !== 'cursor' || options.id.startsWith('douyin:self:')))
        throw new MusicSourceError('pagination-unavailable', '此列表需要手动刷新后继续加载。')
      let pageNumber = Math.max(1, Math.floor(continuation?.nextPage ?? startPage))
      let cursor = continuation?.cursor ?? 0
      while (true) {
        // 游标页严格串行拉取，同一 listing 从不后台预取下一批。
        // oxlint-disable-next-line no-await-in-loop
        const data = await options.load(cursor)
        const awemes = data.aweme_list ?? data.awemeList ?? []
        const items = awemes
          .map(mapDouyinAweme)
          .filter((track): track is Track => track !== undefined)
        const nextCursor = data.cursor ?? data.max_cursor ?? data.maxCursor ?? cursor
        const hasMore =
          toBoolean(data.has_more ?? data.hasMore) && awemes.length > 0 && nextCursor !== cursor
        yield {
          items,
          pageNumber,
          pageSize: options.pageSize,
          hasMore,
          ...(hasMore && !options.id.startsWith('douyin:self:')
            ? {
                continuation: {
                  kind: 'cursor' as const,
                  nextPage: pageNumber + 1,
                  cursor: nextCursor,
                },
              }
            : {}),
        }
        if (!hasMore || items.length === 0) return
        cursor = nextCursor
        pageNumber += 1
      }
    },
  }
}

function createMusicListing(options: MusicListingOptions): TrackListing {
  return {
    id: options.id,
    title: options.title,
    sourceUrl: options.sourceUrl,
    async *pages({ startPage = 1 } = {}) {
      let pageNumber = Math.max(1, Math.floor(startPage))
      let cursor = 0
      while (true) {
        // 收藏音乐只保留稳定 music id，当前页的 play_url 不进入 Track。
        // oxlint-disable-next-line no-await-in-loop
        const data = await options.load(cursor)
        const musicList = data.mc_list ?? data.mcList ?? []
        const items = musicList
          .map(mapDouyinMusic)
          .filter((track): track is Track => track !== undefined)
        const nextCursor = data.cursor ?? cursor
        const hasMore =
          toBoolean(data.has_more ?? data.hasMore) && musicList.length > 0 && nextCursor !== cursor
        yield { items, pageNumber, pageSize: options.pageSize, hasMore }
        if (!hasMore || items.length === 0) return
        cursor = nextCursor
        pageNumber += 1
      }
    },
  }
}

function createFlattenedMixesListing(options: FlattenedMixesListingOptions): TrackListing {
  return {
    id: options.id,
    title: options.title,
    sourceUrl: options.sourceUrl,
    async *pages() {
      let pageNumber = 1
      let directoryCursor = 0
      let directoryHasMore = true
      let mixes: DouyinMixInfo[] = []
      let activeMix: DouyinMixInfo | undefined
      let mixCursor = 0

      while (true) {
        if (!activeMix) {
          if (mixes.length === 0) {
            if (!directoryHasMore) return
            // 只在当前目录已消费完时取下一页，不会同时拉取作者全部合集。
            // oxlint-disable-next-line no-await-in-loop
            const directory = await options.loadMixDirectory(directoryCursor)
            mixes = directory.mix_infos ?? directory.mixInfos ?? []
            const nextDirectoryCursor = directory.cursor ?? directoryCursor
            directoryHasMore =
              toBoolean(directory.has_more ?? directory.hasMore) &&
              mixes.length > 0 &&
              nextDirectoryCursor !== directoryCursor
            directoryCursor = nextDirectoryCursor
            if (mixes.length === 0) return
          }
          activeMix = mixes.shift()
          mixCursor = 0
        }

        if (!activeMix) return
        const mixId = activeMix.mix_id ?? activeMix.mixId
        if (!mixId) {
          activeMix = undefined
          continue
        }

        // 展开当前合集时仍严格一页一页读取；完成后才进入下一个合集。
        // oxlint-disable-next-line no-await-in-loop
        const data = await options.loadMixPage(mixId, mixCursor)
        const awemes = data.aweme_list ?? data.awemeList ?? []
        const mixName = activeMix.mix_name ?? activeMix.mixName
        const items = awemes
          .map(mapDouyinAweme)
          .filter((track): track is Track => track !== undefined)
          .map((track) => addMixTag(track, mixName))
        const nextMixCursor = data.cursor ?? data.max_cursor ?? data.maxCursor ?? mixCursor
        const mixHasMore =
          toBoolean(data.has_more ?? data.hasMore) &&
          awemes.length > 0 &&
          nextMixCursor !== mixCursor
        if (mixHasMore) mixCursor = nextMixCursor
        else activeMix = undefined

        const hasMore = mixHasMore || mixes.length > 0 || directoryHasMore
        yield { items, pageNumber, pageSize: options.pageSize, hasMore }
        if (!hasMore) return
        pageNumber += 1
      }
    },
  }
}

function createFlattenedFoldersListing(options: FlattenedFoldersListingOptions): TrackListing {
  return {
    id: options.id,
    title: options.title,
    sourceUrl: options.sourceUrl,
    async *pages() {
      let pageNumber = 1
      let directoryCursor = 0
      let directoryHasMore = true
      let folders: DouyinCollectsInfo[] = []
      let activeFolder: DouyinCollectsInfo | undefined
      let folderCursor = 0

      while (true) {
        if (!activeFolder) {
          if (folders.length === 0) {
            if (!directoryHasMore) return
            // 目录消费完才读取下一页；收藏夹内容同样按当前文件夹逐页展开。
            // oxlint-disable-next-line no-await-in-loop
            const directory = await options.loadDirectory(directoryCursor)
            folders = directory.collects_list ?? directory.collectsList ?? []
            const nextDirectoryCursor = directory.cursor ?? directoryCursor
            directoryHasMore =
              toBoolean(directory.has_more ?? directory.hasMore) &&
              folders.length > 0 &&
              nextDirectoryCursor !== directoryCursor
            directoryCursor = nextDirectoryCursor
            if (folders.length === 0) return
          }
          activeFolder = folders.shift()
          folderCursor = 0
        }

        if (!activeFolder) return
        const folderId = getCollectsId(activeFolder)
        if (!folderId) {
          activeFolder = undefined
          continue
        }

        // oxlint-disable-next-line no-await-in-loop
        const data = await options.loadFolderPage(folderId, folderCursor)
        const awemes = data.aweme_list ?? data.awemeList ?? []
        const folderName = activeFolder.collects_name ?? activeFolder.collectsName
        const items = awemes
          .map(mapDouyinAweme)
          .filter((track): track is Track => track !== undefined)
          .map((track) => addSourceTag(track, folderName && `收藏夹：${folderName}`))
        const nextFolderCursor = data.cursor ?? data.max_cursor ?? data.maxCursor ?? folderCursor
        const folderHasMore =
          toBoolean(data.has_more ?? data.hasMore) &&
          awemes.length > 0 &&
          nextFolderCursor !== folderCursor
        if (folderHasMore) folderCursor = nextFolderCursor
        else activeFolder = undefined

        const hasMore = folderHasMore || folders.length > 0 || directoryHasMore
        yield { items, pageNumber, pageSize: options.pageSize, hasMore }
        if (!hasMore) return
        pageNumber += 1
      }
    },
  }
}

function addMixTag(track: Track, mixName?: string): Track {
  return addSourceTag(track, mixName && `合集：${mixName}`)
}

function addSourceTag(track: Track, tag?: string): Track {
  if (!tag) return track
  return {
    ...track,
    sourceTags: [...(track.sourceTags ?? []), tag],
  }
}

function getCollectsId(folder: DouyinCollectsInfo): string | undefined {
  return folder.collects_id_str ?? folder.collectsIdStr ?? folder.collects_id ?? folder.collectsId
}

function toBoolean(value: boolean | number | undefined): boolean {
  return value === true || value === 1
}

function getUserSecUid(user: DouyinUser): string | undefined {
  return user.sec_uid ?? user.secUid
}

function getUserStableId(user: DouyinUser): string | undefined {
  return getUserSecUid(user) ?? user.uid
}

function firstUserAvatar(user: DouyinUser): string | undefined {
  const resource = user.avatar_thumb ?? user.avatarThumb
  return resource?.url_list?.[0] ?? resource?.urlList?.[0]
}
