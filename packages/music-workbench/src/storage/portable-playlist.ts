import {
  AppError,
  createEmptyLocalMusicLibrary,
  validatePlaylistName,
  type LibraryUserProfile,
  type LocalMusicLibrarySnapshot,
  type MusicPlaylist,
  type PublishedCustomTrackAsset,
} from '@any-music/core'

import { sanitizeLocalMusicLibrarySnapshot } from './local-music-library-repository'

export const MAX_PLAYLIST_FILE_BYTES = 5 * 1024 ** 2
const MAX_TRACKS = 5_000

/** Transport-independent document. Creator IDs are attribution, never login/ownership authority.
 * File saving is an adapter; a future server can carry this same versioned document. */
export interface PortablePlaylist {
  format: 'any-music-playlist'
  schemaVersion: 1
  exportedAtMs: number
  exportedBy: LibraryUserProfile
  playlist: Omit<MusicPlaylist, 'coverId'>
  tracks: { track: LocalMusicLibrarySnapshot['tracks'][number]['track']; customName?: string }[]
  customTracks: PublishedCustomTrackAsset[]
}

const invalid = () => new AppError('invalid-input', '歌单文件无效、内容不完整或版本不受支持。')
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** File admission checks stable fields only, without asking any source about song availability. */
function requireTrackFields(value: unknown, index: number): void {
  const require = (condition: boolean, field: string) => {
    if (!condition)
      throw new AppError('invalid-input', `歌单文件的 tracks[${index}].${field} 缺失或无效。`)
  }
  require(record(value) && record(value.track), 'track')
  if (!record(value) || !record(value.track)) return
  const track = value.track
  for (const field of ['id', 'title'] as const)
    require(typeof track[field] === 'string' && Boolean(track[field].trim()), `track.${field}`)
  require(record(track.source), 'track.source')
  if (record(track.source)) {
    for (const field of ['pluginId', 'resourceId'] as const)
      require(typeof track.source[field] === 'string' &&
        Boolean(track.source[field].trim()), `track.source.${field}`)
    require(['audio', 'video', 'custom'].includes(
      String(track.source.mediaKind),
    ), 'track.source.mediaKind')
  }
  require(Array.isArray(track.artists) &&
    track.artists.length > 0 &&
    track.artists.every(
      (artist) => record(artist) && typeof artist.name === 'string' && Boolean(artist.name.trim()),
    ), 'track.artists')
}

/** Include the complete recipe dependency graph once, without media, account or plugin data. */
export function exportPortablePlaylist(
  library: LocalMusicLibrarySnapshot,
  playlist: MusicPlaylist,
): PortablePlaylist {
  const tracks = new Map(library.tracks.map((entry) => [entry.track.id, entry]))
  const definitions = new Map(library.customTracks.map((entry) => [entry.trackId, entry]))
  const ids = new Set<string>()
  const pending = [...playlist.trackIds]
  while (pending.length) {
    const id = pending.pop()!
    if (ids.has(id)) continue
    ids.add(id)
    if (ids.size > MAX_TRACKS || !tracks.has(id)) throw invalid()
    const definition = definitions.get(id)
    if (definition) for (const segment of definition.recipe) pending.push(segment.sourceTrackId)
  }
  const document: PortablePlaylist = {
    format: 'any-music-playlist',
    schemaVersion: 1,
    exportedAtMs: Date.now(),
    exportedBy: { ...library.profile },
    playlist: {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      trackIds: [...playlist.trackIds],
      createdAtMs: playlist.createdAtMs,
      updatedAtMs: playlist.updatedAtMs,
    },
    tracks: [...ids].map((id) => {
      const entry = tracks.get(id)!
      return { track: { ...entry.track, acquisition: undefined }, customName: entry.customName }
    }),
    customTracks: [...ids].flatMap((id) => {
      const entry = definitions.get(id)
      return entry
        ? [
            {
              trackId: entry.trackId,
              version: entry.version,
              recipe: entry.recipe,
              creator: entry.creator,
              sourceCredits: entry.sourceCredits,
              createdAtMs: entry.createdAtMs,
            },
          ]
        : []
    }),
  }
  // Apply the same allowlist and reference checks on both sides of every transport.
  const text = JSON.stringify(document)
  if (new Blob([text]).size > MAX_PLAYLIST_FILE_BYTES)
    throw new AppError('invalid-input', '歌单文件不能超过 5 MB。')
  const normalized = parsePortablePlaylist(text)
  return {
    ...document,
    tracks: normalized.tracks.map(({ track, customName }) => ({ track, customName })),
  }
}

