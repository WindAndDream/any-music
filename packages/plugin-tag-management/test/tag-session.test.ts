import type { LibraryTrackRecord, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { createTagManagementSession } from '../src/tag-session'

const track: Track = {
  id: 'source:1',
  title: '原曲',
  artists: [{ name: '作者' }],
  sourceTags: ['源标签'],
  source: { pluginId: 'source', resourceId: '1', mediaKind: 'audio' },
}
const record: LibraryTrackRecord = {
  track,
  customTags: [],
  addedAtMs: 1,
  updatedAtMs: 1,
  favoritedAtMs: 1,
}
function fixture(input: unknown = { associations: [] }) {
  let value = structuredClone(input)
  let enabled = true
  const records: LibraryTrackRecord[] = []
  const write = vi.fn((next) => {
    value = structuredClone(next)
  })
  const session = createTagManagementSession({
    read: () => value,
    write,
    changed: vi.fn(),
    isCurrent: () => enabled,
    rememberTracks: (tracks) => {
      for (const item of tracks)
        if (!records.some((existing) => existing.track.id === item.id))
          records.push({ ...record, track: item })
    },
  })
  return {
    session,
    records,
    write,
    value: () => value,
    disable: () => {
      enabled = false
    },
  }
}
describe('feature-owned tag state', () => {
  it('removes selected associations atomically, isolates entity kinds and retains other tags and definitions', () => {
    const f = fixture({
      associations: [
        { trackId: 'a', tags: ['ＦＯＯ', '保留'], updatedAtMs: 1 },
        { trackId: 'b', tags: ['foo'], updatedAtMs: 1 },
        { trackId: 'c', tags: ['foo'], updatedAtMs: 1 },
      ],
      definitions: [{ name: 'foo', updatedAtMs: 1 }],
      playlistAssociations: [
        { playlistId: 'a', tags: ['foo', '歌单标签'] },
        { playlistId: 'p', tags: ['foo'] },
      ],
      future: 'keep',
    })
    expect(f.session.removeTagAssociations('tracks', ['a', 'a', 'b', 'missing'], 'FOO')).toBe(2)
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.session.tagsByTrackId().get('a')).toEqual(['保留'])
    expect(f.session.tagsByTrackId().get('b')).toEqual([])
    expect(f.session.tagsByTrackId().get('c')).toEqual(['foo'])
    expect(f.session.tagsByPlaylistId().get('a')).toEqual(['foo', '歌单标签'])
    expect(f.session.removeTagAssociations('playlists', ['a', 'p'], 'ＦＯＯ')).toBe(2)
    expect(f.write).toHaveBeenCalledTimes(2)
    expect(f.session.tagsByPlaylistId().get('a')).toEqual(['歌单标签'])
    expect(f.session.tagsByPlaylistId().has('p')).toBe(false)
    expect(f.value()).toMatchObject({
      definitions: [{ name: 'foo', updatedAtMs: 1 }],
      future: 'keep',
    })
    expect(f.session.removeTagAssociations('tracks', ['missing', 'a'], 'foo')).toBe(0)
    expect(f.write).toHaveBeenCalledTimes(2)
    f.disable()
    expect(() => f.session.removeTagAssociations('tracks', ['c'], 'foo')).toThrow('停用')
  })

  it('retains all selected associations when a batch commit fails', () => {
    const f = fixture({
      associations: [
        { trackId: 'a', tags: ['标签'] },
        { trackId: 'b', tags: ['标签'] },
      ],
    })
    f.write.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => f.session.removeTagAssociations('tracks', ['a', 'b'], '标签')).toThrow('disk full')
    expect(f.session.tagsByTrackId().get('a')).toEqual(['标签'])
    expect(f.session.tagsByTrackId().get('b')).toEqual(['标签'])
  })
  it('exposes the same complete label set in management and song choices without rewriting stored data', () => {
    const snapshot = {
      definitions: [
        { name: 'FOO', updatedAtMs: 5 },
        { name: '独立', updatedAtMs: 2 },
      ],
      associations: [{ trackId: 'missing-song', tags: ['2223', 'ＦＯＯ'], updatedAtMs: 10 }],
      playlistAssociations: [{ playlistId: 'p', tags: ['歌单专用'] }],
      recentTags: ['2223', '已删除的标签'],
      future: 'keep',
    }
    const f = fixture(snapshot)
    expect(f.session.project([])).toEqual([])
    expect(f.session.tagDefinitions()).toEqual(
      expect.arrayContaining([
        { name: 'FOO', updatedAtMs: 10 },
        { name: '独立', updatedAtMs: 2 },
        { name: '2223', updatedAtMs: 10 },
        { name: '歌单专用', updatedAtMs: 0 },
      ]),
    )
    expect(
      f.session
        .tagDefinitions()
        .map(({ name }) => name)
        .toSorted(),
    ).toEqual(f.session.tagNames().toSorted())
    expect(f.session.tagNames()).not.toContain('已删除的标签')
    expect(f.value()).toEqual(snapshot)
    expect(f.write).not.toHaveBeenCalled()
  })

  it('maintains playlist-only and missing-song labels globally in one commit and keeps them deleted after reload', () => {
    const f = fixture({
      definitions: [{ name: '通勤', updatedAtMs: 1 }],
      associations: [{ trackId: 'missing-song', tags: ['通勤'] }],
      playlistAssociations: [
        { playlistId: 'p', tags: ['2223', '通勤', '保留'] },
        { playlistId: 'q', tags: ['2223'] },
      ],
      future: 'keep',
    })
    expect(f.session.renameTag('２２２３', '改名')).toBe(0)
    expect(f.session.tagsByPlaylistId().get('q')).toEqual(['改名'])
    expect(f.session.tagNames()).not.toContain('2223')
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.session.mergeTags(['通勤', '改名'], '共同')).toBe(1)
    expect(f.session.tagsByTrackId().get('missing-song')).toEqual(['共同'])
    expect(f.session.tagsByPlaylistId().get('p')).toEqual(['保留', '共同'])
    expect(f.session.tagsByPlaylistId().get('q')).toEqual(['共同'])
    expect(f.write).toHaveBeenCalledTimes(2)
    expect(f.session.deleteTags(['共同'])).toBe(1)
    expect(f.session.tagsByPlaylistId().has('q')).toBe(false)
    expect(f.session.tagNames()).toEqual(['保留'])
    expect(f.write).toHaveBeenCalledTimes(3)
    expect(f.value()).toMatchObject({ future: 'keep' })
    const restored = fixture(f.value())
    expect(restored.session.tagNames()).toEqual(['保留'])
    expect(restored.session.tagDefinitions().map(({ name }) => name)).toEqual(['保留'])
    expect(restored.session.deleteTag('保留')).toBe(0)
    expect(restored.session.tagsByPlaylistId().size).toBe(0)
    expect(restored.session.tagNames()).toEqual([])
    expect(f.records).toEqual([])
  })

  it('publishes no song, playlist or directory changes when a global maintenance write fails', () => {
    const f = fixture({
      definitions: [{ name: '通勤', updatedAtMs: 1 }],
      associations: [{ trackId: track.id, tags: ['通勤'] }],
      playlistAssociations: [{ playlistId: 'p', tags: ['通勤', '2223'] }],
    })
    const stored = f.value()
    const directory = f.session.tagDefinitions()
    f.write.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => f.session.mergeTags(['通勤', '2223'], '合并')).toThrow('disk full')
    expect(f.session.tagDefinitions()).toEqual(directory)
    expect(f.session.tagsByTrackId().get(track.id)).toEqual(['通勤'])
    expect(f.session.tagsByPlaylistId().get('p')).toEqual(['通勤', '2223'])
    expect(f.value()).toEqual(stored)
  })

  it('retains exact recent label order across song/playlist edits, maintenance and reload', () => {
    const f = fixture()
    f.session.addTag(track, '旧标签')
    f.session.createTag('独立标签')
    f.session.addTag(track, '新标签')
    f.session.addPlaylistTag('p', '歌单标签')
    expect(f.session.tagNames()).toEqual(['歌单标签', '新标签', '独立标签', '旧标签'])
    f.session.addTag(track, '旧标签') // A duplicate changes neither recency nor persistence.
    expect(f.session.tagNames()).toEqual(['歌单标签', '新标签', '独立标签', '旧标签'])
    f.session.removeTag(track, '新标签')
    expect(f.session.tagNames()).toEqual(['歌单标签', '独立标签', '旧标签'])
    f.session.renameTag('旧标签', '重命名')
    const restored = fixture(f.value())
    expect(restored.session.tagNames()).toEqual(['歌单标签', '独立标签', '重命名'])
    expect(restored.write).not.toHaveBeenCalled()
    restored.session.mergeTags(['独立标签', '重命名'], '合并')
    expect(restored.session.tagNames()).toEqual(['歌单标签', '合并'])
    restored.session.deleteTag('合并')
    expect(restored.session.tagNames()).toEqual(['歌单标签'])
  })
  it('does not advance recent labels on failed writes or accept malformed recent metadata', () => {
    const f = fixture()
    f.session.createTag('已有标签')
    f.write.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect(() => f.session.addTag(track, '未保存')).toThrow('disk full')
    expect(f.session.tagNames()).toEqual(['已有标签'])
    expect(() => fixture({ associations: [], recentTags: {} })).toThrow('原数据已保留')
  })
  it('persists standalone labels without retaining tracks and rejects normalized duplicates', () => {
    const f = fixture({ associations: [{ trackId: track.id, tags: ['通勤'] }], future: 'keep' })
    f.session.createTag('  ＦＯＯ  ')
    expect(f.session.tagDefinitions()).toEqual([
      { name: 'FOO', updatedAtMs: expect.any(Number) },
      { name: '通勤', updatedAtMs: 0 },
    ])
    expect(f.value()).toMatchObject({
      definitions: [{ name: 'FOO', updatedAtMs: expect.any(Number) }],
    })
    expect(f.records).toEqual([])
    expect(f.value()).toMatchObject({ future: 'keep' })
    expect(() => f.session.createTag('foo')).toThrow('已存在重复标签')
    expect(() => f.session.createTag(' 通勤 ')).toThrow('已存在重复标签')
    expect(() => f.session.createTag(' ')).toThrow('不能为空')
    expect(f.write).toHaveBeenCalledTimes(1)
    const restored = fixture(f.value())
    expect(restored.session.tagDefinitions()).toEqual(f.session.tagDefinitions())
    expect(restored.write).not.toHaveBeenCalled()
    f.disable()
    expect(() => f.session.createTag('停用')).toThrow('停用')
    f.session.dispose()
    restored.session.dispose()
  })
  it('renames, merges and deletes standalone labels atomically with song associations', () => {
    const f = fixture({ associations: [{ trackId: track.id, tags: ['通勤'] }] })
    f.session.createTag('现场')
    f.session.renameTag('现场', '夜晚')
    expect(f.session.tagDefinitions().map(({ name }) => name)).toEqual(['夜晚', '通勤'])
    expect(f.session.mergeTags(['通勤', '夜晚'], '收藏')).toBe(1)
    expect(f.session.tagDefinitions().map(({ name }) => name)).toEqual(['收藏'])
    expect(f.session.tagsByTrackId().get(track.id)).toEqual(['收藏'])
    expect(f.session.deleteTag('收藏')).toBe(1)
    expect(f.session.tagDefinitions()).toEqual([])
    expect(f.write).toHaveBeenCalledTimes(4)
    f.session.createTag('空标签')
    expect(f.session.deleteTags(['空标签'])).toBe(0)
    expect(f.session.tagDefinitions()).toEqual([])
  })
  it('does not publish a standalone label when persistence fails', () => {
    const f = fixture()
    f.write.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => f.session.createTag('现场')).toThrow('disk full')
    expect(f.session.tagDefinitions()).toEqual([])
  })
  it('rejects malformed standalone definitions without rewriting the namespace', () => {
    expect(() => fixture({ associations: [], definitions: {} })).toThrow('原数据已保留')
  })
  it('persists playlist tags independently of songs and retains both kinds across writes and reloads', () => {
    const f = fixture({ associations: [], future: 'keep' })
    f.session.addTag(track, '歌曲')
    f.session.addPlaylistTag(track.id, ' 通勤 ')
    f.session.addPlaylistTag(track.id, 'ＴＥＳＴ')
    f.session.addPlaylistTag(track.id, 'test')
    expect(f.session.tagsByPlaylistId().get(track.id)).toEqual(['通勤', 'TEST'])
    expect(f.session.tagsByTrackId().get(track.id)).toEqual(['歌曲'])
    expect(f.write).toHaveBeenCalledTimes(3)
    f.session.addTag(track, '夜晚')
    const restored = fixture(f.value())
    expect(restored.session.tagsByPlaylistId().get(track.id)).toEqual(['通勤', 'TEST'])
    expect(restored.session.tagsByTrackId().get(track.id)).toEqual(['歌曲', '夜晚'])
    expect(restored.value()).toMatchObject({ future: 'keep' })
    restored.session.removePlaylistTag(track.id, 'test')
    restored.session.removePlaylistTag(track.id, '通勤')
    expect(restored.session.tagsByPlaylistId().has(track.id)).toBe(false)
    expect(restored.session.tagsByTrackId().get(track.id)).toEqual(['歌曲', '夜晚'])
    expect(restored.records).toHaveLength(0)
  })
  it('validates playlist labels, rejects stale sessions and publishes only successful writes', () => {
    const f = fixture()
    expect(() => f.session.addPlaylistTag('p', ' ')).toThrow('不能为空')
    expect(() => f.session.addPlaylistTag('p', 'x'.repeat(33))).toThrow()
    f.write.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect(() => f.session.addPlaylistTag('p', '通勤')).toThrow('disk full')
    expect(f.session.tagsByPlaylistId().size).toBe(0)
    f.session.addPlaylistTag('p', '通勤')
    f.disable()
    expect(() => f.session.addPlaylistTag('p', '夜晚')).toThrow('停用')
    expect(() => f.session.removePlaylistTag('p', '通勤')).toThrow('停用')
    expect(f.session.tagsByPlaylistId().get('p')).toEqual(['通勤'])
    expect(() => fixture({ associations: [], playlistAssociations: {} })).toThrow('原数据已保留')
  })
  it('preserves filter history written after the session loaded', () => {
    const f = fixture({ associations: [], filterConditions: ['old'] })
    Object.assign(f.value() as object, { filterConditions: ['new'] })
    f.session.addTag(track, '通勤')
    expect(f.value()).toMatchObject({ filterConditions: ['new'] })
  })
  it('retains canonical tracks, deduplicates batch IDs and synchronizes all derived views in one namespace write', () => {
    const f = fixture()
    expect(f.session.addTags([track, track], ' 通勤 ')).toBe(1)
    expect(f.records).toHaveLength(1)
    expect(f.session.project(f.records)[0]?.customTags).toEqual(['通勤'])
    expect(f.session.project(f.records)[0]?.favoritedAtMs).toBe(1)
    expect(f.write).toHaveBeenCalledTimes(1)
    f.session.addTag(track, '通勤')
    expect(f.write).toHaveBeenCalledTimes(1)
    f.session.removeTag(track, '通勤')
    expect(f.session.project(f.records)[0]?.customTags).toEqual([])
    expect(f.records[0]?.track.sourceTags).toEqual(['源标签'])
  })
  it('renames, merges and deletes globally without changing core records or dropping unknown feature fields', () => {
    const f = fixture({
      associations: [
        { trackId: track.id, tags: ['通勤', '收藏'] },
        { trackId: 'source:2', tags: ['通勤'] },
      ],
      filterConditions: [{ tags: ['通勤'] }],
      future: 'keep',
    })
    expect(f.session.renameTag('通勤', '收藏')).toBe(2)
    expect([...f.session.tagsByTrackId().values()]).toEqual([['收藏'], ['收藏']])
    expect(f.session.deleteTag('收藏')).toBe(2)
    expect(f.value()).toMatchObject({ filterConditions: [{ tags: ['通勤'] }], future: 'keep' })
    expect(record.favoritedAtMs).toBe(1)
    expect(() => f.session.renameTag('absent', ' ')).toThrow('不能为空')
  })
  it('retains data on disable, rejects old controls and never replays writes after a new session', () => {
    const f = fixture()
    f.session.addTag(track, '通勤')
    f.disable()
    expect(() => f.session.addTag(track, '迟到')).toThrow('停用')
    expect(() => f.session.deleteTag('通勤')).toThrow('停用')
    f.session.dispose()
    const restored = fixture(f.value())
    expect(restored.session.tagsByTrackId().get(track.id)).toEqual(['通勤'])
    expect(restored.write).not.toHaveBeenCalled()
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('merges a normalized selection in one commit and preserves unrelated labels and fields', () => {
    const f = fixture({
      associations: [
        { trackId: track.id, tags: ['通勤', '夜晚', '收藏'] },
        { trackId: 'source:2', tags: ['夜晚', 'FOO'] },
        { trackId: 'source:3', tags: ['其他'] },
      ],
      future: 'keep',
    })
    expect(f.session.mergeTags(['通勤', '夜晚', '夜晚'], ' foo ')).toBe(2)
    expect([...f.session.tagsByTrackId().values()]).toEqual([['收藏', 'foo'], ['FOO'], ['其他']])
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.value()).toMatchObject({ future: 'keep' })
    expect(f.session.mergeTags(['absent'], 'foo')).toBe(0)
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('deletes a normalized batch in one commit and rejects invalid merges before saving', () => {
    const f = fixture({
      associations: [
        { trackId: track.id, tags: ['FOO', '夜晚', '收藏'] },
        { trackId: 'source:2', tags: ['foo', '收藏'] },
      ],
    })
    expect(() => f.session.mergeTags(['收藏'], ' ')).toThrow('不能为空')
    expect(f.write).not.toHaveBeenCalled()
    expect(f.session.deleteTags(['ＦＯＯ', '夜晚'])).toBe(2)
    expect([...f.session.tagsByTrackId().values()]).toEqual([['收藏'], ['收藏']])
    expect(f.write).toHaveBeenCalledTimes(1)
    f.disable()
    expect(() => f.session.deleteTags(['收藏'])).toThrow('停用')
    expect(() => f.session.mergeTags(['收藏'], '迟到')).toThrow('停用')
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('does not publish uncommitted state after a failed write', () => {
    const f = fixture()
    f.write.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => f.session.addTag(track, '通勤')).toThrow('disk full')
    expect(f.session.tagsByTrackId().get(track.id)).toBeUndefined()
  })
})
