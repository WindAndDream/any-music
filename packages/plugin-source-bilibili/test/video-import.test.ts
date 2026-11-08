import { AppError } from '@any-music/core'
import type { HttpClient, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { BilibiliApi } from '../src/bilibili-api'
import { BilibiliMusicSourcePlugin } from '../src/bilibili-plugin'
import type { BilibiliVideoViewData } from '../src/types'

const VIDEO_URL = 'https://www.bilibili.com/video/BV16a4y157MW/'
const VIEW: BilibiliVideoViewData = {
  bvid: 'BV16a4y157MW',
  aid: 1,
  title: 'BGM 合集',
  duration: 10_195,
  owner: { mid: 1, name: '测试 UP' },
  pages: [
    { page: 1, cid: 240288171, part: '046 Ikson - Wander', duration: 133 },
    { page: 2, cid: 240288549, part: '047 Ikson - With You', duration: 133 },
  ],
}

function createPlugin(view = VIEW) {
  const request = vi.fn<HttpClient['request']>(async (input) => {
    const url = new URL(input.url)
    return {
      status: 200,
      statusText: 'OK',
      headers: '',
      body: JSON.stringify({
        code: 0,
        data:
          url.pathname === '/x/web-interface/view'
            ? view
            : {
                quality: 16,
                timelength: 133_000,
                durl: [{ url: `https://media.example/${url.searchParams.get('cid')}.mp4` }],
              },
      }),
    }
  })
  return {
    request,
    plugin: new BilibiliMusicSourcePlugin(new BilibiliApi({ request }), () => false),
  }
}

async function importTrack(plugin: BilibiliMusicSourcePlugin, url: string): Promise<Track> {
  const iterator = plugin.importFromUrl({ url }).pages()[Symbol.asyncIterator]()
  const page = await iterator.next()
  await iterator.return?.()
  return page.value.items[0]!
}

describe('Bilibili video part imports', () => {
  it.each([undefined, 1, 2])(
    'resolves a saved track without CID using URL part %s and never the aggregate duration',
    async (part) => {
      const { plugin, request } = createPlugin()
      const track: Track = {
        id: 'bilibili:video:BV16a4y157MW',
        title: VIEW.title,
        artists: [],
        durationMs: VIEW.duration * 1000,
        source: {
          pluginId: 'bilibili',
          mediaKind: 'video',
          resourceId: VIEW.bvid,
          pageUrl: `${VIDEO_URL}${part ? `?p=${part}` : ''}`,
        },
      }
      // Missing timing in playurl must still use the selected page's duration, not view.duration.
      const originalRequest = request.getMockImplementation()!
      request.mockImplementation(async (input) => {
        if (new URL(input.url).pathname !== '/x/player/playurl') return originalRequest(input)
        return {
          status: 200,
          statusText: 'OK',
          headers: '',
          body: JSON.stringify({
            code: 0,
            data: { quality: 16, durl: [{ url: 'https://media.example/part.mp4' }] },
          }),
        }
      })
      await expect(plugin.resolveMedia(track)).resolves.toMatchObject({ durationMs: 133_000 })
      expect(request).toHaveBeenCalledTimes(2)
      expect(new URL(request.mock.lastCall![0].url).searchParams.get('cid')).toBe(
        part === 2 ? '240288549' : '240288171',
      )
    },
  )

  it('lazily imports P2 and resolves only its CID without fetching metadata again', async () => {
    const { plugin, request } = createPlugin()
    const listing = plugin.importFromUrl({ url: `${VIDEO_URL}?from=episodes&p=2` })
    const iterator = listing.pages()[Symbol.asyncIterator]()
    expect(request).not.toHaveBeenCalled()
    const page = await iterator.next()
    const track = page.value.items[0]!
    expect(track).toMatchObject({
      id: 'bilibili:video:BV16a4y157MW:240288549',
      title: '047 Ikson - With You',
      durationMs: 133_000,
      source: {
        resourceId: 'BV16a4y157MW',
        partId: '240288549',
        pageUrl: 'https://www.bilibili.com/video/BV16a4y157MW?p=2',
      },
    })
    expect(page.value).toMatchObject({ total: 1, hasMore: false })
    expect((await iterator.next()).done).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    await expect(plugin.resolveMedia(track)).resolves.toMatchObject({
      url: 'https://media.example/240288549.mp4',
      durationMs: 133_000,
    })
    expect(request.mock.calls.map(([input]) => new URL(input.url).pathname)).toEqual([
      '/x/web-interface/view',
      '/x/player/playurl',
    ])
    expect(new URL(request.mock.lastCall![0].url).searchParams.get('cid')).toBe('240288549')
    for (const [input] of request.mock.calls) expect(input.credentials).toBe('include')
  })

  it('retains the first-part identity and separates other parts for queues and downloads', async () => {
    const { plugin } = createPlugin()
    const first = await importTrack(plugin, VIDEO_URL)
    const explicitFirst = await importTrack(plugin, `${VIDEO_URL}?p=1`)
    const second = await importTrack(plugin, `${VIDEO_URL}?p=2`)
    expect(first).toMatchObject({
      id: 'bilibili:video:BV16a4y157MW',
      title: '046 Ikson - Wander',
      durationMs: 133_000,
      source: { partId: '240288171', pageUrl: 'https://www.bilibili.com/video/BV16a4y157MW' },
    })
    expect(explicitFirst).toEqual(first)
    expect(second.id).not.toBe(first.id)
  })

  it('preserves the video title for a single-part upload and uses its playable duration', async () => {
    const { plugin } = createPlugin({ ...VIEW, pages: VIEW.pages!.slice(0, 1) })
    expect(await importTrack(plugin, VIDEO_URL)).toMatchObject({
      title: VIEW.title,
      durationMs: 133_000,
    })
  })

  it('preserves a genuinely long single-part recording instead of guessing from its duration', async () => {
    const { plugin } = createPlugin({
      ...VIEW,
      duration: 43_200,
      pages: [{ ...VIEW.pages![0]!, duration: 43_200 }],
    })
    expect(await importTrack(plugin, VIDEO_URL)).toMatchObject({
      title: VIEW.title,
      durationMs: 43_200_000,
      source: { partId: '240288171' },
    })
  })

  it('selects by the upstream page number even when pages are out of order', async () => {
    const { plugin } = createPlugin({ ...VIEW, pages: VIEW.pages!.toReversed() })
    expect(await importTrack(plugin, `${VIDEO_URL}?p=2`)).toMatchObject({
      source: { partId: '240288549' },
    })
  })

  it('rejects a missing part without resolving or silently downloading P1', async () => {
    const { plugin, request } = createPlugin()
    await expect(importTrack(plugin, `${VIDEO_URL}?p=3`)).rejects.toMatchObject({
      code: 'not-found',
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('keeps missing playable metadata distinct from an unavailable part', async () => {
    const { plugin } = createPlugin({ ...VIEW, pages: [] })
    await expect(importTrack(plugin, VIDEO_URL)).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it.each([
    { cid: 0, duration: 133 },
    { cid: 240288549, duration: 0 },
  ])('rejects malformed selected-part metadata without falling back to P1: %j', async (fields) => {
    const { plugin, request } = createPlugin({
      ...VIEW,
      pages: [VIEW.pages![0]!, { ...VIEW.pages![1]!, ...fields }],
    })
    await expect(importTrack(plugin, `${VIDEO_URL}?p=2`)).rejects.toMatchObject({
      code: 'invalid-response',
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('cancels an import before media resolution and allows a fresh retry', async () => {
    const { plugin, request } = createPlugin()
    const controller = new AbortController()
    request.mockImplementationOnce(
      (input) =>
        new Promise((_resolve, reject) => {
          input.cancellation?.subscribe(() => reject(new AppError('operation-cancelled')))
        }),
    )
    const listing = plugin.importFromUrl({ url: `${VIDEO_URL}?p=2` }).pages({
      cancellation: {
        isCancelled: () => controller.signal.aborted,
        subscribe(listener) {
          controller.signal.addEventListener('abort', listener, { once: true })
          return () => controller.signal.removeEventListener('abort', listener)
        },
      },
    })
    const iterator = listing[Symbol.asyncIterator]()
    const pending = iterator.next()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(request).toHaveBeenCalledOnce()
    expect(await importTrack(plugin, `${VIDEO_URL}?p=2`)).toMatchObject({
      source: { partId: '240288549' },
    })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
