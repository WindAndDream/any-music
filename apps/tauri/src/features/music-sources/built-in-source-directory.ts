import type { MusicSourcePlugin } from '@any-music/core'
import type { ModuleForm } from '@any-music/plugin-center'
import { selectBuiltInSources } from '@any-music/plugin-center/music-sources'
import {
  BILIBILI_BUILT_IN_TARGETS,
  BILIBILI_MUSIC_SOURCE_DESCRIPTOR,
  createBilibiliSourceModule,
  parseBilibiliImportUrl,
} from '@any-music/plugin-source-bilibili'
import {
  DOUYIN_BUILT_IN_TARGETS,
  DOUYIN_MUSIC_SOURCE_DESCRIPTOR,
  createDouyinSourceModule,
  parseDouyinImportUrl,
} from '@any-music/plugin-source-douyin'
import {
  NETEASE_BUILT_IN_TARGETS,
  NETEASE_MUSIC_SOURCE_DESCRIPTOR,
  createNeteaseSourceModule,
  parseNeteaseImportUrl,
} from '@any-music/plugin-source-netease'

import type { NativeSourceContext } from './native-source-plugins'

/** One application directory feeds instances, plugin modules and account platform choices. */
export const BUILT_IN_SOURCE_DIRECTORY = [
  {
    descriptor: BILIBILI_MUSIC_SOURCE_DESCRIPTOR,
    targets: BILIBILI_BUILT_IN_TARGETS,
    createModule: createBilibiliSourceModule,
    validateImportUrl: (url: string) => void parseBilibiliImportUrl(url),
    loginUrl: 'https://www.bilibili.com/',
    loadPlugin: async (context: NativeSourceContext): Promise<MusicSourcePlugin> =>
      (await import('./native-source-plugins')).loadBilibiliPlugin(context),
  },
  {
    descriptor: DOUYIN_MUSIC_SOURCE_DESCRIPTOR,
    targets: DOUYIN_BUILT_IN_TARGETS,
    createModule: createDouyinSourceModule,
    validateImportUrl: (url: string) => void parseDouyinImportUrl(url),
    loginUrl: 'https://www.douyin.com/',
    loadPlugin: async (context: NativeSourceContext): Promise<MusicSourcePlugin> =>
      (await import('./native-source-plugins')).loadDouyinPlugin(context),
  },
  {
    descriptor: NETEASE_MUSIC_SOURCE_DESCRIPTOR,
    targets: NETEASE_BUILT_IN_TARGETS,
    createModule: createNeteaseSourceModule,
    validateImportUrl: (url: string) => void parseNeteaseImportUrl(url),
    loginUrl: 'https://music.163.com/',
    loadPlugin: async (context: NativeSourceContext): Promise<MusicSourcePlugin> =>
      (await import('./native-source-plugins')).loadNeteasePlugin(context),
  },
] as const

export function getBuiltInSourceDirectory(form: ModuleForm) {
  return selectBuiltInSources(BUILT_IN_SOURCE_DIRECTORY, form)
}
