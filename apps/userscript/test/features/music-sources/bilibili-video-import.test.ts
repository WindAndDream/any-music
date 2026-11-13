import type { HttpClient } from '@any-music/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const gm = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('$', () => ({ GM_xmlhttpRequest: gm.request }))

const VIDEO_URL = 'https://www.bilibili.com/video/BV16a4y157MW/?from=episodes&p=2'
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

afterEach(() => {
  vi.unstubAllGlobals()
  gm.request.mockReset()
})

describe('Userscript Bilibili video parts through GM', () => {
  it.each(['www.bilibili.com', 'example.com'])(
    'keeps P2 identity, duration and authenticated media requests on %s',
    async (hostname) => {
      vi.resetModules()
      vi.stubGlobal('window', { location: { hostname } })
      vi.stubGlobal('location', { hostname })
      gm.request.mockImplementation((input) => {
        const url = new URL(input.url)
        const body =
          url.pathname === '/x/web-interface/view'
            ? VIEW
            : {
                quality: 16,
                timelength: 133_000,
                dash: {
                  audio: [
                    {
                      id: 30280,
                      bandwidth: 128_000,
                      codecs: 'mp4a.40.2',
                      baseUrl: 'https://media.example/p2.m4s',
                    },
                  ],
                },
                durl: [{ url: 'https://media.example/p2.mp4' }],
              }
        queueMicrotask(() =>
          input.onload({
            status: 200,
            statusText: 'OK',
            responseHeaders: '',
            responseText: JSON.stringify({ code: 0, data: body }),
            response: Uint8Array.of(1, 2, 3, 4).buffer,
          }),
        )
        return { abort: vi.fn() }
      })
      const { builtInMusicSources } =
        await import('@/features/music-sources/built-in-music-sources')
      const plugin = builtInMusicSources.find((source) => source.descriptor.id === 'bilibili')!
      const listing = plugin.importFromUrl({ url: VIDEO_URL })
      expect(gm.request).not.toHaveBeenCalled()
      const iterator = listing.pages()[Symbol.asyncIterator]()
      const result = await iterator.next()
      const track = result.value.items[0]!
      await iterator.return?.()
      expect(track).toMatchObject({
        id: 'bilibili:video:BV16a4y157MW:240288549',
        title: 'With You',
        durationMs: 133_000,
        source: { partId: '240288549', pageUrl: 'https://www.bilibili.com/video/BV16a4y157MW?p=2' },
      })
      const media = await plugin.resolveMedia(track)
      expect(media.type).toBe('remote-url')
      if (media.type !== 'remote-url') throw new Error('Expected remote media')
      expect(media.url).toBe(
        `https://media.example/p2.${hostname === 'www.bilibili.com' ? 'm4s' : 'mp4'}`,
      )
      const { gmHttpClient }: { gmHttpClient: HttpClient } =
        await import('@/platform/http/gm-http-client')
      await gmHttpClient.request({
        url: media.url,
        responseType: 'bytes',
        credentials: 'include',
        headers: { ...media.requestHeaders, Range: 'bytes=0-3' },
        maxResponseBytes: 4,
      })
      expect(gm.request).toHaveBeenCalledTimes(3)
      const requests = gm.request.mock.calls.map(([input]) => input)
      expect(requests.map((input) => new URL(input.url).pathname)).toEqual([
        '/x/web-interface/view',
        '/x/player/playurl',
        hostname === 'www.bilibili.com' ? '/p2.m4s' : '/p2.mp4',
      ])
      expect(new URL(requests[1].url).searchParams.get('cid')).toBe('240288549')
      for (const request of requests) expect(request.anonymous).toBe(false)
      expect(requests[2]).toMatchObject({
        headers: { Referer: 'https://www.bilibili.com/', Range: 'bytes=0-3' },
        responseType: 'arraybuffer',
      })
      expect(requests[2]).not.toHaveProperty('fetch')
    },
  )
})
