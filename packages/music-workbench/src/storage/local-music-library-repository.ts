import {
  compileSegmentRecipe,
  createEmptyLocalMusicLibrary,
  DEFAULT_PLAYBACK_HISTORY_LIMIT,
  getCompiledDurationMs,
  LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
  MAX_PLAYBACK_HISTORY_LIMIT,
  MIN_PLAYBACK_HISTORY_LIMIT,
  normalizeTrackCustomName,
  sanitizeTrackAcquisition,
  sanitizeTrackMetadataUrl,
} from '@any-music/core'
import type {
  CustomTrackSourceCredit,
  CustomTrackDefinition,
  LibraryUserProfile,
  LibraryTrackRecord,
  LocalMusicLibrarySnapshot,
  MusicPlaylist,
  PlaybackHistoryEntry,
  SegmentRecipe,
  Track,
} from '@any-music/core'

import { readStored, writeStored } from '../runtime/storage'

const STORAGE_KEY = 'local-library:v1'

/** 稳定值仓库负责版本化快照的读写与边界校验，不包含 Vue 状态或运行端实现。 */
export const localMusicLibraryRepository = {
  load(): LocalMusicLibrarySnapshot {
    const stored = readStored<unknown>(STORAGE_KEY, undefined)
    const snapshot = sanitizeLocalMusicLibrarySnapshot(stored)
    // 首次生成本地用户 ID 时立即回写，保证刷新前身份不会漂移。
    if (
      !isRecord(stored) ||
      stored.schemaVersion !== LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION ||
      !sanitizeUserProfile(stored.profile)
    ) {
      writeStored(STORAGE_KEY, snapshot)
    }
    return snapshot
  },

  save(snapshot: LocalMusicLibrarySnapshot): void {
    writeStored(STORAGE_KEY, snapshot)
  },
}

export function sanitizeLocalMusicLibrarySnapshot(input: unknown): LocalMusicLibrarySnapshot {
  if (!isRecord(input) || input.schemaVersion !== LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION) {
    return createEmptyLocalMusicLibrary(createLocalUserProfile())
  }

  const profile = sanitizeUserProfile(input.profile) ?? createLocalUserProfile()
  const rawTracks = readArray(input.tracks, sanitizeTrackRecord)
  const candidateCustomTracks = readArray(input.customTracks, (value) =>
    sanitizeCustomTrack(value, profile),
  )
  const trackById = new Map(rawTracks.map((record) => [record.track.id, record]))
  const customById = new Map(
    candidateCustomTracks.map((definition) => [definition.trackId, definition]),
  )
  const compiledCustomTracks = candidateCustomTracks
    .map((definition) => {
      try {
        const compiledSegments = compileSegmentRecipe(definition.recipe, {
          customTrackId: definition.trackId,
          resolveTrack: (trackId) => trackById.get(trackId)?.track,
          resolveCustomTrack: (trackId) => customById.get(trackId),
        })
        const sourceCredits =
          definition.sourceCredits.length > 0
            ? definition.sourceCredits
            : collectSourceCredits(compiledSegments, trackById)
        return Object.assign({}, definition, { compiledSegments, sourceCredits })
      } catch {
        return undefined
      }
    })
    .filter((definition) => definition !== undefined)
  const validCustomIds = new Set(compiledCustomTracks.map((definition) => definition.trackId))
  const compiledCustomById = new Map(
    compiledCustomTracks.map((definition) => [definition.trackId, definition]),
  )
  const tracks = rawTracks
    .filter(
      (record) => record.track.source.mediaKind !== 'custom' || validCustomIds.has(record.track.id),
    )
    .map((record) => {
      if (record.track.source.mediaKind !== 'custom') return record
      const definition = compiledCustomById.get(record.track.id)
      return definition
        ? Object.assign({}, record, {
            track: Object.assign({}, record.track, {
              artists: [{ id: definition.creator.id, name: definition.creator.displayName }],
              durationMs: getCompiledDurationMs(definition.compiledSegments),
              publishedAtMs: record.track.publishedAtMs ?? definition.createdAtMs,
            }),
          })
        : record
    })

  const validTrackIds = new Set(tracks.map((record) => record.track.id))
  const playlists = readArray(input.playlists, sanitizePlaylist).map((playlist) =>
    Object.assign({}, playlist, {
      trackIds: playlist.trackIds.filter((trackId) => validTrackIds.has(trackId)),
    }),
  )

  const customTracks = compiledCustomTracks
  const settingsInput = isRecord(input.settings) ? input.settings : undefined
  const settings = {
    historyLimit: sanitizePlaybackHistoryLimit(settingsInput?.historyLimit),
  }
  // v6 统一在存储边界裁剪历史，损坏快照不能绕过设置中的 500 条硬上限。
  const history = readArray(input.history, sanitizeHistoryEntry)
    .filter((entry) => validTrackIds.has(entry.trackId))
    .slice(0, settings.historyLimit)
  return {
    schemaVersion: LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
    profile,
    settings,
    tracks,
    playlists,
    history,
    customTracks,
  }
}

