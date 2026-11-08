import { createEmptyLocalMusicLibrary } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { usePlaylistFileTransfer } from '#workbench/features/library/use-playlist-file-transfer'
import { MAX_PLAYLIST_FILE_BYTES } from '#workbench/storage/portable-playlist'

function setup() {
  const initial = createEmptyLocalMusicLibrary({ id: 'local-user:one', displayName: '本地用户' })
  const library = {
    profile: shallowRef(initial.profile),
    records: shallowRef(initial.tracks),
    customTracks: shallowRef(initial.customTracks),
    playlists: shallowRef([{ id: 'p', name: 'Mix', trackIds: [], createdAtMs: 1, updatedAtMs: 1 }]),
    importPlaylist: vi.fn(),
  }
  const save = vi.fn(async (_blob: Blob, _name: string) => {})
  const assertActive = vi.fn()
  return {
    library,
    save,
    assertActive,
    transfer: usePlaylistFileTransfer({ library, save, assertActive }),
  }
}

describe('playlist file transfer', () => {
  it('saves a JSON document through the injected runtime, then imports through one host mutation', async () => {
    const f = setup()
    await f.transfer.exportFile('p')
    expect(f.save).toHaveBeenCalledOnce()
    const [blob, name] = f.save.mock.calls[0]!
    expect(name).toBe('Mix.json')
    expect(blob.type).toBe('application/json')
    await f.transfer.importFile(blob)
    expect(f.library.importPlaylist).toHaveBeenCalledOnce()
    expect(f.library.importPlaylist.mock.calls[0]?.[0].playlists[0]).toMatchObject({
      name: 'Mix',
      trackIds: [],
    })
    expect(f.transfer.busy.value).toBe(false)
  })

  it('checks file size before reading and releases the lock on malformed input or a cancelled save', async () => {
    const f = setup()
    const text = vi.fn()
    await expect(
      f.transfer.importFile({ size: MAX_PLAYLIST_FILE_BYTES + 1, text } as unknown as Blob),
    ).rejects.toThrow(/5 MB/)
    expect(text).not.toHaveBeenCalled()
    await expect(f.transfer.importFile(new Blob(['{}']))).rejects.toThrow(/无效/)
    f.save.mockRejectedValueOnce(new Error('save cancelled'))
    await expect(f.transfer.exportFile('p')).rejects.toThrow('save cancelled')
    expect(f.library.importPlaylist).not.toHaveBeenCalled()
    expect(f.transfer.busy.value).toBe(false)
    await f.transfer.exportFile('p')
    expect(f.save).toHaveBeenCalledTimes(2)
  })

  it('blocks duplicate operations and discards a file read completed after host disposal', async () => {
    const f = setup()
    await f.transfer.exportFile('p')
    const json = await f.save.mock.calls[0]![0].text()
    let complete!: (text: string) => void
    const pending = f.transfer.importFile({
      size: json.length,
      text: () =>
        new Promise<string>((resolve) => {
          complete = resolve
        }),
    } as Blob)
    expect(f.transfer.busy.value).toBe(true)
    await expect(f.transfer.exportFile('p')).rejects.toThrow(/正在处理/)
    f.assertActive.mockImplementation(() => {
      throw new Error('disposed')
    })
    complete(json)
    await expect(pending).rejects.toThrow('disposed')
    expect(f.library.importPlaylist).not.toHaveBeenCalled()
    expect(f.transfer.busy.value).toBe(false)
  })
})
