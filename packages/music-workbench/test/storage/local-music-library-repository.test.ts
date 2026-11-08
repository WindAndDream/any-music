import { readFileSync } from 'node:fs'

import { LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION, MAX_PLAYBACK_HISTORY_LIMIT } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readStored, writeStored } from '#workbench/runtime/storage'

vi.mock('#workbench/runtime/storage', () => ({
  readStored: vi.fn(),
  writeStored: vi.fn(),
}))

import {
  localMusicLibraryRepository,
  sanitizeLocalMusicLibrarySnapshot,
} from '#workbench/storage/local-music-library-repository'

function readLibraryFixture(): unknown {
  return JSON.parse(
    readFileSync(new URL('../fixtures/storage/local-library-v6.json', import.meta.url), 'utf8'),
  )
}

describe('current saved library', () => {
  it('restores bounded public acquisition provenance and drops malformed metadata only', () => {
    const record = createTrackRecord('first', '歌曲', 'audio', '1')
    const acquisition = {
      accountId: '11111111-1111-4111-8111-111111111111',
      accountName: '添加时名称',
      acquiredAtMs: 123,
    }
    const restore = (value: unknown) =>
      sanitizeLocalMusicLibrarySnapshot({
        ...createCurrentSnapshotBase(),
        tracks: [{ ...record, track: { ...record.track, acquisition: value } }],
      })
    expect(restore(acquisition).tracks[0]?.track.acquisition).toEqual(acquisition)
    for (const invalid of [
      { ...acquisition, accountId: '../vault' },
      { ...acquisition, accountName: '名'.repeat(81) },
      { ...acquisition, acquiredAtMs: -1 },
    ]) {
      expect(restore(invalid).tracks).toHaveLength(1)
      expect(restore(invalid).tracks[0]?.track.acquisition).toBeUndefined()
    }
  })
  it('persists only stable uploaded-cover references and rejects inline bytes or URLs', () => {
    const playlist = { id: 'p', name: '歌单', trackIds: [], createdAtMs: 1, updatedAtMs: 1 }
    const restore = (coverId: string) =>
      sanitizeLocalMusicLibrarySnapshot({
        ...createCurrentSnapshotBase(),
        playlists: [{ ...playlist, coverId }],
      }).playlists[0]
    const id = 'playlist-cover:11111111-1111-4111-8111-111111111111'
    expect(restore(id)?.coverId).toBe(id)
    for (const invalid of [
      'data:image/jpeg;base64,AAAA',
      'blob:local-cover',
      'https://example.com/cover.jpg',
    ])
      expect(restore(invalid)?.coverId).toBeUndefined()
  })

  it('restores bounded playlist descriptions without discarding the playlist', () => {
    const playlist = { id: 'p', name: '歌单', trackIds: [], createdAtMs: 1, updatedAtMs: 1 }
    const restore = (description: unknown) =>
      sanitizeLocalMusicLibrarySnapshot({
        ...createCurrentSnapshotBase(),
        playlists: [{ ...playlist, description }],
      }).playlists[0]
    expect(restore('  自定义简介  ')?.description).toBe('自定义简介')
    expect(restore('长'.repeat(501))?.description).toBeUndefined()
    expect(restore({ text: 'invalid' })?.id).toBe('p')
  })
  it('restores stable records, ordering, creator identity and compiled recipes', () => {
    const input = readLibraryFixture()
    const original = JSON.stringify(input)
    const library = sanitizeLocalMusicLibrarySnapshot(input)
    expect(library.schemaVersion).toBe(LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION)
    expect(library.tracks.map(({ track }) => track.id)).toEqual([
      'fixture:audio:a',
      'fixture:audio:b',
      'local:custom:mix',
    ])
    expect(library.playlists[0]?.trackIds).toEqual([
      'local:custom:mix',
      'fixture:audio:b',
      'fixture:audio:a',
    ])
    expect(library.customTracks[0]?.compiledSegments).toHaveLength(2)
    expect(library.profile.id).toBe('local-user:fixture')
    expect(library.tracks[0]?.customTags).toEqual([])
    expect(sanitizeLocalMusicLibrarySnapshot(library)).toEqual(library)
    expect(JSON.stringify(input)).toBe(original)
  })
})

