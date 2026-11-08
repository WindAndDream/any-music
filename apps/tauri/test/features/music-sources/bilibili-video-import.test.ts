import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { createBuiltInMusicSources } from '@/features/music-sources/built-in-music-sources'
import { createNativeHttpClient } from '@/platform/native-http'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

const ACCOUNT: NativeAccount = {
  id: 'bilibili-account',
  platformId: 'bilibili',
  name: 'B 站',
  status: 'ready',
  enabled: true,
  state: { login: 'signed-in', verification: 'not-required', connection: 'available' },
  userAgent: 'test-agent',
  webId: '',
  proxyId: null,
  backupProxyIds: [],
  authentication: 'credential',
}
const VIEW = {
  bvid: 'BV16a4y157MW',
  title: 'BGM 合集',
  duration: 10_195,
  owner: { mid: 1, name: '测试 UP' },
  pages: [
    { page: 1, cid: 240288171, part: 'Wander', duration: 133 },
    { page: 2, cid: 240288549, part: 'With You', duration: 133 },
  ],
}

function frame(body: Uint8Array, responseType = 'text') {
  const metadata = new TextEncoder().encode(
    JSON.stringify({ status: 200, statusText: 'OK', headers: '', responseType }),
  )
  const bytes = new Uint8Array(4 + metadata.length + body.length)
  new DataView(bytes.buffer).setUint32(0, metadata.length)
  bytes.set(metadata, 4)
  bytes.set(body, 4 + metadata.length)
  return bytes.buffer
}

afterEach(() => native.invoke.mockReset())

describe('Android Bilibili part import and media composition', () => {
  it('retains P2 through the account HTTP frame, loopback grant and bounded download read', async () => {
    native.invoke.mockImplementation(async (command, input) => {
      if (command === 'account_snapshot') return { accounts: [ACCOUNT], proxies: [] }
      if (command === 'register_media') return 'http://127.0.0.1:12345/media/p2'
      if (command !== 'http_request') return
      const request = input.request
      if (request.responseType === 'bytes') return frame(Uint8Array.of(1, 2, 3, 4), 'bytes')
      const data =
        new URL(request.url).pathname === '/x/web-interface/view'
          ? VIEW
          : { quality: 16, timelength: 133_000, durl: [{ url: 'https://media.example/p2.mp4' }] }
      return frame(new TextEncoder().encode(JSON.stringify({ code: 0, data })))
    })
    const runtime = new AccountRuntime()
    const plugin = createBuiltInMusicSources(runtime, 'mobile')[0]!
    const listing = plugin
      .importFromUrl({ url: 'https://www.bilibili.com/video/BV16a4y157MW/?from=episodes&p=2' })
      .pages()
    const iterator = listing[Symbol.asyncIterator]()
    expect(native.invoke).not.toHaveBeenCalled()
    const result = await iterator.next()
    const track = result.value.items[0]!
    await iterator.return?.()
    expect(track).toMatchObject({
      id: 'bilibili:video:BV16a4y157MW:240288549',
      title: 'With You',
      durationMs: 133_000,
      source: {
        resourceId: VIEW.bvid,
        partId: '240288549',
        pageUrl: 'https://www.bilibili.com/video/BV16a4y157MW?p=2',
      },
    })
    expect(runtime.getTrackAccountId(track)).toBe(ACCOUNT.id)
    const media = await plugin.resolveMedia(track)
    expect(media).toMatchObject({
      type: 'remote-url',
      url: 'http://127.0.0.1:12345/media/p2',
      durationMs: 133_000,
    })
    if (media.type !== 'remote-url') throw new Error('Expected account-bound remote media')
    const bytes = await createNativeHttpClient().request({
      url: media.url,
      responseType: 'bytes',
      credentials: 'include',
      headers: { Range: 'bytes=0-3' },
      maxResponseBytes: 4,
    })
    expect(bytes.body).toEqual(Uint8Array.of(1, 2, 3, 4))
    const requests = native.invoke.mock.calls
      .filter(([command]) => command === 'http_request')
      .map(([, input]) => input.request)
    expect(requests).toHaveLength(3)
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/x/web-interface/view',
      '/x/player/playurl',
      '/media/p2',
    ])
    expect(new URL(requests[1].url).searchParams.get('cid')).toBe('240288549')
    for (const request of requests.slice(0, 2))
      expect(request).toMatchObject({ accountId: ACCOUNT.id, credentials: 'include' })
    expect(native.invoke).toHaveBeenCalledWith('register_media', {
      accountId: ACCOUNT.id,
      url: 'https://media.example/p2.mp4',
      headers: { Referer: 'https://www.bilibili.com/' },
      cacheIdentity: { trackId: track.id, qualityId: 'html5:16' },
    })
    media.release?.()
    media.release?.()
    expect(native.invoke.mock.calls.filter(([command]) => command === 'release_media')).toEqual([
      ['release_media', { urls: [media.url] }],
    ])
  })
})
