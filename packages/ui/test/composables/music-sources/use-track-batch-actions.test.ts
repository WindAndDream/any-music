import type { MusicPlaylist, Track } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useTrackBatchActions } from '../../../src/composables/music-sources/use-track-batch-actions'

const { confirm, feedback } = vi.hoisted(() => ({ confirm: vi.fn(), feedback: vi.fn() }))
vi.mock('../../../src/composables/use-confirmation-dialog', () => ({
  useConfirmAction: () => confirm,
}))
vi.mock('../../../src/composables/use-action-feedback', () => ({
  useActionFeedback: () => feedback,
}))

const songs: Track[] = ['one', 'two', 'three'].map((id) => ({
  id,
  title: id,
  artists: [],
  source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
}))
const playlist: MusicPlaylist = {
  id: 'list',
  name: '测试歌单',
  trackIds: ['one'],
  createdAtMs: 0,
  updatedAtMs: 0,
}

function setup() {
  const tracks = shallowRef<readonly Track[]>(songs)
  const queued = shallowRef<ReadonlySet<string>>(new Set())
  const favorites = shallowRef<ReadonlySet<string>>(new Set())
  const downloaded = shallowRef<ReadonlySet<string>>(new Set())
  const playlists = shallowRef<readonly MusicPlaylist[]>([playlist])
  const active = shallowRef(true)
  const contextKey = shallowRef('request:first')
  const busy = shallowRef(false)
  const clearSelection = vi.fn(() => {
    tracks.value = []
  })
  const addToQueue = vi.fn()
  const addToFavorites = vi.fn()
  const download = vi.fn()
  const addToPlaylist = vi.fn()
  const scope = effectScope()
  const actions = scope.run(() =>
    useTrackBatchActions({
      tracks,
      queueTracks: () => tracks.value.toReversed(),
      queuedTrackIds: queued,
      favoriteTrackIds: favorites,
      downloadedTrackIds: downloaded,
      playlists,
      downloadBusy: busy,
      active,
      contextKey,
      clearSelection,
      addToQueue,
      addToFavorites,
      download,
      addToPlaylist,
    }),
  )!
  return {
    actions,
    tracks,
    queued,
    favorites,
    downloaded,
    playlists,
    active,
    contextKey,
    busy,
    clearSelection,
    addToQueue,
    addToFavorites,
    download,
    addToPlaylist,
    stop: () => scope.stop(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  confirm.mockResolvedValue(true)
})

describe('track batch actions', () => {
  it('hides queue and favorite actions only for a nonempty entirely added selection', () => {
    const view = setup()
    view.queued.value = new Set(['one', 'two'])
    expect(view.actions.areAllSelectedQueued.value).toBe(false)
    view.queued.value = new Set(songs.map((track) => track.id))
    view.favorites.value = view.queued.value
    expect(view.actions.areAllSelectedQueued.value).toBe(true)
    expect(view.actions.areAllSelectedFavorited.value).toBe(true)
    view.tracks.value = []
    expect(view.actions.areAllSelectedQueued.value).toBe(false)
    expect(view.actions.areAllSelectedFavorited.value).toBe(false)
    view.stop()
  })

  it('queues missing songs in selection order and adds only missing favorites', async () => {
    const view = setup()
    view.queued.value = new Set(['two'])
    await view.actions.addSelectedToQueue()
    expect(view.addToQueue).toHaveBeenCalledExactlyOnceWith([songs[2], songs[0]])
    view.tracks.value = songs
    view.favorites.value = new Set(['two'])
    await view.actions.addSelectedToFavorites()
    expect(view.addToFavorites).toHaveBeenCalledExactlyOnceWith([songs[0], songs[2]])
    expect(view.clearSelection).toHaveBeenCalledTimes(2)
    view.stop()
  })

  it('confirms queue additions and retains the selection when cancelled', async () => {
    const view = setup()
    confirm.mockResolvedValueOnce(false)
    await view.actions.addSelectedToQueue()
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      title: '添加到待听',
      message: '确定将已选的 3 首歌曲添加到“待听”吗？已有歌曲会保持原位，新歌曲按勾选顺序添加。',
      confirmLabel: '添加 3 首',
    })
    expect(view.addToQueue).not.toHaveBeenCalled()
    expect(view.clearSelection).not.toHaveBeenCalled()
    expect(view.tracks.value).toEqual(songs)
    view.stop()
  })

  it('skips queue confirmation for inactive, empty or entirely queued selections', async () => {
    const view = setup()
    view.active.value = false
    await view.actions.addSelectedToQueue()
    view.active.value = true
    view.tracks.value = []
    await view.actions.addSelectedToQueue()
    view.tracks.value = songs
    view.queued.value = new Set(songs.map((track) => track.id))
    await view.actions.addSelectedToQueue()
    expect(confirm).not.toHaveBeenCalled()
    expect(view.addToQueue).not.toHaveBeenCalled()
    expect(view.clearSelection).not.toHaveBeenCalled()
    view.stop()
  })

  it('rechecks queue membership after confirmation and retains the selection if nothing remains', async () => {
    const view = setup()
    confirm.mockImplementationOnce(async () => {
      view.queued.value = new Set(['two'])
      return true
    })
    await view.actions.addSelectedToQueue()
    expect(view.addToQueue).toHaveBeenCalledExactlyOnceWith([songs[2], songs[0]])
    view.addToQueue.mockClear()
    view.clearSelection.mockClear()
    view.tracks.value = songs
    confirm.mockImplementationOnce(async () => {
      view.queued.value = new Set(songs.map((track) => track.id))
      return true
    })
    await view.actions.addSelectedToQueue()
    expect(view.addToQueue).not.toHaveBeenCalled()
    expect(view.clearSelection).not.toHaveBeenCalled()
    view.stop()
  })

  it('allows downloaded selections to verify the directory and download again', async () => {
    const view = setup()
    view.downloaded.value = new Set(songs.map((track) => track.id))
    await view.actions.downloadSelected()
    expect(view.download).toHaveBeenCalledExactlyOnceWith(songs)
    expect(confirm).toHaveBeenCalledOnce()
    expect(view.clearSelection).toHaveBeenCalledOnce()
    view.stop()
  })

  it('confirms all selected songs, retaining the selection on cancellation', async () => {
    const view = setup()
    view.downloaded.value = new Set(['two'])
    confirm.mockResolvedValueOnce(false)
    await view.actions.downloadSelected()
    expect(view.download).not.toHaveBeenCalled()
    expect(view.tracks.value).toEqual(songs)
    await view.actions.downloadSelected()
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        confirmLabel: '下载 3 首',
        message: expect.stringContaining('名称和内容均一致'),
      }),
    )
    expect(view.download).toHaveBeenCalledExactlyOnceWith(songs)
    view.stop()
  })

  it('checks membership in the chosen playlist and reports an entirely existing selection', async () => {
    const view = setup()
    await view.actions.requestAddSelectedToPlaylist()
    expect(view.actions.isPlaylistPickerOpen.value).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    view.tracks.value = [songs[0]!]
    expect(view.actions.isPlaylistPickerOpen.value).toBe(false)
    view.actions.requestAddSelectedToPlaylist()
    view.actions.addSelectedToPlaylist(['list'])
    expect(feedback).toHaveBeenCalledExactlyOnceWith({
      status: 'info',
      message: '已选歌曲均已加入“测试歌单”，无需重复添加。',
    })
    expect(view.addToPlaylist).not.toHaveBeenCalled()
    expect(view.actions.isPlaylistPickerOpen.value).toBe(true)
    view.tracks.value = songs
    view.actions.requestAddSelectedToPlaylist()
    view.actions.addSelectedToPlaylist(['list'])
    expect(view.addToPlaylist).toHaveBeenCalledExactlyOnceWith('list', [songs[1], songs[2]])
    expect(view.actions.isPlaylistPickerOpen.value).toBe(false)
    view.stop()
  })

  it('opens the picker directly for an empty playlist directory', async () => {
    const view = setup()
    view.playlists.value = []
    await view.actions.requestAddSelectedToPlaylist()
    expect(view.actions.isPlaylistPickerOpen.value).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    view.stop()
  })

  it('adds missing tracks to multiple unique current destinations without another confirmation', () => {
    const view = setup()
    view.playlists.value = [playlist, { ...playlist, id: 'second', trackIds: ['two'] }]
    view.actions.requestAddSelectedToPlaylist()
    view.actions.addSelectedToPlaylist(['list', 'second', 'list', 'deleted'])
    expect(view.addToPlaylist.mock.calls).toEqual([
      ['list', [songs[1], songs[2]]],
      ['second', [songs[0], songs[2]]],
    ])
    expect(confirm).not.toHaveBeenCalled()
    expect(view.clearSelection).toHaveBeenCalledOnce()
    view.stop()
  })

  it.each(
    (['addSelectedToQueue', 'downloadSelected'] as const).flatMap((action) =>
      (['selection', 'context', 'inactive', 'dispose'] as const).map((change) => ({
        action,
        change,
      })),
    ),
  )('ignores a pending $action confirmation after $change changes', async ({ action, change }) => {
    const view = setup()
    let resolve!: (value: boolean) => void
    confirm.mockReturnValueOnce(
      new Promise<boolean>((done) => {
        resolve = done
      }),
    )
    const pending = view.actions[action]()
    if (change === 'selection') view.tracks.value = [songs[0]!]
    else if (change === 'context') view.contextKey.value = 'request:second'
    else if (change === 'inactive') view.active.value = false
    else view.stop()
    resolve(true)
    await pending
    expect(view.download).not.toHaveBeenCalled()
    expect(view.addToQueue).not.toHaveBeenCalled()
    expect(view.clearSelection).not.toHaveBeenCalled()
    view.stop()
  })

  it('rechecks busy, download completion and playlist membership after confirmation', async () => {
    const view = setup()
    confirm.mockImplementationOnce(async () => {
      view.busy.value = true
      return true
    })
    await view.actions.downloadSelected()
    expect(view.download).not.toHaveBeenCalled()
    view.busy.value = false
    confirm.mockImplementationOnce(async () => {
      view.downloaded.value = new Set(['one'])
      return true
    })
    await view.actions.downloadSelected()
    expect(view.download).toHaveBeenCalledExactlyOnceWith(songs)
    view.tracks.value = songs
    view.playlists.value = [{ ...playlist, trackIds: songs.map((track) => track.id) }]
    view.actions.requestAddSelectedToPlaylist()
    view.actions.addSelectedToPlaylist(['list'])
    expect(view.addToPlaylist).not.toHaveBeenCalled()
    expect(feedback).toHaveBeenCalledWith({
      status: 'info',
      message: '已选歌曲均已加入“测试歌单”，无需重复添加。',
    })
    view.stop()
  })
})
