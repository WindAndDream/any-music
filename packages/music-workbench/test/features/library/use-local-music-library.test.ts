import type { LibraryTrackRecord, LocalMusicLibrarySnapshot, Track } from '@any-music/core'
import { createEmptyLocalMusicLibrary, MAX_PLAYBACK_HISTORY_LIMIT } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useLocalMusicLibrary } from '#workbench/features/library/use-local-music-library'
import { usePlaybackQueue } from '#workbench/features/player/use-playback-queue'

const repositoryMock = vi.hoisted(() => ({
  load: vi.fn<() => LocalMusicLibrarySnapshot>(),
  save: vi.fn(),
}))

vi.mock('#workbench/storage/local-music-library-repository', () => ({
  localMusicLibraryRepository: repositoryMock,
}))
vi.mock('#workbench/storage/playback-queue-repository', () => ({
  playbackQueueRepository: {
    load: () => ({ schemaVersion: 1, trackIds: [], mode: 'sequence' }),
    save: vi.fn(),
  },
}))

describe('useLocalMusicLibrary favorites', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
    })
    repositoryMock.load.mockReset()
    repositoryMock.save.mockReset()
    repositoryMock.load.mockReturnValue(createEmptyLocalMusicLibrary())
  })

  it('repairs a saved favorite duration without replacing playback or losing user metadata', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track: Track = {
      ...createTrack('bilibili'),
      durationMs: 43_200_000,
      source: { pluginId: 'bilibili', mediaKind: 'video', resourceId: 'BV1xx411c7mD', partId: '1' },
    }
    library.favoriteTrack(track)
    library.renameTrack(track, '我的纯音乐')
    const playlist = library.createPlaylist('纯音乐')
    library.addTracksToPlaylist(playlist.id, [track])
    const before = library.records.value[0]!
    const queue = usePlaybackQueue({ resolveTrack: library.getTrack })
    queue.playTracks([track], track.id)
    const historyId = library.beginHistory(track)

    library.updateTrackDuration(track.id, 253_000)
    library.updateHistory(historyId, 1_000, 253_000)
    expect(library.favoriteRecords.value[0]).toEqual({
      ...before,
      track: { ...track, durationMs: 253_000 },
      updatedAtMs: Date.now(),
    })
    expect(library.playlists.value[0]!.trackIds).toEqual([track.id])
    expect(library.history.value).toHaveLength(1)
    expect(library.history.value[0]).toMatchObject({ id: historyId, durationMs: 253_000 })
    expect(queue.currentTrack.value).toBe(track)
    expect(track.durationMs).toBe(43_200_000)
    const repaired = library.records.value
    for (const duration of [undefined, 0, -1, NaN, Infinity, 253_000]) {
      library.updateTrackDuration(track.id, duration)
    }
    library.updateTrackDuration('missing', 123_000)
    expect(library.records.value).toBe(repaired)
    vi.advanceTimersByTime(1_000)
    const saved = repositoryMock.save.mock.lastCall![0] as LocalMusicLibrarySnapshot
    expect(saved.tracks[0]!.track.durationMs).toBe(253_000)
    scope.stop()

    repositoryMock.load.mockReturnValue(saved)
    const restoredScope = effectScope()
    const restored = restoredScope.run(useLocalMusicLibrary)!
    expect(restored.favoriteRecords.value[0]!.track.durationMs).toBe(253_000)
    expect(restored.customNamesByTrackId.value.get(track.id)).toBe('我的纯音乐')
    restoredScope.stop()
  })

  it('keeps custom-track duration owned by the recipe rather than playback metadata', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track: Track = {
      ...createTrack(),
      source: { pluginId: 'custom', mediaKind: 'custom', resourceId: 'custom:1' },
    }
    library.rememberTracks([track])
    const records = library.records.value
    library.updateTrackDuration(track.id, 253_000)
    expect(library.records.value).toBe(records)
    expect(library.getTrack(track.id)!.durationMs).toBe(track.durationMs)
    scope.stop()
  })

  it('keeps one custom name per stable ID through source refresh, favorites and reload', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track = createTrack('bilibili')
    const other = createTrack('douyin')
    const part = { ...track, id: `${track.id}:part:2`, source: { ...track.source, partId: '2' } }
    library.renameTrack(track, '  通勤  Ａ  ')
    expect(library.customNamesByTrackId.value.get(track.id)).toBe('通勤 A')
    expect(library.getTrack(track.id)).toBe(track)
    expect(track.title).toBe('测试歌曲')
    expect(repositoryMock.save.mock.lastCall?.[0].tracks[0].customName).toBe('通勤 A')
    library.rememberTracks([{ ...track, title: '更新后的来源标题' }, other, part])
    library.favoriteTrack(track)
    const playlist = library.createPlaylist('我的歌单')
    library.addTracksToPlaylist(playlist.id, [track])
    expect(library.records.value).toHaveLength(3)
    expect(library.favoriteRecords.value[0]?.customName).toBe('通勤 A')
    expect(library.customNamesByTrackId.value.has(other.id)).toBe(false)
    expect(library.customNamesByTrackId.value.has(part.id)).toBe(false)
    scope.stop()
    repositoryMock.load.mockReturnValue(repositoryMock.save.mock.lastCall?.[0])
    const restoredScope = effectScope()
    const restored = restoredScope.run(useLocalMusicLibrary)!
    expect(restored.customNamesByTrackId.value.get(track.id)).toBe('通勤 A')
    restored.renameTrack(track, '夜晚')
    expect(restored.records.value.filter((record) => record.track.id === track.id)).toHaveLength(1)
    restored.renameTrack(track, '  ')
    expect(restored.customNamesByTrackId.value.has(track.id)).toBe(false)
    expect(restored.favoriteTrackIds.value.has(track.id)).toBe(true)
    expect(restored.playlists.value[0]?.trackIds).toEqual([track.id])
    restoredScope.stop()
  })

  it('rejects normalized duplicate names and updates playlist metadata atomically', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const first = library.createPlaylist('  Ｍｉｘ  ')
    const second = library.createPlaylist('夜晚')
    expect(first.name).toBe('Mix')
    expect(() => library.createPlaylist(' mix ')).toThrow(/同名/)
    expect(() => library.renamePlaylist(second.id, 'ＭＩＸ')).toThrow(/同名/)
    expect(() => library.updatePlaylistDetails(second.id, 'Mix', '不应保存')).toThrow(/同名/)
    expect(library.playlists.value[1]?.description).toBeUndefined()
    library.renamePlaylist(first.id, 'MIX')
    const coverId = 'playlist-cover:11111111-1111-4111-8111-111111111111'
    library.updatePlaylistDetails(first.id, 'MIX', '  早晨  ', coverId)
    expect(repositoryMock.save.mock.lastCall?.[0].playlists[0]).toMatchObject({
      name: 'MIX',
      description: '早晨',
      coverId,
    })
    expect(() => library.updatePlaylistDetails(first.id, '新名称', '长'.repeat(501))).toThrow(/500/)
    expect(library.playlists.value[0]?.name).toBe('MIX')
    library.updatePlaylistDetails(first.id, 'MIX', '')
    expect(library.playlists.value[0]?.coverId).toBeUndefined()
    scope.stop()
  })

  it('imports once per transaction with a fresh playlist ID and unique name, preserving local identity and favorites', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track = createTrack()
    library.favoriteTrack(track)
    library.renameTrack(track, '本机名称')
    library.createPlaylist('Mix')
    const candidate = {
      ...createEmptyLocalMusicLibrary({ id: 'other-user', displayName: '另一用户' }),
      tracks: [{ track, customName: '文件名称', customTags: [], addedAtMs: 1, updatedAtMs: 1 }],
      playlists: [
        { id: 'remote', name: ' mix ', trackIds: [track.id], createdAtMs: 5, updatedAtMs: 6 },
      ],
    }
    repositoryMock.save.mockClear()
    library.importPlaylist(candidate)
    expect(repositoryMock.save).toHaveBeenCalledOnce()
    expect(library.playlists.value[1]).toMatchObject({
      name: 'mix (2)',
      trackIds: [track.id],
      createdAtMs: 5,
    })
    expect(library.playlists.value[1]?.id).not.toBe('remote')
    expect(library.favoriteTrackIds.value.has(track.id)).toBe(true)
    expect(library.customNamesByTrackId.value.get(track.id)).toBe('本机名称')
    expect(library.profile.value.id).not.toBe('other-user')
    scope.stop()
  })

  it('keeps all reactive state unchanged when importing fails to save, then allows retry', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track = createTrack()
    const candidate = {
      ...createEmptyLocalMusicLibrary(),
      tracks: [{ track, customTags: [], addedAtMs: 1, updatedAtMs: 1 }],
      playlists: [
        { id: 'remote', name: 'Mix', trackIds: [track.id], createdAtMs: 5, updatedAtMs: 6 },
      ],
    }
    repositoryMock.save.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect(() => library.importPlaylist(candidate)).toThrow(/保存失败/)
    expect(library.records.value).toEqual([])
    expect(library.playlists.value).toEqual([])
    expect(library.getTrack(track.id)).toBeUndefined()
    library.importPlaylist(candidate)
    expect(library.playlists.value).toHaveLength(1)
    expect(library.records.value).toHaveLength(1)
    scope.stop()
  })

  it('persists playlist descriptions and reorders only known playlists', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const first = library.createPlaylist('早晨', '  温柔的歌  ')
    const second = library.createPlaylist('夜晚')
    library.updatePlaylistDescription(second.id, '安静')
    library.reorderPlaylists([second.id, second.id, 'missing'])
    library.persistNow()
    expect(library.playlists.value.map(({ id }) => id)).toEqual([second.id, first.id])
    expect(
      repositoryMock.save.mock.lastCall?.[0].playlists.map(
        ({ description }: { description?: string }) => description,
      ),
    ).toEqual(['安静', '温柔的歌'])
    expect(() => library.updatePlaylistDescription(first.id, '长'.repeat(501))).toThrow(/500/)
    scope.stop()
  })

  it('removes a playlist batch in one snapshot while retaining songs, favorites and other memberships', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track = createTrack()
    library.favoriteTrack(track)
    const first = library.createPlaylist('First')
    const second = library.createPlaylist('Second')
    const kept = library.createPlaylist('Kept')
    for (const playlist of [first, second, kept]) library.addTracksToPlaylist(playlist.id, [track])
    library.persistNow()
    repositoryMock.save.mockClear()
    library.deletePlaylist([first.id, second.id, first.id, 'missing'])
    library.persistNow()
    expect(repositoryMock.save).toHaveBeenCalledTimes(1)
    expect(library.playlists.value.map(({ id }) => id)).toEqual([kept.id])
    expect(library.playlists.value[0]?.trackIds).toEqual([track.id])
    expect(library.favoriteTrackIds.value.has(track.id)).toBe(true)
    expect(library.getTrack(track.id)).toBeDefined()
    repositoryMock.save.mockClear()
    library.deletePlaylist(['missing'])
    vi.runAllTimers()
    expect(repositoryMock.save).not.toHaveBeenCalled()
    scope.stop()
  })

  it('rejects invalid custom names without altering records or saving a snapshot', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track = createTrack()
    expect(() => library.renameTrack(track, '长'.repeat(81))).toThrow(/80/)
    expect(library.records.value).toEqual([])
    expect(repositoryMock.save).not.toHaveBeenCalled()
    library.renameTrack(track, '名'.repeat(80))
    expect(library.customNamesByTrackId.value.get(track.id)).toHaveLength(80)
    scope.stop()
  })

  it('restores mixed and duplicate selections in one write while preserving library relationships', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track = createTrack('bilibili')
    const original = createTrack('douyin')
    library.favoriteTrack(track)
    const playlist = library.createPlaylist('歌单')
    library.addTracksToPlaylist(playlist.id, [track])
    library.renameTrack(track, '通勤音乐')
    library.rememberTracks([original])
    const originalRecord = library.records.value.find((record) => record.track.id === original.id)
    repositoryMock.save.mockClear()
    expect(library.restoreTrackNames([track.id, track.id, original.id, 'missing'])).toBe(1)
    expect(repositoryMock.save).toHaveBeenCalledOnce()
    expect(library.records.value.find((record) => record.track.id === original.id)).toBe(
      originalRecord,
    )
    expect(library.customNamesByTrackId.value.has(track.id)).toBe(false)
    expect(library.favoriteTrackIds.value.has(track.id)).toBe(true)
    expect(library.playlists.value[0]?.trackIds).toEqual([track.id])
    expect(library.getTrack(track.id)?.title).toBe('测试歌曲')
    expect(library.restoreTrackNames([track.id, original.id])).toBe(0)
    expect(repositoryMock.save).toHaveBeenCalledOnce()
    expect(library.restoreTrackNames([])).toBe(0)
    scope.stop()
  })

  it('restores persisted favorite membership from the initial snapshot', () => {
    const track = createTrack()
    repositoryMock.load.mockReturnValue({
      ...createEmptyLocalMusicLibrary(),
      tracks: [
        {
          track,
          customTags: [],
          favoritedAtMs: 123,
          addedAtMs: 100,
          updatedAtMs: 123,
        },
      ],
    })
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!

    expect(library.favoriteTrackIds.value.has(track.id)).toBe(true)
    expect(library.favoriteRecords.value[0]?.favoritedAtMs).toBe(123)
    scope.stop()
  })

  it('persists a configurable history limit and immediately removes the oldest overflow', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const track = createTrack()
    library.rememberTracks([track])
    const firstId = library.beginHistory(track)
    const secondId = library.beginHistory(track)
    const thirdId = library.beginHistory(track)

    library.setHistoryLimit(2)

    expect(library.historyLimit.value).toBe(2)
    expect(library.history.value.map((entry) => entry.id)).toEqual([thirdId, secondId])
    expect(library.history.value.some((entry) => entry.id === firstId)).toBe(false)
    expect(repositoryMock.save.mock.lastCall?.[0].settings).toEqual({ historyLimit: 2 })
    expect(() => library.setHistoryLimit(MAX_PLAYBACK_HISTORY_LIMIT + 1)).toThrowError(/1 到 500/)
    expect(() => library.setHistoryLimit(0)).toThrowError(/1 到 500/)
    scope.stop()
  })

  it('removes only the favorite membership and retains the library record', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    library.favoriteTrack(createTrack())

    library.unfavoriteTrack('test:audio:1')

    expect(library.favoriteRecords.value).toEqual([])
    expect(library.getTrack('test:audio:1')).toBeDefined()
    expect(repositoryMock.save.mock.lastCall?.[0].tracks[0]?.favoritedAtMs).toBeUndefined()
    scope.stop()
  })

  it('removes multiple favorite memberships with one persistence write', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const firstTrack = createTrack('bilibili')
    const secondTrack = createTrack('douyin')
    library.favoriteTracks([firstTrack, secondTrack])
    repositoryMock.save.mockClear()

    expect(
      library.unfavoriteTracks([firstTrack.id, secondTrack.id, firstTrack.id, 'missing']),
    ).toBe(2)

    expect(library.favoriteRecords.value).toEqual([])
    expect(library.getTrack(firstTrack.id)).toEqual(firstTrack)
    expect(library.getTrack(secondTrack.id)).toEqual(secondTrack)
    expect(repositoryMock.save).toHaveBeenCalledTimes(1)
    expect(
      repositoryMock.save.mock.lastCall?.[0].tracks.every(
        (record: LibraryTrackRecord) => record.favoritedAtMs === undefined,
      ),
    ).toBe(true)
    scope.stop()
  })

  it('creates a playlist and atomically remembers selected catalog tracks', () => {
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const firstTrack = createTrack('bilibili')
    const secondTrack = {
      ...createTrack('douyin'),
      id: 'douyin:audio:2',
      source: { pluginId: 'douyin', mediaKind: 'audio' as const, resourceId: '2' },
    }
    const playlist = library.createPlaylist('通勤歌单')

    expect(library.addTracksToPlaylist(playlist.id, [firstTrack, secondTrack])).toBe(2)
    expect(library.addTracksToPlaylist(playlist.id, [firstTrack])).toBe(0)
    expect(library.playlists.value[0]?.trackIds).toEqual([firstTrack.id, secondTrack.id])
    expect(library.getTrack(firstTrack.id)).toEqual(firstTrack)
    expect(repositoryMock.save.mock.lastCall?.[0].playlists[0]?.trackIds).toEqual([
      firstTrack.id,
      secondTrack.id,
    ])

    library.removeFromPlaylist(playlist.id, firstTrack.id)
    expect(library.playlists.value[0]?.trackIds).toEqual([secondTrack.id])
    expect(library.getTrack(firstTrack.id)).toBeDefined()
    scope.stop()
  })

  it('stores a stable creator separately from cross-platform source credits', () => {
    repositoryMock.load.mockReturnValue(
      createEmptyLocalMusicLibrary({ id: 'local-user:42', displayName: '风' }),
    )
    const scope = effectScope()
    const library = scope.run(useLocalMusicLibrary)!
    const bilibiliTrack = createTrack('bilibili', 'up-1', '山海 UP')
    const douyinTrack = createTrack('douyin', 'user-2', '星光博主')
    library.rememberTracks([bilibiliTrack, douyinTrack])

    const customTrack = library.publishCustomTrack('跨站拼接', [
      { sourceTrackId: bilibiliTrack.id, startMs: 0, endMs: 1_000 },
      { sourceTrackId: douyinTrack.id, startMs: 0, endMs: 1_000 },
    ])

    expect(customTrack.artists).toEqual([{ id: 'local-user:42', name: '风' }])
    expect(library.getCustomTrack(customTrack.id)?.sourceCredits).toEqual([
      { pluginId: 'bilibili', artistId: 'up-1', artistName: '山海 UP' },
      { pluginId: 'douyin', artistId: 'user-2', artistName: '星光博主' },
    ])

    library.updateLocalUserDisplayName('新名字')
    expect(library.profile.value).toEqual({ id: 'local-user:42', displayName: '新名字' })
    expect(library.getTrack(customTrack.id)?.artists).toEqual([
      { id: 'local-user:42', name: '新名字' },
    ])
    scope.stop()
  })
})

function createTrack(pluginId = 'test', artistId?: string, artistName = '测试博主'): Track {
  return {
    id: `${pluginId}:audio:1`,
    title: '测试歌曲',
    artists: [{ id: artistId, name: artistName }],
    durationMs: 10_000,
    source: { pluginId, mediaKind: 'audio', resourceId: '1' },
  }
}
