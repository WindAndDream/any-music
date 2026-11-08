import { AppError } from '@any-music/core'
import type { HttpClient, MusicSourcePlugin, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { BilibiliApi } from '../src/bilibili-api'
import { BilibiliMusicSourcePlugin } from '../src/bilibili-plugin'

const VIDEO_DURATION_MS = 43_200_000
const PART_DURATION_MS = 253_000
const LISTINGS = [
  { kind: 'search', url: undefined, path: '/x/web-interface/wbi/search/type', signing: true },
  {
    kind: 'uploads',
    url: 'https://space.bilibili.com/1/upload/video',
    path: '/x/space/wbi/arc/search',
    signing: true,
  },
  {
    kind: 'season',
    url: 'https://space.bilibili.com/1/lists/2',
    path: '/x/polymer/web-space/seasons_archives_list',
    signing: false,
  },
  {
    kind: 'favorite',
    url: 'https://space.bilibili.com/1/favlist?fid=2',
    path: '/x/v3/fav/resource/list',
    signing: false,
  },
] as const

function response(data: unknown) {
  return { status: 200, statusText: 'OK', headers: '', body: JSON.stringify({ code: 0, data }) }
}

function createPlugin(
  count = 2,
  beforeView?: (request: Parameters<HttpClient['request']>[0]) => Promise<void>,
) {
  const summaries = Array.from({ length: count }, (_, index) => ({
    bvid: `BV1xx411c7m${index}`,
    title: index === 0 ? '好听的纯音乐合集' : `歌曲 ${index}`,
    mid: 1,
    author: 'UP',
    upper: { mid: 1, name: 'UP' },
    ugc: { first_cid: index * 10 + 1 },
    duration: '720:00',
    length: '720:00',
  }))
  const request = vi.fn<HttpClient['request']>(async (input) => {
    const url = new URL(input.url)
    switch (url.pathname) {
      case '/x/web-interface/nav':
        return response({
          wbi_img: {
            img_url: `https://example.com/${'a'.repeat(32)}.png`,
            sub_url: `https://example.com/${'b'.repeat(32)}.png`,
          },
        })
      case '/x/web-interface/wbi/search/type':
        return response({ page: 1, pagesize: count, numResults: count + 1, result: summaries })
      case '/x/space/wbi/arc/search':
        return response({
          page: { pn: 1, ps: count, count: count + 1 },
          list: { vlist: summaries },
        })
      case '/x/polymer/web-space/seasons_archives_list':
        return response({
          page: { page_num: 1, page_size: count, total: count + 1 },
          meta: { mid: 1, name: 'UP', title: '收藏', total: count + 1 },
          archives: summaries.map((item) => ({ ...item, duration: VIDEO_DURATION_MS / 1000 })),
        })
      case '/x/v3/fav/resource/list':
        return response({
          info: { id: 2, title: '收藏', media_count: count + 1 },
          medias: summaries.map((item) => ({ ...item, duration: VIDEO_DURATION_MS / 1000 })),
          has_more: true,
        })
      case '/x/web-interface/view': {
        await beforeView?.(input)
        const index = summaries.findIndex((item) => item.bvid === url.searchParams.get('bvid'))
        return response({
          ...summaries[index],
          owner: { mid: 1, name: 'UP' },
          duration: VIDEO_DURATION_MS / 1000,
          // Deliberately out of order: default playback always means page 1.
          pages: [
            { page: 2, cid: index * 10 + 2, part: '另一首歌', duration: 301 },
            { page: 1, cid: index * 10 + 1, part: '第一首歌', duration: PART_DURATION_MS / 1000 },
          ],
        })
      }
      case '/x/player/playurl':
        return response({
          quality: 16,
          timelength: PART_DURATION_MS,
          durl: [{ url: 'https://media.example/first.mp4' }],
        })
      default:
        throw new Error(`Unexpected request: ${input.url}`)
    }
  })
  return {
    request,
    plugin: new BilibiliMusicSourcePlugin(new BilibiliApi({ request }), () => false),
  }
}

function listing(plugin: MusicSourcePlugin, url?: string) {
  return url ? plugin.importFromUrl({ url }) : plugin.search({ query: '纯音乐', pageSize: 2 })
}

describe('Bilibili listing media metadata', () => {
  it.each(LISTINGS)(
    'uses P1 duration instead of multipart totals in $kind without loading another page',
    async ({ url, path, signing }) => {
      const { plugin, request } = createPlugin()
      const iterator = listing(plugin, url).pages()[Symbol.asyncIterator]()
      expect(request).not.toHaveBeenCalled()
      const page = await iterator.next()
      expect(page.value.items[0]).toMatchObject({
        id: 'bilibili:video:BV1xx411c7m0',
        title: '好听的纯音乐合集',
        durationMs: PART_DURATION_MS,
        source: { partId: '1', pageUrl: 'https://www.bilibili.com/video/BV1xx411c7m0' },
      })
      expect(page.value.items[1]).toMatchObject({
        id: 'bilibili:video:BV1xx411c7m1',
        durationMs: PART_DURATION_MS,
        source: { partId: '11' },
      })
      expect(page.value).toMatchObject({
        hasMore: true,
        continuation: { kind: 'page', nextPage: 2 },
      })
      await iterator.return?.()
      expect(request.mock.calls.map(([input]) => new URL(input.url).pathname)).toEqual([
        ...(signing ? ['/x/web-interface/nav'] : []),
        path,
        '/x/web-interface/view',
        '/x/web-interface/view',
      ])
      await expect(plugin.resolveMedia(page.value.items[0]!)).resolves.toMatchObject({
        durationMs: PART_DURATION_MS,
      })
      expect(new URL(request.mock.lastCall![0].url).searchParams.get('cid')).toBe('1')
      expect(request).toHaveBeenCalledTimes((signing ? 1 : 0) + 4)
      for (const [input] of request.mock.calls) expect(input.credentials).toBe('include')
    },
  )

  it('bounds detail concurrency, retains row order and waits for the entire consumed page', async () => {
    const release = new Map<string, () => void>()
    let active = 0
    let maximum = 0
    const { plugin, request } = createPlugin(5, async (input) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve) => release.set(input.url, resolve))
      active -= 1
    })
    const iterator = listing(plugin, LISTINGS[3].url).pages()[Symbol.asyncIterator]()
    const pending = iterator.next()
    await vi.waitFor(() => expect(release.size).toBe(3))
    const firstBatch = [...release.values()]
    firstBatch[2]!()
    await vi.waitFor(() => expect(release.size).toBe(4))
    firstBatch[1]!()
    await vi.waitFor(() => expect(release.size).toBe(5))
    for (const resolve of release.values()) resolve()
    const page = await pending
    expect(maximum).toBe(3)
    expect(page.value.items.map((track: Track) => track.source.partId)).toEqual([
      '1',
      '11',
      '21',
      '31',
      '41',
    ])
    await iterator.return?.()
    expect(request).toHaveBeenCalledTimes(6)
  })

  it('cancels in-flight details, schedules no remaining rows and permits a fresh retry', async () => {
    const controller = new AbortController()
    const { plugin, request } = createPlugin(5, async (input) => {
      if (!input.cancellation) return
      await new Promise<void>((_resolve, reject) => {
        input.cancellation!.subscribe(() => reject(new AppError('operation-cancelled')))
      })
    })
    const pages = listing(plugin, LISTINGS[3].url).pages({
      cancellation: {
        isCancelled: () => controller.signal.aborted,
        subscribe(listener) {
          controller.signal.addEventListener('abort', listener, { once: true })
          return () => controller.signal.removeEventListener('abort', listener)
        },
      },
    })
    const iterator = pages[Symbol.asyncIterator]()
    const pending = iterator.next()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(request).toHaveBeenCalledTimes(4)
    const retry = listing(plugin, LISTINGS[3].url).pages()[Symbol.asyncIterator]()
    expect((await retry.next()).value.items).toHaveLength(5)
    await retry.return?.()
    expect(request).toHaveBeenCalledTimes(10)
  })

  it('retains unavailable rows with unknown duration rather than the aggregate total', async () => {
    const { plugin, request } = createPlugin(1)
    const originalRequest = request.getMockImplementation()!
    request.mockImplementation(async (input) => {
      if (new URL(input.url).pathname !== '/x/web-interface/view') return originalRequest(input)
      return {
        ...response(undefined),
        body: JSON.stringify({ code: -404, message: '不存在', data: null }),
      }
    })
    const iterator = listing(plugin, LISTINGS[3].url).pages()[Symbol.asyncIterator]()
    const page = await iterator.next()
    expect(page.value.items[0]).toMatchObject({ id: 'bilibili:video:BV1xx411c7m0' })
    expect(page.value.items[0]!.durationMs).toBeUndefined()
    await iterator.return?.()
  })
})