/** Validate the complete candidate before any local mutation; never silently drop songs/recipes. */
export function parsePortablePlaylist(text: string): LocalMusicLibrarySnapshot {
  if (text.length > MAX_PLAYLIST_FILE_BYTES || new Blob([text]).size > MAX_PLAYLIST_FILE_BYTES)
    throw invalid()
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw invalid()
  }
  if (
    !record(input) ||
    input.format !== 'any-music-playlist' ||
    input.schemaVersion !== 1 ||
    !record(input.exportedBy) ||
    typeof input.exportedBy.id !== 'string' ||
    !input.exportedBy.id.trim() ||
    input.exportedBy.id.length > 200 ||
    typeof input.exportedBy.displayName !== 'string' ||
    !input.exportedBy.displayName.trim() ||
    input.exportedBy.displayName.length > 80 ||
    !record(input.playlist) ||
    !Array.isArray(input.tracks) ||
    input.tracks.length > MAX_TRACKS ||
    !Array.isArray(input.customTracks) ||
    input.customTracks.length > MAX_TRACKS ||
    !Array.isArray(input.playlist.trackIds) ||
    input.playlist.trackIds.length > MAX_TRACKS
  )
    throw invalid()
  const playlist = input.playlist
  if (!Array.isArray(playlist.trackIds)) throw invalid()
  if (
    typeof playlist.id !== 'string' ||
    !playlist.id.trim() ||
    playlist.id.length > 200 ||
    typeof input.exportedAtMs !== 'number' ||
    !Number.isSafeInteger(input.exportedAtMs) ||
    input.exportedAtMs < 0 ||
    typeof playlist.name !== 'string' ||
    (playlist.description !== undefined &&
      (typeof playlist.description !== 'string' || playlist.description.length > 500))
  )
    throw invalid()
  validatePlaylistName(playlist.name, [])
  input.tracks.forEach(requireTrackFields)
  for (const field of ['createdAtMs', 'updatedAtMs'] as const) {
    if (
      typeof playlist[field] !== 'number' ||
      !Number.isSafeInteger(playlist[field]) ||
      playlist[field] < 0
    )
      throw new AppError('invalid-input', `歌单文件的 playlist.${field} 缺失或无效。`)
  }
  const snapshot = sanitizeLocalMusicLibrarySnapshot({
    ...createEmptyLocalMusicLibrary(),
    profile: input.exportedBy,
    tracks: input.tracks.map((entry) =>
      record(entry)
        ? {
            track: record(entry.track) ? { ...entry.track, acquisition: undefined } : undefined,
            customName: entry.customName,
            addedAtMs: 0,
            updatedAtMs: 0,
          }
        : null,
    ),
    playlists: [{ ...playlist, name: validatePlaylistName(playlist.name, []), coverId: undefined }],
    customTracks: input.customTracks,
  })
  const ids = input.tracks.map((entry) =>
    record(entry) && record(entry.track) ? entry.track.id : null,
  )
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || !id) ||
    JSON.stringify(ids) !== JSON.stringify(snapshot.tracks.map(({ track }) => track.id)) ||
    snapshot.playlists.length !== 1 ||
    new Set(playlist.trackIds).size !== playlist.trackIds.length ||
    JSON.stringify(playlist.trackIds) !== JSON.stringify(snapshot.playlists[0]!.trackIds) ||
    input.customTracks.length !== snapshot.customTracks.length
  )
    throw invalid()
  const customIds = new Set<string>()
  const trackIds = new Set(ids)
  for (const [index, raw] of input.customTracks.entries()) {
    const clean = snapshot.customTracks[index]!
    if (
      !record(raw) ||
      customIds.has(clean.trackId) ||
      !trackIds.has(clean.trackId) ||
      raw.trackId !== clean.trackId ||
      !Array.isArray(raw.recipe) ||
      raw.recipe.length !== clean.recipe.length ||
      raw.recipe.some((segment, segmentIndex) => {
        const expected = clean.recipe[segmentIndex]!
        return (
          !record(segment) ||
          segment.sourceTrackId !== expected.sourceTrackId ||
          segment.startMs !== expected.startMs ||
          segment.endMs !== expected.endMs
        )
      }) ||
      !record(raw.creator) ||
      raw.creator.id !== clean.creator.id ||
      raw.creator.displayName !== clean.creator.displayName
    )
      throw invalid()
    customIds.add(clean.trackId)
  }
  return snapshot
}
