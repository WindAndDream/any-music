import { AppError, MusicSourceError } from '@any-music/core'
import type {
  MusicSourceDescriptor,
  MusicSourcePlugin,
  MediaResolveOptions,
  Track,
  TrackImportRequest,
  TrackListing,
  TrackPage,
  TrackSearchRequest,
} from '@any-music/core'

export interface LazyMusicSourcePluginOptions {
  descriptor: MusicSourceDescriptor
  loginUrl?: string
  validateImportUrl: (url: string) => void
  loadPlugin: () => Promise<MusicSourcePlugin>
}

/**
 * 暴露同步描述符与列表配方，把平台实现、签名库和字段映射延后到首次会话、搜索、导入或播放。
 * 动态导入 Promise 会被复用；加载失败后清除缓存，使用户下一次操作可以重试。
 */
export class LazyMusicSourcePlugin implements MusicSourcePlugin {
  readonly descriptor: MusicSourceDescriptor

  private readonly options: LazyMusicSourcePluginOptions
  private loadedPlugin?: MusicSourcePlugin
  private pluginPromise?: Promise<MusicSourcePlugin>

  constructor(options: LazyMusicSourcePluginOptions) {
    this.options = options
    this.descriptor = options.descriptor
  }

  checkAvailability() {
    // 内置模块与当前脚本同版本，未加载不代表远端不可用，也无需为设置页提前执行平台代码。
    return Promise.resolve({ status: 'available' as const, checkedAtMs: Date.now() })
  }

  validateImportUrl(url: string): void {
    this.options.validateImportUrl(url)
  }

  async getSession() {
    return (await this.load()).getSession()
  }

  getLoginUrl(): string | undefined {
    return this.loadedPlugin?.getLoginUrl() ?? this.options.loginUrl
  }

  search(request: TrackSearchRequest): TrackListing {
    const query = request.query.normalize('NFKC').trim()
    if (!query) throw new MusicSourceError('invalid-input', '搜索关键词不能为空。')
    const normalizedRequest = { ...request, query }
    return this.createLazyListing('search', normalizedRequest, `搜索：${query}`)
  }

  importFromUrl(request: TrackImportRequest): TrackListing {
    this.validateImportUrl(request.url)
    return this.createLazyListing('import-url', request, `导入：${request.url}`)
  }

  async resolveMedia(track: Track, options?: MediaResolveOptions) {
    if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    const plugin = await this.load()
    if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    return plugin.resolveMedia(track, options)
  }

  private createLazyListing(
    kind: 'search',
    request: TrackSearchRequest,
    title: string,
  ): TrackListing
  private createLazyListing(
    kind: 'import-url',
    request: TrackImportRequest,
    title: string,
  ): TrackListing
  private createLazyListing(
    kind: 'search' | 'import-url',
    request: TrackSearchRequest | TrackImportRequest,
    title: string,
  ): TrackListing {
    const input =
      kind === 'search'
        ? (request as TrackSearchRequest).query
        : (request as TrackImportRequest).url
    let sourcePageUrl = kind === 'import-url' ? (request as TrackImportRequest).url : undefined
    return {
      id: `${this.descriptor.id}:lazy:${kind}:${input}`,
      title,
      // 搜索页 URL 只由平台实现知道；首次消费列表后补回同一个惰性 listing，不提前加载模块。
      get sourceUrl() {
        return sourcePageUrl
      },
      pages: (pageOptions) => {
        return createLazyPages(async () => {
          const loadedPlugin = await this.load()
          if (pageOptions?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
          const listing =
            kind === 'search'
              ? loadedPlugin.search(request as TrackSearchRequest)
              : loadedPlugin.importFromUrl(request as TrackImportRequest)
          sourcePageUrl = listing.sourceUrl ?? sourcePageUrl
          return listing.pages(pageOptions)
        })
      },
    }
  }

  private load(): Promise<MusicSourcePlugin> {
    if (this.loadedPlugin) return Promise.resolve(this.loadedPlugin)
    this.pluginPromise ??= this.options
      .loadPlugin()
      .then((plugin) => {
        if (plugin.descriptor.id !== this.descriptor.id) {
          throw new Error(
            `惰性音乐源模块 ID 不匹配：期望 ${this.descriptor.id}，实际 ${plugin.descriptor.id}。`,
          )
        }
        this.loadedPlugin = plugin
        return plugin
      })
      .catch((error: unknown) => {
        this.pluginPromise = undefined
        throw error
      })
    return this.pluginPromise
  }
}

function createLazyPages(
  loadPages: () => Promise<AsyncIterable<TrackPage>>,
): AsyncIterable<TrackPage> {
  return {
    async *[Symbol.asyncIterator]() {
      const pages = await loadPages()
      yield* pages
    },
  }
}
