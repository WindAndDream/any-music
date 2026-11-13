import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NativeAccount } from '@/features/accounts/account-runtime'
import { AccountRuntime } from '@/features/accounts/account-runtime'
import { createBuiltInMusicSources } from '@/features/music-sources/built-in-music-sources'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
afterEach(() => native.invoke.mockReset())

function frame(value: unknown): ArrayBuffer {
  const metadata = new TextEncoder().encode(
    JSON.stringify({ status: 200, statusText: 'OK', headers: '', responseType: 'text' }),
  )
  const body = new TextEncoder().encode(JSON.stringify(value))
  const buffer = new ArrayBuffer(4 + metadata.length + body.length)
  new DataView(buffer).setUint32(0, metadata.length)
  new Uint8Array(buffer, 4).set(metadata)
  new Uint8Array(buffer, 4 + metadata.length).set(body)
  return buffer
}

describe('NetEase desktop account composition', () => {
  it('pins API requests to native accounts and grants media through Rust without reading bytes', async () => {
    const account: NativeAccount = {
      id: '2f0a12ea-4345-47bc-849d-49e279f75f28',
      platformId: 'netease',
      name: '网易云账号',
      enabled: true,
      status: 'ready',
      authentication: 'credential',
      userAgent: 'native-agent',
      webId: '1',
      proxyId: null,
      backupProxyIds: [],
      state: { login: 'signed-in', verification: 'not-required', connection: 'available' },
    }
    native.invoke.mockImplementation(async (command, input) => {
      if (command === 'account_snapshot') return { accounts: [account], proxies: [] }
      if (command === 'http_request') {
        if (input.request.url.includes('cloudsearch'))
          return frame({
            code: 200,
            result: {
              songCount: 1,
              songs: [{ id: 1, name: '歌曲', ar: [{ id: 8, name: '歌手' }], dt: 180000 }],
            },
          })
        return frame({
          code: 200,
          data: [
            {
              id: 1,
              code: 200,
              url: 'https://m10.music.126.net/audio.mp3',
              level: 'exhigh',
              encodeType: 'mp3',
              br: 320000,
            },
          ],
        })
      }
      if (command === 'register_media') return 'http://127.0.0.1:12345/media/native-grant'
    })
    const runtime = new AccountRuntime()
    await runtime.refresh()
    const source = createBuiltInMusicSources(runtime, 'desktop').find(
      (plugin) => plugin.descriptor.id === 'netease',
    )!
    const iterator = source.search({ query: '歌曲' }).pages()[Symbol.asyncIterator]()
    const page = await iterator.next()
    expect(page.done).toBe(false)
    const track = page.value!.items[0]!
    await iterator.return?.()
    const media = await source.resolveMedia(track)
    expect(media).toMatchObject({
      accountId: account.id,
      url: 'http://127.0.0.1:12345/media/native-grant',
      requestHeaders: undefined,
    })
    const requests = native.invoke.mock.calls.filter(([command]) => command === 'http_request')
    expect(requests).toHaveLength(2)
    for (const [, { request }] of requests)
      expect(request).toMatchObject({
        accountId: account.id,
        credentials: 'include',
        responseType: 'text',
      })
    expect(native.invoke).toHaveBeenCalledWith(
      'register_media',
      expect.objectContaining({
        accountId: account.id,
        url: 'https://m10.music.126.net/audio.mp3',
        headers: { Referer: 'https://music.163.com/' },
      }),
    )
    media.release?.()
    media.release?.()
    expect(
      native.invoke.mock.calls.filter(([command]) => command === 'release_media'),
    ).toHaveLength(1)
  })
})
