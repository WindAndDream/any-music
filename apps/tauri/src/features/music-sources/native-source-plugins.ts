import { AppError } from '@any-music/core'
import type {
  CancellationSignal,
  HttpClient,
  MusicSourcePlugin,
  MusicSourceSession,
} from '@any-music/core'
import type { DouyinBrowserCatalog } from '@any-music/plugin-source-douyin/runtime'
import { invoke } from '@tauri-apps/api/core'

import { createDouyinBrowserCatalog } from '../../platform/douyin-browser-catalog'

export interface NativeSourceContext {
  accountId: string
  http: HttpClient
  cancellation?: CancellationSignal
}

// Rust recognizes this exact read and returns only the verified identity projection.
const DOUYIN_IDENTITY_URL =
  'https://www.douyin.com/aweme/v1/web/query/user/?device_platform=webapp&aid=6383&channel=channel_pc_web&publish_video_strategy_type=2'

async function readDouyinNickname(
  http: HttpClient,
  cancellation?: CancellationSignal,
): Promise<string> {
  try {
    // Rust extracts the nickname for the bound UID. The renderer receives no HTML.
    const response = await http.request({
      url: 'https://www.douyin.com/user/self',
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Referer: 'https://www.douyin.com/jingxuan',
      },
      timeoutMs: 6_000,
      cancellation,
    })
    if (response.status !== 200 || typeof response.body !== 'string') return ''
    const result: unknown = JSON.parse(response.body)
    return result &&
      typeof result === 'object' &&
      'nickname' in result &&
      typeof result.nickname === 'string'
      ? result.nickname
      : ''
  } catch (error) {
    if (error instanceof AppError && error.code === 'operation-cancelled') throw error
    // A profile display failure does not invalidate identity from the first request.
    return ''
  }
}

async function readDouyinIdentity(
  http: HttpClient,
  cancellation?: CancellationSignal,
): Promise<MusicSourceSession> {
  const response = await http.request({
    url: DOUYIN_IDENTITY_URL,
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://www.douyin.com/jingxuan',
    },
    timeoutMs: 10_000,
    maxResponseBytes: 32 * 1024,
    cancellation,
  })
  if (response.status !== 200 || typeof response.body !== 'string')
    throw new AppError('invalid-response', '抖音登录状态响应无效。')
  let result: unknown
  try {
    result = JSON.parse(response.body)
  } catch (cause) {
    throw new AppError('invalid-response', '抖音登录状态响应无效。', { cause })
  }
  if (!result || typeof result !== 'object' || !('userId' in result))
    throw new AppError('invalid-response', '抖音登录状态响应无效。')
  if (result.userId === null) return { status: 'signed-out' }
  if (typeof result.userId !== 'string' || !/^[1-9][0-9]*$/.test(result.userId))
    throw new AppError('invalid-response', '抖音登录状态响应缺少账号标识。')
  const nickname = await readDouyinNickname(http, cancellation)
  return { status: 'signed-in', user: { id: result.userId, name: nickname } }
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
  // Official pages supply catalog data and the full profile when an import needs sec_uid.
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
    undefined,
    cancellation,
    () => readDouyinIdentity(http, cancellation),
  )
}
