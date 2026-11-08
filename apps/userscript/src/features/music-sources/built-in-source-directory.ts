import type { HttpClient } from '@any-music/core'
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

/** Metadata and factories share one distribution decision, without loading GM or protocol runtimes. */
export const builtInSourceDirectory = selectBuiltInSources(
  [
    {
      descriptor: BILIBILI_MUSIC_SOURCE_DESCRIPTOR,
      targets: BILIBILI_BUILT_IN_TARGETS,
      createModule: createBilibiliSourceModule,
      host: 'www.bilibili.com',
      loginUrl: 'https://passport.bilibili.com/login',
      validateImportUrl: (url: string): void => void parseBilibiliImportUrl(url),
      loadPlugin: async (http: HttpClient) => {
        const { BilibiliApi, BilibiliMusicSourcePlugin } =
          await import('@any-music/plugin-source-bilibili/runtime')
        return new BilibiliMusicSourcePlugin(new BilibiliApi(http))
      },
    },
    {
      descriptor: DOUYIN_MUSIC_SOURCE_DESCRIPTOR,
      targets: DOUYIN_BUILT_IN_TARGETS,
      createModule: createDouyinSourceModule,
      host: 'www.douyin.com',
      loginUrl: 'https://www.douyin.com/',
      validateImportUrl: (url: string): void => void parseDouyinImportUrl(url),
      loadPlugin: async (http: HttpClient) => {
        const {
          createDouyinPageSignatureProvider,
          createDouyinWebRequestStateProvider,
          createDouyinTargetCookieStateProvider,
          DouyinApi,
          DouyinMusicSourcePlugin,
          douyinProtectedPageSource,
        } = await import('@/platform/music-plugins/douyin')
        return new DouyinMusicSourcePlugin(
          new DouyinApi(
            http,
            createDouyinWebRequestStateProvider(),
            createDouyinPageSignatureProvider(),
            createDouyinTargetCookieStateProvider(),
          ),
          douyinProtectedPageSource,
        )
      },
    },
    {
      descriptor: NETEASE_MUSIC_SOURCE_DESCRIPTOR,
      targets: NETEASE_BUILT_IN_TARGETS,
      createModule: createNeteaseSourceModule,
      host: 'music.163.com',
      loginUrl: 'https://music.163.com/',
      validateImportUrl: (url: string): void => void parseNeteaseImportUrl(url),
      loadPlugin: async (http: HttpClient) => {
        const { NeteaseApi, NeteaseMusicSourcePlugin } =
          await import('@any-music/plugin-source-netease/runtime')
        return new NeteaseMusicSourcePlugin(new NeteaseApi(http))
      },
    },
  ],
  'userscript',
)