function sanitizeTrackRecord(input: unknown): LibraryTrackRecord | undefined {
  if (!isRecord(input)) return undefined
  const track = sanitizeStoredTrack(input.track)
  const customTags: string[] = []
  const favoritedAtMs = readTimestamp(input.favoritedAtMs)
  const addedAtMs = readTimestamp(input.addedAtMs)
  const updatedAtMs = readTimestamp(input.updatedAtMs)
  if (!track || addedAtMs === undefined || updatedAtMs === undefined) return undefined
  let customName: string | undefined
  try {
    if (typeof input.customName === 'string')
      customName = normalizeTrackCustomName(input.customName)
  } catch {
    // 单项显示名损坏不影响原曲、收藏、标签等资料；旧快照没有此可选字段。
  }
  return { track, customName, customTags, favoritedAtMs, addedAtMs, updatedAtMs }
}

/** Allowlisted stable metadata shared by library and retained discovery results. */
export function sanitizeStoredTrack(input: unknown): Track | undefined {
  if (!isRecord(input) || !isRecord(input.source)) return undefined
  if (
    typeof input.id !== 'string' ||
    typeof input.title !== 'string' ||
    !Array.isArray(input.artists) ||
    typeof input.source.pluginId !== 'string' ||
    typeof input.source.resourceId !== 'string' ||
    (input.source.mediaKind !== 'audio' &&
      input.source.mediaKind !== 'video' &&
      input.source.mediaKind !== 'custom')
  ) {
    return undefined
  }
  const artists = input.artists
    .map((artist) => {
      if (!isRecord(artist) || typeof artist.name !== 'string') return undefined
      return { name: artist.name, id: typeof artist.id === 'string' ? artist.id : undefined }
    })
    .filter((artist) => artist !== undefined)
  if (artists.length === 0) return undefined

  return {
    id: input.id,
    title: input.title,
    artists,
    artworkUrl: sanitizeTrackMetadataUrl(input.artworkUrl),
    durationMs: optionalNonNegativeNumber(input.durationMs),
    publishedAtMs: optionalNonNegativeNumber(input.publishedAtMs),
    description: optionalString(input.description),
    sourceTags: readStringArray(input.sourceTags),
    statistics: sanitizeStatistics(input.statistics),
    acquisition: sanitizeTrackAcquisition(input.acquisition),
    source: {
      pluginId: input.source.pluginId,
      mediaKind: input.source.mediaKind,
      resourceId: input.source.resourceId,
      partId: optionalString(input.source.partId),
      pageUrl: sanitizeTrackMetadataUrl(input.source.pageUrl),
    },
  }
}

function sanitizeStatistics(input: unknown): Track['statistics'] {
  if (!isRecord(input)) return undefined
  return {
    playCount: optionalNonNegativeNumber(input.playCount),
    danmakuCount: optionalNonNegativeNumber(input.danmakuCount),
    favoriteCount: optionalNonNegativeNumber(input.favoriteCount),
    commentCount: optionalNonNegativeNumber(input.commentCount),
    likeCount: optionalNonNegativeNumber(input.likeCount),
  }
}

function sanitizePlaylist(input: unknown): MusicPlaylist | undefined {
  if (!isRecord(input)) return undefined
  const createdAtMs = readTimestamp(input.createdAtMs)
  const updatedAtMs = readTimestamp(input.updatedAtMs)
  if (
    typeof input.id !== 'string' ||
    typeof input.name !== 'string' ||
    createdAtMs === undefined ||
    updatedAtMs === undefined
  ) {
    return undefined
  }
  return {
    id: input.id,
    name: input.name,
    description: readRequiredString(input.description, 500),
    coverId:
      typeof input.coverId === 'string' && /^playlist-cover:[a-f0-9-]{36}$/.test(input.coverId)
        ? input.coverId
        : undefined,
    trackIds: readStringArray(input.trackIds),
    createdAtMs,
    updatedAtMs,
  }
}

function sanitizeHistoryEntry(input: unknown): PlaybackHistoryEntry | undefined {
  if (!isRecord(input)) return undefined
  const startedAtMs = readTimestamp(input.startedAtMs)
  const updatedAtMs = readTimestamp(input.updatedAtMs)
  const positionMs = optionalNonNegativeNumber(input.positionMs)
  if (
    typeof input.id !== 'string' ||
    typeof input.trackId !== 'string' ||
    startedAtMs === undefined ||
    updatedAtMs === undefined ||
    positionMs === undefined ||
    typeof input.completed !== 'boolean'
  ) {
    return undefined
  }
  return {
    id: input.id,
    trackId: input.trackId,
    startedAtMs,
    updatedAtMs,
    positionMs,
    durationMs: optionalNonNegativeNumber(input.durationMs),
    completed: input.completed,
    completedAtMs: optionalNonNegativeNumber(input.completedAtMs),
    customTrackVersion: optionalPositiveInteger(input.customTrackVersion),
  }
}

