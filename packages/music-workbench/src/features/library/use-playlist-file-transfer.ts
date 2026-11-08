import { AppError, createEmptyLocalMusicLibrary } from '@any-music/core'
import { readonly, shallowRef } from 'vue'

import {
  exportPortablePlaylist,
  parsePortablePlaylist,
  MAX_PLAYLIST_FILE_BYTES,
} from '../../storage/portable-playlist'
import { createAudioDownloadFileName, downloadBlob } from '../audio-export/download-audio'
import type { useLocalMusicLibrary } from './use-local-music-library'

/** One host-owned file operation survives theme replacement; disposed hosts reject late reads. */
export function usePlaylistFileTransfer(options: {
  library: Pick<
    ReturnType<typeof useLocalMusicLibrary>,
    'profile' | 'records' | 'customTracks' | 'playlists' | 'importPlaylist'
  >
  assertActive: () => void
  save?: typeof downloadBlob
}) {
  const busy = shallowRef(false)
  const library = options.library
  async function run(operation: () => Promise<void>): Promise<void> {
    options.assertActive()
    if (busy.value) throw new AppError('conflict', '正在处理歌单文件，请稍后重试。')
    busy.value = true
    try {
      await operation()
    } finally {
      busy.value = false
    }
  }
  return {
    busy: readonly(busy),
    importFile: (file: Blob) =>
      run(async () => {
        if (file.size > MAX_PLAYLIST_FILE_BYTES)
          throw new AppError('invalid-input', '歌单文件不能超过 5 MB。')
        const candidate = parsePortablePlaylist(await file.text())
        options.assertActive()
        library.importPlaylist(candidate)
      }),
    exportFile: (id: string) =>
      run(async () => {
        const playlist = library.playlists.value.find((entry) => entry.id === id)
        if (!playlist) throw new AppError('not-found', '找不到歌单。')
        const document = exportPortablePlaylist(
          {
            ...createEmptyLocalMusicLibrary(library.profile.value),
            tracks: library.records.value,
            customTracks: library.customTracks.value,
          },
          playlist,
        )
        const file = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
        if (file.size > MAX_PLAYLIST_FILE_BYTES)
          throw new AppError('invalid-input', '歌单文件不能超过 5 MB。')
        await (options.save ?? downloadBlob)(
          file,
          createAudioDownloadFileName(playlist.name, 'json'),
        )
      }),
  }
}
