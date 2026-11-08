import { AppError } from '../errors/app-error'
import type { AppErrorCode, AppErrorState } from '../errors/app-error'
import type { Track } from '../models/track'
import type { CancellationSignal } from '../ports/http-client'

/** 插件可声明的发现能力，UI 只展示当前插件真正支持的入口。 */
export interface MusicSourceCapabilities {
  search: boolean
  importUrl: boolean
  session: boolean
}

/** 区分随应用发布的本地实现与用户导入的外部声明式插件。 */
export type MusicSourceProvenance = 'built-in' | 'external'

/**
 * URL 导入的本地预检范围。
 *
 * 只使用精确 origin 与路径前缀，不接受正则表达式，避免外部清单引入 ReDoS 或脚本执行面。
 */
export interface MusicSourceImportUrlScope {
  origin: string
  pathnamePrefix: string
}

/** 音乐来源插件的稳定元数据。 */
export interface MusicSourceDescriptor {
  id: string
  name: string
  description?: string
  provenance: MusicSourceProvenance
  capabilities: MusicSourceCapabilities
  importUrlScopes: readonly MusicSourceImportUrlScope[]
}

/** 插件有效性与网络故障分离，只有服务端明确返回 false 才标记为失效。 */
export type MusicSourceAvailability =
  | { status: 'unchecked' }
  | { status: 'checking' }
  | { status: 'available'; checkedAtMs: number }
  | { status: 'invalid'; checkedAtMs: number; error: AppErrorState }
  | { status: 'unavailable'; checkedAtMs: number; error: AppErrorState }

/** 登录态是显式状态机，避免把一次成功请求永久缓存成“在线”。 */
export type MusicSourceSession =
  | { status: 'checking' }
  | { status: 'not-required' }
  | { status: 'signed-out' }
  | {
      status: 'signed-in'
      user: {
        id: string
        name: string
        /** 运行端提供的公开自定义名称；平台原名仍保留在 name，不持久化会话。 */
        customName?: string
        avatarUrl?: string
      }
    }
  | { status: 'expired'; error: AppErrorState }
  | { status: 'unavailable'; error: AppErrorState }

/** Public pagination position only; never store credentials, browser sessions or media URLs. */
export type TrackListingContinuation =
  | { kind: 'page'; nextPage: number }
  | { kind: 'cursor'; nextPage: number; cursor: number }

/** 单页曲目结果；total 缺失表示来源采用游标或不公开总数。 */
export interface TrackPage {
  items: readonly Track[]
  pageNumber: number
  pageSize: number
  total?: number
  hasMore: boolean
  /** Present only when the source can resume directly without replaying previous pages. */
  continuation?: TrackListingContinuation
}

/**
 * 可惰性消费的曲目集合。
 *
 * 每次迭代只请求当前页，调用方停止迭代后不会继续预取，适合大型合集、
 * UP 投稿和收藏夹等数据源。
 */
export interface TrackListing {
  id: string
  title: string
  sourceUrl?: string
  estimatedTotal?: number
  /** 当前列表实际使用的公开账号身份；运行端可在首个分页后补齐；仅可持久化稳定 ID 和公开名称，不得保存状态或凭证。 */
  account?: {
    id?: string
    name?: string
    customName?: string
    /** Last observed independent facts; never infer logout from a security challenge. */
    state?: {
      login: 'signed-in' | 'signed-out' | 'unknown'
      verification: 'required' | 'not-required' | 'unknown'
      connection: 'available' | 'unavailable' | 'unknown'
    }
  }
  pages(options?: {
    startPage?: number
    continuation?: TrackListingContinuation
    cancellation?: CancellationSignal
  }): AsyncIterable<TrackPage>
  /** User-initiated runtime verification for this listing's identity; never persisted. */
  verify?(options?: {
    cancellation?: CancellationSignal
    onProgress?: (phase: 'opening' | 'waiting' | 'confirming' | 'restoring') => void
  }): Promise<void>
}

/** 搜索请求由插件自行解释，pageSize 是期望值而不是强制的平台页大小。 */
export interface TrackSearchRequest {
  query: string
  pageSize?: number
}

