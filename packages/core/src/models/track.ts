/** 跨音乐来源统一使用的歌手摘要。 */
export interface TrackArtist {
  /** 来源可提供稳定标识时填写；仅有名称的来源可以省略。 */
  id?: string
  name: string
}

/** 来源中的媒体形态；视频平台的视频也可作为 Any Music 的可播放曲目。 */
export type TrackMediaKind = 'video' | 'audio' | 'custom'

/**
 * 可持久化的来源引用。
 *
 * 临时播放地址不进入该结构；播放器每次播放时必须通过对应插件重新解析，
 * 以免把 B 站等平台的短时签名地址误当成稳定数据保存。
 */
export interface TrackSourceReference {
  pluginId: string
  mediaKind: TrackMediaKind
  resourceId: string
  /** 分 P、章节或音轨等来源内子资源标识。 */
  partId?: string
  /** 供用户跳回原始内容页面的稳定 URL。 */
  pageUrl?: string
}

/** 来源能够提供的统计摘要；缺失字段表示平台未返回，而不是数值为 0。 */
export interface TrackStatistics {
  playCount?: number
  danmakuCount?: number
  favoriteCount?: number
  commentCount?: number
  likeCount?: number
}

/**
 * Any Music 内部统一的歌曲模型。
 * 平台适配器负责将各音乐来源的数据转换成该结构。
 */
export interface Track {
  /** 跨插件稳定且唯一的标识，建议采用 `<plugin>:<kind>:<resource>:<part>`。 */
  id: string
  title: string
  artists: readonly TrackArtist[]
  /** 可直接显示的封面资源地址。 */
  artworkUrl?: string
  /** 歌曲总时长，统一使用毫秒。 */
  durationMs?: number
  /** 发布时间，Unix 毫秒时间戳。 */
  publishedAtMs?: number
  description?: string
  /** 平台原始标签；用户自定义标签由本地资料库单独维护。 */
  sourceTags?: readonly string[]
  statistics?: TrackStatistics
  source: TrackSourceReference
  /** Public acquisition provenance only; never selects or authorizes a request account. */
  acquisition?: {
    accountId: string
    accountName: string
    acquiredAtMs: number
  }
}

/** Persist only HTTP(S) metadata references, including protocol-relative CDN URLs.
 * Blob/data/file URLs and embedded credentials do not survive the stable-data boundary. */
export function sanitizeTrackMetadataUrl(input: unknown): string | undefined {
  return typeof input === 'string' &&
    /^(?:https?:)?\/\/[^\s/?#@\\]+(?:[/?#][^\s\\]*)?$/i.test(input)
    ? input
    : undefined
}

/** Restore display-only acquisition metadata at library and download-history boundaries. */
export function sanitizeTrackAcquisition(input: unknown): Track['acquisition'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (
    typeof value.accountId !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.accountId) ||
    typeof value.accountName !== 'string' ||
    !value.accountName.trim() ||
    [...value.accountName].length > 80 ||
    typeof value.acquiredAtMs !== 'number' ||
    !Number.isSafeInteger(value.acquiredAtMs) ||
    value.acquiredAtMs < 0
  )
    return undefined
  return {
    accountId: value.accountId,
    accountName: value.accountName,
    acquiredAtMs: value.acquiredAtMs,
  }
}
