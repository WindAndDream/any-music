import type { MusicSourceDescriptor } from '@any-music/core'

export const NETEASE_MUSIC_SOURCE_DESCRIPTOR = {
  id: 'netease',
  name: '网易云音乐',
  description: '搜索歌曲，导入网易云歌曲、歌单、专辑和歌手热门歌曲。',
  provenance: 'built-in',
  capabilities: { search: true, importUrl: true, session: true },
  importUrlScopes: [{ origin: 'https://music.163.com', pathnamePrefix: '/' }],
} as const satisfies MusicSourceDescriptor
