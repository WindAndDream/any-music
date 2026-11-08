import type { MusicSourceDescriptor } from '@any-music/core'

/** B 站插件的稳定元数据独立于运行时实现，供惰性注册表在加载适配器前展示能力。 */
export const BILIBILI_MUSIC_SOURCE_DESCRIPTOR = {
  id: 'bilibili',
  name: '哔哩哔哩',
  description: '将 B 站视频和音频投稿作为可播放音乐。',
  provenance: 'built-in',
  capabilities: { search: true, importUrl: true, session: true },
  importUrlScopes: [
    { origin: 'https://www.bilibili.com', pathnamePrefix: '/video/' },
    { origin: 'https://space.bilibili.com', pathnamePrefix: '/' },
  ],
} as const satisfies MusicSourceDescriptor
