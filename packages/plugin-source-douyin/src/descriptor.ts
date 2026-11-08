import type { MusicSourceDescriptor } from '@any-music/core'

/** 抖音插件的稳定元数据独立于签名与接口实现，切换来源前无需执行整个平台模块。 */
export const DOUYIN_MUSIC_SOURCE_DESCRIPTOR = {
  id: 'douyin',
  name: '抖音',
  description: '将抖音视频、图文配乐、合集、用户作品、喜欢和个人收藏作为可播放音乐。',
  provenance: 'built-in',
  capabilities: { search: true, importUrl: true, session: true },
  importUrlScopes: [
    { origin: 'https://douyin.com', pathnamePrefix: '/' },
    { origin: 'https://www.douyin.com', pathnamePrefix: '/' },
    { origin: 'https://www-hj.douyin.com', pathnamePrefix: '/' },
  ],
} as const satisfies MusicSourceDescriptor
