import { MusicSourceError, sanitizeTrackMetadataUrl } from '@any-music/core'
import type { Track } from '@any-music/core'

export type NeteaseRecord = Record<string, unknown>

export function record(value: unknown): NeteaseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new MusicSourceError('invalid-response', '网易云返回的数据格式无效。')
  return value as NeteaseRecord
}

export function array(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new MusicSourceError('invalid-response', '网易云未返回有效列表。')
  return value
}

export function resourceId(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new MusicSourceError('invalid-response', '网易云返回的资源 ID 无效。')
  return String(value)
}

export function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function mapNeteaseSong(value: unknown): Track {
  const song = record(value)
  const id = resourceId(song.id)
  if (typeof song.name !== 'string' || !song.name.trim())
    throw new MusicSourceError('invalid-response', '网易云返回的歌曲缺少名称。')
  const album = song.al ?? song.album
  const artwork = album == null ? undefined : sanitizeTrackMetadataUrl(record(album).picUrl)
  return {
    id: `netease:audio:${id}`,
    title: song.name,
    artists: array(song.ar ?? song.artists ?? []).map((entry) => {
      const artist = record(entry)
      if (typeof artist.name !== 'string')
        throw new MusicSourceError('invalid-response', '网易云返回的歌手数据无效。')
      // Upstream uses zero for named artists without a catalog identity; it is not a song ID.
      return {
        id: artist.id == null || artist.id === 0 ? undefined : resourceId(artist.id),
        name: artist.name,
      }
    }),
    artworkUrl: artwork?.replace(/^http:/i, 'https:'),
    durationMs: nonNegative(song.dt ?? song.duration),
    source: {
      pluginId: 'netease',
      mediaKind: 'audio',
      resourceId: id,
      pageUrl: `https://music.163.com/song?id=${id}`,
    },
  }
}
