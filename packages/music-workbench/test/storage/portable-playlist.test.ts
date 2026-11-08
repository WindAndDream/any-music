import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sanitizeLocalMusicLibrarySnapshot } from '#workbench/storage/local-music-library-repository'
import {
  exportPortablePlaylist,
  parsePortablePlaylist,
  MAX_PLAYLIST_FILE_BYTES,
} from '#workbench/storage/portable-playlist'

function fixture() {
  return sanitizeLocalMusicLibrarySnapshot(
    JSON.parse(
      readFileSync(new URL('../fixtures/storage/local-library-v6.json', import.meta.url), 'utf8'),
    ),
  )
}

describe('portable user playlists', () => {
  it('round-trips ordered membership and recipe dependencies without account, favorite or cached data', () => {
    const library = fixture()
    const playlist = {
      ...library.playlists[0]!,
      trackIds: ['local:custom:mix'],
      coverId: 'playlist-cover:local',
    }
    const document = exportPortablePlaylist(library, playlist)
    const text = JSON.stringify(document)
    const restored = parsePortablePlaylist(text)
    expect(restored.playlists[0]?.trackIds).toEqual(['local:custom:mix'])
    expect(restored.tracks).toHaveLength(3)
    expect(restored.customTracks[0]?.recipe).toEqual(library.customTracks[0]?.recipe)
    expect(restored.customTracks[0]?.compiledSegments).toEqual(
      library.customTracks[0]?.compiledSegments,
    )
    expect(restored.customTracks[0]?.creator).toEqual(library.profile)
    expect(text).not.toMatch(
      /coverId|compiledSegments|materialCollectionId|favoritedAtMs|customTags|acquisition/,
    )
    expect(restored.tracks.every((entry) => entry.favoritedAtMs === undefined)).toBe(true)
    expect(restored.tracks.find(({ track }) => track.id === 'fixture:audio:a')?.customName).toBe(
      'Fixture local name',
    )
  })

  it('allowlists metadata and never exports unrelated tracks or runtime URL fields', () => {
    const library = fixture()
    const document = exportPortablePlaylist(library, {
      ...library.playlists[0]!,
      trackIds: ['fixture:audio:a'],
    })
    expect(document.tracks.map(({ track }) => track.id)).toEqual(['fixture:audio:a'])
    expect(document.customTracks).toEqual([])
    const track = document.tracks[0]!.track
    Object.assign(track, {
      artworkUrl: 'blob:temporary',
      mediaUrl: 'https://example.com/media',
      acquisition: { accountId: 'secret' },
    })
    Object.assign(track.source, { pageUrl: 'file:///local', cookies: 'private' })
    const restored = parsePortablePlaylist(JSON.stringify(document))
    const text = JSON.stringify(restored)
    expect(text).not.toMatch(/temporary|mediaUrl|acquisition|cookies|file:\/\/\/local/)
  })

  it('rejects unsupported versions, duplicate IDs, missing dependencies and truncated recipes as a whole', () => {
    const library = fixture()
    const base = exportPortablePlaylist(library, library.playlists[0]!)
    const cases = [
      { ...base, schemaVersion: 2 },
      { ...base, format: 'source-playlist' },
      { ...base, tracks: [...base.tracks, base.tracks[0]] },
      { ...base, tracks: base.tracks.filter(({ track }) => track.id !== 'fixture:audio:a') },
      { ...base, playlist: { ...base.playlist, trackIds: ['missing'] } },
      {
        ...base,
        customTracks: base.customTracks.map((entry) =>
          Object.assign({}, entry, {
            recipe: [...entry.recipe, { sourceTrackId: 'missing' }],
          }),
        ),
      },
    ]
    for (const input of cases) expect(() => parsePortablePlaylist(JSON.stringify(input))).toThrow()
    expect(() => parsePortablePlaylist('{')).toThrow()
    expect(() => parsePortablePlaylist(' '.repeat(MAX_PLAYLIST_FILE_BYTES + 1))).toThrow()
  })

  it('supports an empty playlist without manufacturing song or creator state', () => {
    const library = fixture()
    const document = exportPortablePlaylist(library, { ...library.playlists[0]!, trackIds: [] })
    const restored = parsePortablePlaylist(JSON.stringify(document))
    expect(restored.playlists).toHaveLength(1)
    expect(restored.tracks).toEqual([])
    expect(restored.customTracks).toEqual([])
    expect(restored.profile).toEqual(library.profile)
  })

  it('admits well-formed unavailable source identities offline and names missing basic fields', () => {
    const library = fixture()
    const document = exportPortablePlaylist(library, {
      ...library.playlists[0]!,
      trackIds: ['fixture:audio:a'],
    })
    document.tracks[0]!.track.source.pluginId = 'uninstalled-source'
    document.tracks[0]!.track.source.resourceId = 'no-longer-exists'
    expect(parsePortablePlaylist(JSON.stringify(document)).tracks[0]?.track.source.resourceId).toBe(
      'no-longer-exists',
    )
    document.tracks[0]!.track.source.resourceId = ''
    expect(() => parsePortablePlaylist(JSON.stringify(document))).toThrow(
      'tracks[0].track.source.resourceId',
    )
  })

  it('accepts equivalent JSON recipe objects regardless of their field order', () => {
    const library = fixture()
    const document = exportPortablePlaylist(library, library.playlists[0]!)
    document.customTracks[0]!.recipe = document.customTracks[0]!.recipe.map((segment) => ({
      endMs: segment.endMs,
      startMs: segment.startMs,
      sourceTrackId: segment.sourceTrackId,
    }))
    expect(parsePortablePlaylist(JSON.stringify(document)).customTracks[0]?.recipe).toEqual(
      library.customTracks[0]?.recipe,
    )
  })
})
