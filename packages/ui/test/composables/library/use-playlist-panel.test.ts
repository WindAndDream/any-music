import type { LibraryTrackRecord, MusicPlaylist } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { usePlaylistPanel } from '../../../src/composables/library/use-playlist-panel'

const records: readonly LibraryTrackRecord[] = ['one', 'two', 'three'].map((id) => ({
  track: {
    id,
    title: `歌曲 ${id}`,
    artists: [{ name: '作者' }],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
  },
  customTags: [],
  addedAtMs: 1,
  updatedAtMs: 1,
}))

const playlist: MusicPlaylist = {
  id: 'playlist:one',
  name: '通勤',
  trackIds: ['two', 'missing', 'one'],
  createdAtMs: 1,
  updatedAtMs: 1,
}

describe('usePlaylistPanel', () => {
  it('点播歌单成员时传递歌单顺序，不以资料库顺序或待听列表代替', () => {
    const emit = vi.fn()
    const panel = usePlaylistPanel({
      props: {
        records,
        playlists: [playlist],
        customTracks: [],
        platforms: [],
        favoriteTrackIds: new Set(),
        mode: 'shuffle-no-repeat',
        errorMessage: '',
        downloadBusy: false,
      },
      emit,
    })

    panel.playPlaylistTrack(records[0]!.track, playlist.id)

    expect(emit).toHaveBeenCalledWith('play', records[0]!.track, [
      records[1]!.track,
      records[0]!.track,
    ])
  })

  it('在总览和歌曲页之间切换，并在删除当前歌单时退出详情', () => {
    const emit = vi.fn()
    const panel = usePlaylistPanel({
      props: {
        records,
        playlists: [playlist],
        customTracks: [],
        platforms: [],
        favoriteTrackIds: new Set(),
        mode: 'sequence',
        errorMessage: '',
        downloadBusy: false,
      },
      emit,
    })

    panel.openPlaylist(playlist.id)
    expect(panel.activePlaylistId.value).toBe(playlist.id)
    panel.closePlaylist()
    expect(panel.activePlaylistId.value).toBeUndefined()
    panel.openPlaylist(playlist.id)
    panel.deletePlaylist(playlist.id)
    expect(panel.activePlaylistId.value).toBeUndefined()
    expect(emit).toHaveBeenCalledWith('deletePlaylist', playlist.id)
  })
})
