import type { MusicPlaylist } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { usePlaylistArtwork } from '#workbench/features/library/use-playlist-artwork'

describe('playlist artwork lifecycle', () => {
  it('retries failed startup cleanup and preserves artwork after a product save failure', async () => {
    const playlists = shallowRef<readonly MusicPlaylist[]>([
      { id: 'p', name: '歌单', coverId: 'old', trackIds: [], createdAtMs: 1, updatedAtMs: 1 },
    ])
    const cache = {
      read: vi.fn(async () => undefined),
      put: vi.fn(async () => 'new'),
      retain: vi.fn(async () => {}).mockRejectedValueOnce(new Error('temporarily unavailable')),
      remove: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    }
    const scope = effectScope()
    const artwork = scope.run(() => usePlaylistArtwork(playlists, cache, () => false))!
    await nextTick()
    await expect(artwork.store('data:image/jpeg;base64,AAAA')).resolves.toBe('new')
    expect(cache.retain).toHaveBeenCalledTimes(2)
    playlists.value = []
    await nextTick()
    expect(cache.remove).not.toHaveBeenCalled()
    scope.stop()
  })

  it('releases replaced artwork and rejects uploads completing after disposal', async () => {
    const playlists = shallowRef<readonly MusicPlaylist[]>([
      { id: 'p', name: '歌单', coverId: 'old', trackIds: [], createdAtMs: 1, updatedAtMs: 1 },
    ])
    let complete!: (value: string) => void
    const cache = {
      read: vi.fn(async (id: string) => `${id}:image`),
      put: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            complete = resolve
          }),
      ),
      retain: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    }
    const scope = effectScope()
    const artwork = scope.run(() => usePlaylistArtwork(playlists, cache))!
    await vi.waitFor(() => expect(artwork.urls.value.old).toBe('old:image'))
    playlists.value = [{ ...playlists.value[0]!, coverId: 'new' }]
    await nextTick()
    await vi.waitFor(() => expect(artwork.urls.value.new).toBe('new:image'))
    expect(cache.remove).toHaveBeenCalledExactlyOnceWith('old')
    const upload = artwork.store('data:image/jpeg;base64,AAAA')
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledOnce())
    scope.stop()
    const rejected = expect(upload).rejects.toThrow(/已结束/)
    complete('late')
    await rejected
  })
})
