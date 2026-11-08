import type { Track } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_PLAYBACK_QUEUE_ITEM_COUNT } from '#workbench/features/player/playback-queue-state'
import { usePlaybackQueue } from '#workbench/features/player/use-playback-queue'

const repositoryMock = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}))

vi.mock('#workbench/storage/playback-queue-repository', () => ({
  playbackQueueRepository: repositoryMock,
}))

describe('usePlaybackQueue persistence', () => {
  const tracks = new Map(['one', 'two', 'three'].map((id) => [id, createTrack(id)]))

  beforeEach(() => {
    repositoryMock.load.mockReset()
    repositoryMock.save.mockReset()
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['two', 'missing', 'one'],
      mode: 'shuffle-no-repeat',
    })
  })

  it('restores queue order through the canonical library resolver', () => {
    const queue = usePlaybackQueue({ resolveTrack: (trackId) => tracks.get(trackId) })

    expect(queue.items.value.map((track) => track.id)).toEqual(['two', 'one'])
    expect(queue.mode.value).toBe('shuffle-no-repeat')
    expect(queue.currentTrack.value).toBeUndefined()
  })

  it('appends a deduplicated batch in selection order and saves once, including platform mode', () => {
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['one'],
      mode: 'sequence',
      arrangementMode: 'platform',
      addedAtMsByTrackId: { one: 10 },
    })
    const queue = usePlaybackQueue({ resolveTrack: (id) => tracks.get(id), now: () => 20 })
    queue.select('one')
    expect(
      queue.addMany([
        tracks.get('three')!,
        tracks.get('one')!,
        tracks.get('two')!,
        tracks.get('three')!,
      ]),
    ).toBe(2)
    expect(queue.items.value.map((track) => track.id)).toEqual(['one', 'three', 'two'])
    expect(queue.arrangementMode.value).toBe('flat')
    expect(queue.currentTrackId.value).toBe('one')
    queue.next()
    expect(queue.currentTrackId.value).toBe('three')
    expect(repositoryMock.save).toHaveBeenCalledExactlyOnceWith({
      schemaVersion: 1,
      trackIds: ['one', 'three', 'two'],
      mode: 'sequence',
      arrangementMode: 'flat',
      addedAtMsByTrackId: { one: 10, three: 20, two: 20 },
    })
    expect(queue.addMany([tracks.get('two')!])).toBe(0)
    expect(repositoryMock.save).toHaveBeenCalledOnce()
  })

  it('rejects an over-limit batch without partial additions or arrangement changes', () => {
    const queue = usePlaybackQueue({ resolveTrack: (id) => tracks.get(id) })
    const before = queue.items.value
    expect(
      queue.addMany(
        Array.from({ length: MAX_PLAYBACK_QUEUE_ITEM_COUNT }, (_, index) =>
          createTrack(`new:${index}`),
        ),
      ),
    ).toBe(0)
    expect(queue.items.value).toEqual(before)
    expect(queue.persistenceErrorState.value?.code).toBe('limit-exceeded')
    expect(repositoryMock.save).not.toHaveBeenCalled()
  })

  it('keeps a collection playback context intact while appending a queue batch', () => {
    const queue = usePlaybackQueue({ resolveTrack: (id) => tracks.get(id) })
    queue.playTracks([tracks.get('one')!, tracks.get('two')!], 'one')
    queue.addMany([tracks.get('three')!])
    expect(queue.currentTrackId.value).toBe('one')
    queue.next()
    expect(queue.currentTrackId.value).toBe('two')
    expect(queue.trackIds.value.has('three')).toBe(true)
  })

  it('retries failed persistence of an already-added batch without duplicating or retimestamping it', () => {
    const queue = usePlaybackQueue({ resolveTrack: (id) => tracks.get(id), now: () => 20 })
    repositoryMock.save.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    queue.addMany([tracks.get('three')!])
    expect(queue.persistenceErrorState.value?.code).toBe('storage-write-failed')
    expect(queue.addMany([tracks.get('three')!])).toBe(0)
    expect(queue.persistenceErrorState.value).toBeUndefined()
    expect(queue.items.value.map((track) => track.id)).toEqual(['two', 'one', 'three'])
    expect(queue.addedAtMsByTrackId.value.get('three')).toBe(20)
    expect(repositoryMock.save).toHaveBeenCalledTimes(2)
  })

  it('immediately persists additions, reordering and playback mode', () => {
    const queue = usePlaybackQueue({
      resolveTrack: (trackId) => tracks.get(trackId),
      now: () => 123,
    })

    queue.add(tracks.get('three')!)
    queue.pin('three')
    queue.setMode('sequence')

    expect(repositoryMock.save).toHaveBeenCalledTimes(3)
    expect(repositoryMock.save.mock.lastCall?.[0]).toEqual({
      schemaVersion: 1,
      trackIds: ['three', 'two', 'one'],
      mode: 'sequence',
      arrangementMode: 'flat',
      addedAtMsByTrackId: { three: 123 },
    })
  })

  it('plays a library collection in its visible order without replacing listen-later items', () => {
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['two', 'one'],
      mode: 'sequence',
      arrangementMode: 'flat',
    })
    const queue = usePlaybackQueue({ resolveTrack: (trackId) => tracks.get(trackId) })

    queue.playTracks([tracks.get('three')!, tracks.get('one')!], 'three')
    queue.next()

    expect(queue.currentTrack.value?.id).toBe('one')
    expect(queue.items.value.map((track) => track.id)).toEqual(['two', 'one'])
    expect(repositoryMock.save).not.toHaveBeenCalled()

    queue.select('two')

    expect(queue.currentTrack.value?.id).toBe('two')
  })

  it('preserves hidden positions, actual next-track order, and saves a filtered move once', () => {
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['one', 'two', 'three'],
      mode: 'sequence',
    })
    const queue = usePlaybackQueue({ resolveTrack: (id) => tracks.get(id) })
    queue.move('three', 'one', ['one', 'three'])
    expect(queue.items.value.map((track) => track.id)).toEqual(['three', 'two', 'one'])
    queue.select('three')
    queue.next()
    expect(queue.currentTrackId.value).toBe('two')
    expect(repositoryMock.save).toHaveBeenCalledTimes(1)
    queue.pin('one', ['three', 'one'])
    expect(queue.items.value.map((track) => track.id)).toEqual(['one', 'two', 'three'])
    queue.move('one', 'two', ['one', 'three'])
    expect(repositoryMock.save).toHaveBeenCalledTimes(2)
  })

  it('keeps queue addition time through reordering and duplicate adds, and renews it on re-add', () => {
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['one', 'two'],
      mode: 'sequence',
      addedAtMsByTrackId: { one: 10 },
    })
    let now = 20
    const queue = usePlaybackQueue({ resolveTrack: (id) => tracks.get(id), now: () => now })
    expect(queue.addedAtMsByTrackId.value.get('two')).toBeUndefined()
    queue.add(tracks.get('one')!)
    queue.add(tracks.get('three')!)
    queue.move('three', 'one')
    expect([...queue.addedAtMsByTrackId.value]).toEqual([
      ['one', 10],
      ['three', 20],
    ])
    queue.remove('three')
    expect(queue.addedAtMsByTrackId.value.has('three')).toBe(false)
    now = 30
    queue.add(tracks.get('three')!)
    expect(repositoryMock.save.mock.lastCall?.[0].addedAtMsByTrackId).toEqual({
      one: 10,
      three: 30,
    })
    repositoryMock.load.mockReturnValue(repositoryMock.save.mock.lastCall?.[0])
    const restored = usePlaybackQueue({ resolveTrack: (id) => tracks.get(id) })
    expect(restored.addedAtMsByTrackId.value.get('three')).toBe(30)
  })

  it('moves only matching platform slots while retaining complete blocks and group-internal order', () => {
    const grouped = new Map(
      ['a1', 'a2', 'b1', 'c1', 'c2'].map((id) => [id, createPlatformTrack(id, id[0]!)]),
    )
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: [...grouped.keys()],
      mode: 'sequence',
      arrangementMode: 'platform',
    })
    const queue = usePlaybackQueue({ resolveTrack: (id) => grouped.get(id) })
    queue.movePlatform('c', 'a', ['a', 'c'])
    expect(queue.items.value.map((track) => track.id)).toEqual(['c1', 'c2', 'b1', 'a1', 'a2'])
    queue.move('c2', 'c1', ['c1', 'c2', 'a1'])
    expect(queue.items.value.map((track) => track.id)).toEqual(['c2', 'c1', 'b1', 'a1', 'a2'])
    queue.move('c2', 'a1', ['c2', 'a1'])
    expect(repositoryMock.save).toHaveBeenCalledTimes(2)
  })

  it('removes selected queue tracks in one save and advances after removing the current track', () => {
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['one', 'two', 'three'],
      mode: 'sequence',
    })
    const queue = usePlaybackQueue({ resolveTrack: (trackId) => tracks.get(trackId) })
    queue.select('two')

    queue.removeMany(['two', 'three'])

    expect(queue.items.value.map((track) => track.id)).toEqual(['one'])
    expect(queue.currentTrack.value?.id).toBe('one')
    expect(repositoryMock.save).toHaveBeenCalledTimes(1)
    expect(repositoryMock.save).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      trackIds: ['one'],
      mode: 'sequence',
      arrangementMode: 'flat',
      addedAtMsByTrackId: {},
    })
  })

  it('does not repeat a collection track before a shuffle round is exhausted', () => {
    const queue = usePlaybackQueue({
      resolveTrack: (trackId) => tracks.get(trackId),
      random: () => 0,
    })

    queue.playTracks([...tracks.values()], 'one')
    queue.next()
    const firstRandomId = queue.currentTrack.value?.id
    queue.next()
    const secondRandomId = queue.currentTrack.value?.id

    expect(new Set([firstRandomId, secondRandomId])).toEqual(new Set(['two', 'three']))
  })

  it('groups the real playback sequence and moves whole platforms without scrambling tracks within them', () => {
    const groupedTracks = new Map([
      ['a1', createPlatformTrack('a1', 'a')],
      ['b1', createPlatformTrack('b1', 'b')],
      ['a2', createPlatformTrack('a2', 'a')],
      ['b2', createPlatformTrack('b2', 'b')],
    ])
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: [...groupedTracks.keys()],
      mode: 'sequence',
    })
    const queue = usePlaybackQueue({ resolveTrack: (trackId) => groupedTracks.get(trackId) })

    queue.setArrangementMode('platform')
    expect(queue.items.value.map((track) => track.id)).toEqual(['a1', 'a2', 'b1', 'b2'])
    queue.movePlatform('a', 'b')
    expect(queue.items.value.map((track) => track.id)).toEqual(['b1', 'b2', 'a1', 'a2'])
    queue.move('a2', 'a1')
    expect(queue.items.value.map((track) => track.id)).toEqual(['b1', 'b2', 'a2', 'a1'])
    queue.move('a2', 'b1')
    expect(queue.items.value.map((track) => track.id)).toEqual(['b1', 'b2', 'a2', 'a1'])
    queue.select('b1')
    queue.next()
    expect(queue.currentTrack.value?.id).toBe('b2')
    expect(repositoryMock.save.mock.lastCall?.[0]).toMatchObject({
      trackIds: ['b1', 'b2', 'a2', 'a1'],
      arrangementMode: 'platform',
    })
  })

  it('adds and pins songs inside existing platform blocks', () => {
    const groupedTracks = new Map([
      ['a1', createPlatformTrack('a1', 'a')],
      ['b1', createPlatformTrack('b1', 'b')],
      ['a2', createPlatformTrack('a2', 'a')],
    ])
    repositoryMock.load.mockReturnValue({
      schemaVersion: 1,
      trackIds: ['a1', 'b1'],
      mode: 'sequence',
      arrangementMode: 'platform',
    })
    const queue = usePlaybackQueue({ resolveTrack: (trackId) => groupedTracks.get(trackId) })

    queue.add(groupedTracks.get('a2')!)
    expect(queue.items.value.map((track) => track.id)).toEqual(['a1', 'a2', 'b1'])
    queue.pin('a2')
    expect(queue.items.value.map((track) => track.id)).toEqual(['a2', 'a1', 'b1'])
  })
})

function createTrack(id: string): Track {
  return {
    id,
    title: `歌曲 ${id}`,
    artists: [{ name: '测试博主' }],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
  }
}

function createPlatformTrack(id: string, pluginId: string): Track {
  return { ...createTrack(id), source: { pluginId, mediaKind: 'audio', resourceId: id } }
}
