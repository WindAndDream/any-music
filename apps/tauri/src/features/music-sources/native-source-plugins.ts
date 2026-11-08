import type { CancellationSignal, HttpClient, MusicSourcePlugin } from '@any-music/core'
import type { DouyinBrowserCatalog } from '@any-music/plugin-source-douyin/runtime'
import { invoke } from '@tauri-apps/api/core'

import { createDouyinBrowserCatalog } from '../../platform/douyin-browser-catalog'

export interface NativeSourceContext {
  accountId: string
  http: HttpClient
  cancellation?: CancellationSignal
}

export async function loadNeteasePlugin({
  http,
  cancellation,
}: NativeSourceContext): Promise<MusicSourcePlugin> {
  const { NeteaseApi, NeteaseMusicSourcePlugin } =
    await import('@any-music/plugin-source-netease/runtime')
  return new NeteaseMusicSourcePlugin(new NeteaseApi(http, cancellation))
}

/** Trusted composition selects the account-owned page reader; the source never chooses a browser. */
export type DouyinPageCatalogFactory = (
  context: Pick<NativeSourceContext, 'accountId' | 'cancellation'>,
) => DouyinBrowserCatalog

export async function loadBilibiliPlugin({
  http,
}: NativeSourceContext): Promise<MusicSourcePlugin> {
  const { BilibiliApi, BilibiliMusicSourcePlugin } =
    await import('@any-music/plugin-source-bilibili/runtime')
  return new BilibiliMusicSourcePlugin(new BilibiliApi(http))
}

export async function loadDouyinPlugin(
  { http, accountId, cancellation }: NativeSourceContext,
  options: { createPageCatalog?: DouyinPageCatalogFactory } = {},
): Promise<MusicSourcePlugin> {
  const [{ DouyinApi, DouyinMusicSourcePlugin }, { createDouyinWebRequestStateProvider }] =
    await Promise.all([
      import('@any-music/plugin-source-douyin/runtime'),
      import('@any-music/plugin-source-douyin/browser'),
    ])
  const state = await invoke<{
    userAgent: string
    webId: string
    uifid?: string
    verifyFp?: string
    msToken?: string
  }>('request_state', { accountId })
  const browserState = createDouyinWebRequestStateProvider()
  // The current default is native CDP. An admitted embedded-page adapter can later supply
  // this same bounded catalog contract without changing source parsing or adding renderer fetch.
  const pageCatalog = options.createPageCatalog
    ? options.createPageCatalog({ accountId, cancellation })
    : createDouyinBrowserCatalog(accountId, cancellation)
  // Other APIs retain the same account's native HTTP and request state.
  const provider = () => ({
    ...browserState(),
    userAgent: state.userAgent,
    webId: state.webId,
    uifid: state.uifid ?? '',
    verifyFp: state.verifyFp ?? '',
    msToken: state.msToken ?? '',
  })
  return new DouyinMusicSourcePlugin(
    new DouyinApi(
      http,
      provider,
      undefined,
      async () => ({ uifid: state.uifid ?? '', verifyFp: state.verifyFp ?? '' }),
      pageCatalog,
    ),
  )
}
