import { AppError } from '@any-music/core'
import type { CancellationSignal, MusicPlaylist, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { usePlaylistValidation } from '#workbench/features/library/use-playlist-validation'

const track = (id: string): Track => ({
  id,
  title: `歌曲 ${id}`,
  artists: [{ name: '歌手' }],
  source: { pluginId: 'test', resourceId: id, mediaKind: 'audio' },
})
const playlist = (ids: string[], id = 'p'): MusicPlaylist => ({
  id,
  name: id,
  trackIds: ids,
  createdAtMs: 1,
  updatedAtMs: 1,
})
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('open playlist validation', () => {
  it('does no work before entry, bounds concurrency, retains typed failures and retries', async () => {
    const active = shallowRef<MusicPlaylist>()
    const pending = new Map<string, () => void>()
    let running = 0,
      maximum = 0,
      retry = false
    const check = vi.fn(async (song: Track) => {
      running++
      maximum = Math.max(maximum, running)
      await new Promise<void>((resolve) => pending.set(song.id, resolve))
      running--
      if (!retry && song.id === '2') throw new AppError('network-error', '离线')
      if (!retry && song.id === '3') throw new AppError('not-found', '已下架')
      if (!retry && song.id === '4') throw new AppError('access-denied', '仅自己可见')
    })
    const scope = effectScope()
    const validation = scope.run(() =>
      usePlaylistValidation({
        playlist: () => active.value,
        getTrack: track,
        leafIds: (song) => [song.id],
        check,
      }),
    )!
    try {
      expect(check).not.toHaveBeenCalled()
      active.value = playlist(['1', '2', '3', '4', '5'])
      expect(check.mock.calls.map(([song]) => song.id)).toEqual(['1', '2', '3'])
      pending.get('1')!()
      await flush()
      expect(check.mock.calls.map(([song]) => song.id)).toEqual(['1', '2', '3', '4'])
      for (const done of pending.values()) done()
      await flush()
      pending.get('5')!()
      await flush()
      expect(maximum).toBe(3)
      expect(validation.state.value).toMatchObject({
        status: 'complete',
        checkedCount: 5,
        totalCount: 5,
      })
      expect(
        validation.state.value.issues.map(({ error }) => [error.code, error.statusCode]),
      ).toEqual([
        ['network-error', 'AM-4001'],
        ['not-found', 'AM-1004'],
        ['access-denied', 'AM-2002'],
      ])
      retry = true
      pending.clear()
      validation.retry()
      for (const done of pending.values()) done()
      await flush()
      for (const done of pending.values()) done()
      await flush()
      expect(validation.state.value.issues).toEqual([])
      expect(check).toHaveBeenCalledTimes(10)
    } finally {
      scope.stop()
    }
  })

  it('cancels on close, replacement and disposal; late responses admit no queued work or stale issues', async () => {
    const active = shallowRef<MusicPlaylist | undefined>(playlist(['1', '2', '3', '4']))
    const signals: CancellationSignal[] = [],
      completions: (() => void)[] = []
    const cancelled = vi.fn()
    const check = vi.fn(async (_song: Track, signal: CancellationSignal) => {
      signals.push(signal)
      signal.subscribe(() => cancelled())
      await new Promise<void>((resolve) => completions.push(resolve))
      throw new AppError('network-error')
    })
    const scope = effectScope()
    const validation = scope.run(() =>
      usePlaylistValidation({
        playlist: () => active.value,
        getTrack: track,
        leafIds: (song) => [song.id],
        check,
      }),
    )!
    active.value = undefined
    expect(cancelled).toHaveBeenCalledTimes(3)
    completions.splice(0).forEach((done) => done())
    await flush()
    expect(check).toHaveBeenCalledTimes(3)
    expect(validation.state.value.status).toBe('idle')
    active.value = playlist(['5'], 'second')
    active.value = playlist(['6'], 'third')
    completions.splice(0).forEach((done) => done())
    await flush()
    expect(validation.state.value.issues.map(({ trackId }) => trackId)).toEqual(['6'])
    validation.retry()
    scope.stop()
    expect(signals.every((signal) => signal.isCancelled())).toBe(true)
    completions.forEach((done) => done())
    await flush()
    expect(validation.state.value.issues).toEqual([])
  })

  it('deduplicates custom leaves and attributes dependency errors to each owning song', async () => {
    const scope = effectScope()
    const check = vi.fn(async (song: Track) => {
      if (song.id === 'leaf') throw new AppError('access-denied')
    })
    const validation = scope.run(() =>
      usePlaylistValidation({
        playlist: () => playlist(['mix', 'leaf']),
        getTrack: track,
        leafIds: (song) => (song.id === 'mix' ? ['leaf', 'other'] : [song.id]),
        check,
      }),
    )!
    try {
      await flush()
      expect(check.mock.calls.map(([song]) => song.id)).toEqual(['leaf', 'other'])
      expect(validation.state.value.issues.map(({ trackId }) => trackId)).toEqual(['mix', 'leaf'])
    } finally {
      scope.stop()
    }
  })
})
