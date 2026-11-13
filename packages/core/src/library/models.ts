import type { CompiledSegmentRecipe, SegmentRecipe } from '@any-music/audio-composition'
export type { CompiledSegmentRecipe, SegmentRecipe } from '@any-music/audio-composition'
import type { Track } from '../models/track'

export const LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION = 6 as const

/** 历史记录至少保留一项，并以 500 作为设置与持久化边界的共同硬上限。 */
export const MIN_PLAYBACK_HISTORY_LIMIT = 1 as const
export const MAX_PLAYBACK_HISTORY_LIMIT = 500 as const
export const DEFAULT_PLAYBACK_HISTORY_LIMIT = MAX_PLAYBACK_HISTORY_LIMIT

/** 本地创作者身份与来源账号解耦；稳定 ID 用于未来导入/导出，显示名允许用户修改。 */
export interface LibraryUserProfile {
  id: string
  displayName: string
}

/** 本地资料库对来源曲目的持久化包装；平台标签与用户标签保持分离。 */
export interface LibraryTrackRecord {
  track: Track
  /** 按 track.id 关联的本地显示名；不覆盖来源 title，重新搜索或刷新元数据时仍保留。 */
  customName?: string
  customTags: readonly string[]
  /** 存在时表示属于用户的“我的喜欢”；时间用于稳定排序，并与普通资料库记录解耦。 */
  favoritedAtMs?: number
  addedAtMs: number
  updatedAtMs: number
}

/** 用户歌单只保存稳定曲目 ID 与顺序，不复制曲目或平台歌单元数据。 */
export interface MusicPlaylist {
  id: string
  name: string
  description?: string
  /** Stable reference into the runtime-local uploaded artwork cache. */
  coverId?: string
  trackIds: readonly string[]
  createdAtMs: number
  updatedAtMs: number
}

/**
 * 素材合集是自定义歌曲的创作边界，只保存稳定曲目 ID，不复制媒体或短时地址。
 * 同一曲目可以加入多个合集；是否允许参与一次配方由当前合集成员关系决定。
 */
export interface MaterialCollection {
  id: string
  name: string
  trackIds: readonly string[]
  createdAtMs: number
  updatedAtMs: number
}

/** 一次播放选择对应一条历史记录，进度更新覆盖同一条记录而不是持续追加。 */
export interface PlaybackHistoryEntry {
  id: string
  trackId: string
  startedAtMs: number
  updatedAtMs: number
  positionMs: number
  durationMs?: number
  completed: boolean
  completedAtMs?: number
  /** 自定义歌曲采用不可变版本，便于未来迁移与复现历史。 */
  customTrackVersion?: number
}

/** 可持久化的资料库设置；历史上限表示最多保留多少次播放选择。 */
export interface LocalMusicLibrarySettings {
  historyLimit: number
}

/** 宿主运行时视图提供编辑配方与重新编译的扁平叶子；持久化资产使用 PublishedCustomTrackAsset。 */
export interface CustomTrackDefinition {
  trackId: string
  version: number
  /** 受控编辑投影中的素材合集；宿主独立读取时为空，不属于持久化作品资产。 */
  materialCollectionId: string
  recipe: readonly SegmentRecipe[]
  compiledSegments: readonly CompiledSegmentRecipe[]
  /** 创建者快照不会随来源博主变化，导出后仍能标识真正创建拼接作品的用户。 */
  creator: LibraryUserProfile
  /** 叶子片段的跨平台署名；平台 ID 参与去重，避免不同平台的同名账号被合并。 */
  sourceCredits: readonly CustomTrackSourceCredit[]
  createdAtMs: number
}

/** Host-owned published recipe. Editing collections and compiled caches are not asset data. */
export type PublishedCustomTrackAsset = Omit<
  CustomTrackDefinition,
  'materialCollectionId' | 'compiledSegments'
>

/** Canonical host records exclude plugin associations and runtime compiled caches. */
export type HostLocalMusicLibrarySnapshot = Omit<
  LocalMusicLibrarySnapshot,
  'tracks' | 'customTracks'
> & {
  tracks: Omit<LibraryTrackRecord, 'customTags'>[]
  customTracks: PublishedCustomTrackAsset[]
}

/** 自定义歌曲的一条来源署名，artistId 缺失时仍保留平台与规范化名称。 */
export interface CustomTrackSourceCredit {
  pluginId: string
  artistId?: string
  artistName: string
}

/** 宿主资料库的运行时视图；标签与创作关联由各插件独立管理。 */
export interface LocalMusicLibrarySnapshot {
  schemaVersion: typeof LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION
  profile: LibraryUserProfile
  settings: LocalMusicLibrarySettings
  tracks: readonly LibraryTrackRecord[]
  playlists: readonly MusicPlaylist[]
  history: readonly PlaybackHistoryEntry[]
  customTracks: readonly CustomTrackDefinition[]
}

export function createEmptyLocalMusicLibrary(
  profile: LibraryUserProfile = { id: 'local-user:unassigned', displayName: '本地用户' },
): LocalMusicLibrarySnapshot {
  return {
    schemaVersion: LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
    profile,
    settings: { historyLimit: DEFAULT_PLAYBACK_HISTORY_LIMIT },
    tracks: [],
    playlists: [],
    history: [],
    customTracks: [],
  }
}