function sanitizeCustomTrack(
  input: unknown,
  fallbackCreator: LibraryUserProfile,
): CustomTrackDefinition | undefined {
  if (!isRecord(input)) return undefined
  const version = optionalPositiveInteger(input.version)
  const createdAtMs = readTimestamp(input.createdAtMs)
  const recipe = readArray(input.recipe, sanitizeSegment)
  const compiledSegments = readArray(input.compiledSegments, (value) => {
    const segment = sanitizeSegment(value)
    if (!segment || !isRecord(value)) return undefined
    const virtualStartMs = optionalNonNegativeInteger(value.virtualStartMs)
    const virtualEndMs = optionalNonNegativeInteger(value.virtualEndMs)
    if (
      virtualStartMs === undefined ||
      virtualEndMs === undefined ||
      virtualEndMs <= virtualStartMs
    ) {
      return undefined
    }
    return { ...segment, virtualStartMs, virtualEndMs }
  })
  if (
    typeof input.trackId !== 'string' ||
    version === undefined ||
    createdAtMs === undefined ||
    recipe.length === 0
  ) {
    return undefined
  }
  return {
    trackId: input.trackId,
    version,
    // Published assets do not own creation-plugin collection associations.
    materialCollectionId: '',
    recipe,
    compiledSegments,
    creator: sanitizeUserProfile(input.creator) ?? fallbackCreator,
    sourceCredits: readArray(input.sourceCredits, sanitizeSourceCredit),
    createdAtMs,
  }
}

function sanitizeUserProfile(input: unknown): LibraryUserProfile | undefined {
  if (!isRecord(input)) return undefined
  const id = readRequiredString(input.id, 200)
  const displayName = readRequiredString(input.displayName, 80)
  return id && displayName ? { id, displayName } : undefined
}

function sanitizeSourceCredit(input: unknown): CustomTrackSourceCredit | undefined {
  if (!isRecord(input)) return undefined
  const pluginId = readRequiredString(input.pluginId, 200)
  const artistName = readRequiredString(input.artistName, 200)
  if (!pluginId || !artistName) return undefined
  return {
    pluginId,
    artistId: readRequiredString(input.artistId, 500),
    artistName,
  }
}

function collectSourceCredits(
  segments: readonly SegmentRecipe[],
  trackById: ReadonlyMap<string, LibraryTrackRecord>,
): CustomTrackSourceCredit[] {
  const credits = new Map<string, CustomTrackSourceCredit>()
  for (const segment of segments) {
    const track = trackById.get(segment.sourceTrackId)?.track
    if (!track || track.source.mediaKind === 'custom') continue
    for (const artist of track.artists) {
      const credit = {
        pluginId: track.source.pluginId,
        artistId: artist.id,
        artistName: artist.name,
      }
      const identity = artist.id ?? artist.name.normalize('NFKC').trim().toLocaleLowerCase()
      credits.set(`${credit.pluginId}\u0000${identity}`, credit)
    }
  }
  return [...credits.values()]
}

function createLocalUserProfile(): LibraryUserProfile {
  return { id: `local-user:${crypto.randomUUID()}`, displayName: '本地用户' }
}

function sanitizeSegment(input: unknown): SegmentRecipe | undefined {
  if (!isRecord(input) || typeof input.sourceTrackId !== 'string') return undefined
  const startMs = optionalNonNegativeInteger(input.startMs)
  const endMs = optionalNonNegativeInteger(input.endMs)
  if (startMs === undefined || endMs === undefined || endMs <= startMs) return undefined
  return { sourceTrackId: input.sourceTrackId, startMs, endMs }
}

function readArray<T>(input: unknown, mapper: (value: unknown) => T | undefined): T[] {
  return Array.isArray(input)
    ? input.map(mapper).filter((value): value is T => value !== undefined)
    : []
}

function readStringArray(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((value): value is string => typeof value === 'string')
    : []
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

function optionalString(input: unknown): string | undefined {
  return typeof input === 'string' ? input : undefined
}

function readRequiredString(input: unknown, maxLength: number): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.normalize('NFKC').trim()
  return value && value.length <= maxLength ? value : undefined
}

function optionalNonNegativeNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined
}

function optionalNonNegativeInteger(input: unknown): number | undefined {
  return Number.isSafeInteger(input) && (input as number) >= 0 ? (input as number) : undefined
}

function optionalPositiveInteger(input: unknown): number | undefined {
  return Number.isSafeInteger(input) && (input as number) > 0 ? (input as number) : undefined
}

function sanitizePlaybackHistoryLimit(input: unknown): number {
  if (!Number.isSafeInteger(input)) return DEFAULT_PLAYBACK_HISTORY_LIMIT
  return Math.min(MAX_PLAYBACK_HISTORY_LIMIT, Math.max(MIN_PLAYBACK_HISTORY_LIMIT, input as number))
}

function readTimestamp(input: unknown): number | undefined {
  return optionalNonNegativeNumber(input)
}