/** URL 导入覆盖平台合集、UP 投稿、站内搜索和收藏夹等入口。 */
export interface TrackImportRequest {
  url: string
  pageSize?: number
}

/** 远程媒体的加载策略，明确区分整段预加载和按浏览器 Range 请求读取。 */
export type MediaLoadingStrategy = 'eager' | 'range'

/**
 * 一次媒体解析中可供用户切换的音质。
 *
 * `rank` 只在同一插件、同一曲目的当前候选中比较，数值越大音质越高；它不应被持久化，
 * 也不能用于跨平台比较。`bitrate` 是平台明确返回或可由当前媒体可靠推导的比特率（bit/s）。
 */
export interface MediaQuality {
  id: string
  label: string
  rank: number
  bitrate?: number
}

/** 省略 qualityId 表示插件必须按自己的校验规则选择当前最高可用音质。 */
export interface MediaResolveOptions {
  qualityId?: string
  /** Optional runtime-neutral cancellation; declarative resolvers forward it to structured and binary requests. */
  cancellation?: CancellationSignal
}

/** 每次播放时即时解析的远程媒体；该对象禁止持久化。 */
export interface RemoteResolvedMediaSource {
  /** 当前临时媒体会话的公开账号身份；不能写入歌曲或持久化快照。 */
  accountId?: string
  /** Runtime lease/grant cleanup, idempotent and scoped to this ephemeral media session. */
  release?: () => void
  type: 'remote-url'
  url: string
  backupUrls: readonly string[]
  /** 当前实际选择的音质；必须同时出现在 availableQualities 中。 */
  quality: MediaQuality
  /** 当前解析会话中实际可用的音质，按 rank 从高到低排列。 */
  availableQualities: readonly MediaQuality[]
  /**
   * 运行端主动读取媒体字节时附带的临时请求头，例如 CDN 防盗链要求的页面来源。
   * 插件不得在此放入 Cookie、令牌或其他秘密；登录态仍由运行端 credentials 策略控制。
   */
  requestHeaders?: Readonly<Record<string, string>>
  mimeType?: string
  codecs?: string
  durationMs?: number
  loadingStrategy: MediaLoadingStrategy
}

/** 明确声明为完整读取的小媒体；字节仅存在于当前播放会话。 */
export interface CompleteBinaryResolvedMediaSource {
  accountId?: string
  release?: () => void
  type: 'complete-binary'
  bytes: Uint8Array
  mimeType: string
  quality: MediaQuality
  availableQualities: readonly MediaQuality[]
  durationMs?: number
  loadingStrategy: 'eager'
}

export type ResolvedMediaSource = RemoteResolvedMediaSource | CompleteBinaryResolvedMediaSource

/** 所有来源插件都必须实现的最小公共契约。 */
export interface MusicSourcePlugin {
  readonly descriptor: MusicSourceDescriptor
  checkAvailability(): Promise<MusicSourceAvailability>
  /** 纯本地校验；失败时抛出 invalid-input 或 unsupported-url，禁止发起网络请求。 */
  validateImportUrl(url: string): void
  getSession(): Promise<MusicSourceSession>
  getLoginUrl(): string | undefined
  search(request: TrackSearchRequest): TrackListing
  importFromUrl(request: TrackImportRequest): TrackListing
  resolveMedia(track: Track, options?: MediaResolveOptions): Promise<ResolvedMediaSource>
}

/** 可供 UI 稳定映射提示文案的插件错误类型。 */
export type MusicSourceErrorCode = Extract<
  AppErrorCode,
  | 'invalid-input'
  | 'unsupported-url'
  | 'not-authenticated'
  | 'access-denied'
  | 'not-found'
  | 'rate-limited'
  | 'verification-required'
  | 'pagination-unavailable'
  | 'upstream-error'
  | 'invalid-response'
>

export class MusicSourceError extends AppError {
  declare readonly code: MusicSourceErrorCode

  constructor(code: MusicSourceErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options)
    this.name = 'MusicSourceError'
  }
}