describe('sanitizeLocalMusicLibrarySnapshot', () => {
  beforeEach(() => {
    vi.mocked(readStored).mockReset()
    vi.mocked(writeStored).mockReset()
  })

  it('restores optional custom names while isolating malformed names from valid library records', () => {
    const snapshot = sanitizeLocalMusicLibrarySnapshot({
      ...createCurrentSnapshotBase(),
      tracks: [
        { ...createTrackRecord('first', '原曲', 'audio', '1'), customName: '  Ａ  名称 ' },
        { ...createTrackRecord('long', '原曲', 'audio', '2'), customName: '名'.repeat(81) },
        { ...createTrackRecord('invalid', '原曲', 'audio', '3'), customName: { title: '错误' } },
        createTrackRecord('legacy', '旧歌曲', 'audio', '4'),
      ],
    })
    expect(snapshot.tracks).toHaveLength(4)
    expect(snapshot.tracks.map((record) => record.customName)).toEqual([
      'A 名称',
      undefined,
      undefined,
      undefined,
    ])
    expect(snapshot.tracks.map((record) => record.track.title)).toEqual([
      '原曲',
      '原曲',
      '原曲',
      '旧歌曲',
    ])
  })

  it('reads and writes the production Userscript storage namespace', () => {
    const snapshot = sanitizeLocalMusicLibrarySnapshot(createCurrentSnapshotBase())
    vi.mocked(readStored).mockReturnValue(snapshot)

    expect(localMusicLibraryRepository.load()).toEqual(snapshot)
    expect(readStored).toHaveBeenCalledWith('local-library:v1', undefined)

    localMusicLibraryRepository.save(snapshot)
    expect(writeStored).toHaveBeenCalledWith('local-library:v1', snapshot)
  })

  it('sanitizes the history setting and trims history to valid newest records', () => {
    const track = createTrackRecord('test:audio:leaf', '叶子歌曲', 'audio', 'leaf')
    const snapshot = sanitizeLocalMusicLibrarySnapshot({
      ...createCurrentSnapshotBase(),
      settings: { historyLimit: 2 },
      tracks: [track],
      history: [
        createHistoryEntry('history:3', track.track.id, 3),
        createHistoryEntry('history:2', track.track.id, 2),
        createHistoryEntry('history:missing', 'missing:audio:track', 2),
        createHistoryEntry('history:1', track.track.id, 1),
      ],
    })

    expect(snapshot.settings).toEqual({ historyLimit: 2 })
    expect(snapshot.history.map((entry) => entry.id)).toEqual(['history:3', 'history:2'])

    const oversized = sanitizeLocalMusicLibrarySnapshot({
      ...createCurrentSnapshotBase(),
      settings: { historyLimit: MAX_PLAYBACK_HISTORY_LIMIT + 1 },
    })
    expect(oversized.settings.historyLimit).toBe(MAX_PLAYBACK_HISTORY_LIMIT)
  })
})

function createCurrentSnapshotBase() {
  return {
    schemaVersion: LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
    profile: { id: 'local-user:1', displayName: '测试用户' },
    settings: { historyLimit: MAX_PLAYBACK_HISTORY_LIMIT },
    tracks: [],
    playlists: [],
    history: [],
    customTracks: [],
  }
}

function createHistoryEntry(id: string, trackId: string, startedAtMs: number) {
  return {
    id,
    trackId,
    startedAtMs,
    updatedAtMs: startedAtMs,
    positionMs: 0,
    completed: false,
  }
}

function createTrackRecord(
  id: string,
  title: string,
  mediaKind: 'audio' | 'custom',
  resourceId: string,
) {
  return {
    track: {
      id,
      title,
      artists: [{ name: '作者' }],
      durationMs: 10_000,
      source: { pluginId: mediaKind === 'custom' ? 'local-custom' : 'test', mediaKind, resourceId },
    },
    customTags: [],
    addedAtMs: 1,
    updatedAtMs: 1,
  }
}
