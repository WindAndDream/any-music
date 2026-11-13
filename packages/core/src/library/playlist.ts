import { AppError } from '../errors/app-error'
import type { MusicPlaylist } from './models'

/** Match the names users see, including full-width characters and case variants. */
export function playlistNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function validatePlaylistName(
  name: string,
  playlists: readonly Pick<MusicPlaylist, 'id' | 'name'>[],
  excludingId?: string,
): string {
  const normalized = name.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized) throw new AppError('invalid-input', '歌单名称不能为空。')
  if (normalized.length > 80) throw new AppError('invalid-input', '歌单名称不能超过 80 个字符。')
  const key = playlistNameKey(normalized)
  if (playlists.some((item) => item.id !== excludingId && playlistNameKey(item.name) === key))
    throw new AppError('invalid-input', '已存在同名歌单，请换一个名称。')
  return normalized
}
