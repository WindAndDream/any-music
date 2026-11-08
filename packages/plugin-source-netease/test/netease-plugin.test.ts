import { AppError } from '@any-music/core'
import type { HttpRequest, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { NeteaseApi, NeteaseMusicSourcePlugin } from '../src/runtime'

const song = (id: number) => ({
  id,
  name: `歌曲 ${id}`,
  ar: [
    { id: 8, name: '歌手' },
    { id: 9, name: '合作者' },
  ],
  al: { id: 2, name: '专辑', picUrl: 'http://p1.music.126.net/cover.jpg' },
  dt: 180000,
})
function setup(values: unknown[]) {
  const queue = [...values]
  const request = vi.fn(async (_input: HttpRequest) => {
    const body = queue.shift()
    if (body instanceof Error) throw body
    return { status: 200, statusText: 'OK', headers: '', body: JSON.stringify(body) }
  })
  return { request, plugin: new NeteaseMusicSourcePlugin(new NeteaseApi({ request })) }
}
const track = {
  id: 'netease:audio:1',
  title: '歌曲',
  artists: [],
  durationMs: 180000,
  source: { pluginId: 'netease', mediaKind: 'audio' as const, resourceId: '1' },
}
const media = (extra = {}) => ({
  code: 200,
  data: [
    {
      id: 1,
      code: 200,
      url: 'http://m10.music.126.net/audio.mp3',
      level: 'exhigh',
      br: 320000,
      encodeType: 'mp3',
      ...extra,
    },
  ],
})

describe('NetEase portable source', () => {
  it('defers each search page and preserves multi-artist stable metadata', async () => {
    const { plugin, request } = setup([
      { code: 200, result: { songCount: 3, songs: [song(1), song(2)] } },
      { code: 200, result: { songCount: 3, songs: [song(3)] } },
    ])
    const listing = plugin.search({ query: '  测试  ', pageSize: 2 })
    expect(request).not.toHaveBeenCalled()
    const pages = listing.pages()[Symbol.asyncIterator]()
    const first = (await pages.next()).value!
    expect(first).toMatchObject({
      total: 3,
      hasMore: true,
      continuation: { kind: 'page', nextPage: 2 },
    })
    expect(first.items[0]).toMatchObject({
      id: 'netease:audio:1',
      artists: [
        { id: '8', name: '歌手' },
        { id: '9', name: '合作者' },
      ],
      durationMs: 180000,
      artworkUrl: 'https://p1.music.126.net/cover.jpg',
      source: { resourceId: '1' },
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]![0]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      maxResponseBytes: 4194304,
    })
    expect(Object.fromEntries(new URLSearchParams(request.mock.calls[0]![0].body))).toMatchObject({
      s: '测试',
      limit: '2',
      offset: '0',
      type: '1',
    })
    expect((await pages.next()).value).toMatchObject({ pageNumber: 2, hasMore: false })
    expect(request).toHaveBeenCalledTimes(2)
    expect(await pages.next()).toMatchObject({ done: true })
  })
  it('keeps named artists with zero IDs without rejecting a search page or inventing identities', async () => {
    const { plugin, request } = setup([
      {
        code: 200,
        result: {
          songCount: 3,
          songs: [
            {
              ...song(1),
              ar: [
                { id: 0, name: '童声演唱者' },
                { id: 9, name: '合作者' },
              ],
            },
            song(2),
          ],
        },
      },
      { code: 200, result: { songCount: 3, songs: [song(3)] } },
    ])
    const pages = plugin.search({ query: '童声', pageSize: 2 }).pages()[Symbol.asyncIterator]()
    const first = (await pages.next()).value!
    expect(first.items.map((item: Track) => item.id)).toEqual([
      'netease:audio:1',
      'netease:audio:2',
    ])
    expect(first.items[0]!.artists).toEqual([
      { id: undefined, name: '童声演唱者' },
      { id: '9', name: '合作者' },
    ])
    expect(request).toHaveBeenCalledOnce()
    expect((await pages.next()).value).toMatchObject({ pageNumber: 2, hasMore: false })
    expect(request).toHaveBeenCalledTimes(2)
    await pages.return?.()
  })

  it('still rejects zero song IDs', async () => {
    const { plugin } = setup([{ code: 200, result: { songCount: 1, songs: [song(0)] } }])
    await expect(
      plugin.search({ query: '童声' }).pages()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it.each([-1, 0.5, '0'])('still rejects a malformed artist ID %s', async (id) => {
    const { plugin } = setup([
      { code: 200, result: { songCount: 1, songs: [{ ...song(1), ar: [{ id, name: '歌手' }] }] } },
    ])
    await expect(
      plugin.search({ query: '童声' }).pages()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('loads complete playlist IDs once, slices details lazily, and restores upstream order', async () => {
    const { plugin, request } = setup([
      { code: 200, playlist: { name: '完整歌单', trackIds: [1, 2, 3, 4].map((id) => ({ id })) } },
      { code: 200, songs: [song(2), song(1)] },
      { code: 200, songs: [song(4), song(3)] },
    ])
    const listing = plugin.importFromUrl({
      url: 'https://music.163.com/#/playlist?id=5',
      pageSize: 2,
    })
    const iterator = listing.pages()[Symbol.asyncIterator]()
    expect(request).not.toHaveBeenCalled()
    expect((await iterator.next()).value!.items.map((item: Track) => item.id)).toEqual([
      'netease:audio:1',
      'netease:audio:2',
    ])
    expect(listing.title).toBe('完整歌单')
    expect(request).toHaveBeenCalledTimes(2)
    expect((await iterator.next()).value!.items.map((item: Track) => item.id)).toEqual([
      'netease:audio:3',
      'netease:audio:4',
    ])
    expect(request).toHaveBeenCalledTimes(3)
    expect(await iterator.next()).toMatchObject({ done: true })
    const manifest = new URL(request.mock.calls[0]![0].url)
    expect(Object.fromEntries(manifest.searchParams)).toEqual({ id: '5', n: '0', s: '0' })
  })
  it('stops on iterator close without prefetching details', async () => {
    const { plugin, request } = setup([
      { code: 200, playlist: { trackIds: [{ id: 1 }, { id: 2 }] } },
      { code: 200, songs: [song(1)] },
    ])
    for await (const page of plugin
      .importFromUrl({ url: 'https://music.163.com/playlist?id=5', pageSize: 1 })
      .pages()) {
      expect(page.hasMore).toBe(true)
      break
    }
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('resumes directly at the requested search offset', async () => {
    const { plugin, request } = setup([{ code: 200, result: { songCount: 30, songs: [song(21)] } }])
    for await (const page of plugin
      .search({ query: 'test', pageSize: 10 })
      .pages({ continuation: { kind: 'page', nextPage: 3 } }))
      expect(page.pageNumber).toBe(3)
    expect(new URLSearchParams(request.mock.calls[0]![0].body).get('offset')).toBe('20')
  })
  it('does not stop a playlist on a missing/deleted song', async () => {
    const { plugin, request } = setup([
      { code: 200, playlist: { trackIds: [{ id: 1 }, { id: 2 }] } },
      { code: 200, songs: [] },
      { code: 200, songs: [song(2)] },
    ])
    const pages = []
    for await (const page of plugin
      .importFromUrl({ url: 'https://music.163.com/playlist?id=5', pageSize: 1 })
      .pages())
      pages.push(page)
    expect(pages.map((page) => page.items.length)).toEqual([0, 1])
    expect(request).toHaveBeenCalledTimes(3)
  })
  it.each(['album', 'artist'] as const)(
    'imports %s metadata once with locally sliced pages',
    async (kind) => {
      const { plugin, request } = setup([
        {
          code: 200,
          [kind]: { name: '列表' },
          [kind === 'album' ? 'songs' : 'hotSongs']: [song(1), song(2)],
        },
      ])
      const pages = []
      for await (const page of plugin
        .importFromUrl({ url: `https://music.163.com/${kind}?id=5`, pageSize: 1 })
        .pages())
        pages.push(page)
      expect(pages).toHaveLength(2)
      expect(request).toHaveBeenCalledTimes(1)
    },
  )
  it('resolves one descriptor request, labels actual quality and performs no media reads', async () => {
    const { plugin, request } = setup([media()])
    expect(await plugin.resolveMedia(track)).toMatchObject({
      type: 'remote-url',
      url: 'https://m10.music.126.net/audio.mp3',
      quality: { id: 'netease:exhigh', bitrate: 320000 },
      availableQualities: [{ id: 'netease:exhigh' }],
      mimeType: 'audio/mpeg',
      loadingStrategy: 'range',
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(Object.fromEntries(new URLSearchParams(request.mock.calls[0]![0].body))).toEqual({
      ids: '[1]',
      level: 'jymaster',
      encodeType: 'flac',
    })
  })
  it.each([{ code: -110, url: null }, { freeTrialInfo: { start: 0, end: 30000 } }])(
    'rejects unavailable and trial-only media without fabricated success',
    async (value) => {
      const { plugin, request } = setup([media(value)])
      await expect(plugin.resolveMedia(track)).rejects.toMatchObject({ code: 'access-denied' })
      expect(request).toHaveBeenCalledTimes(1)
    },
  )
  it('rejects a downgraded explicit quality without replacing the requested selection', async () => {
    const { plugin } = setup([media()])
    await expect(plugin.resolveMedia(track, { qualityId: 'netease:hires' })).rejects.toMatchObject({
      code: 'not-found',
    })
  })
  it.each(['hires', ''])('rejects unsupported quality %s before a request', async (qualityId) => {
    const { plugin, request } = setup([])
    await expect(plugin.resolveMedia(track, { qualityId })).rejects.toMatchObject({
      code: 'invalid-input',
    })
    expect(request).not.toHaveBeenCalled()
  })
  it.each([
    'https://music.126.net.evil.example/a.mp3',
    'file:///tmp/a',
    'https://user:pass@m10.music.126.net/a.mp3',
  ])('rejects unsafe media %s', async (url) => {
    const { plugin } = setup([media({ url })])
    await expect(plugin.resolveMedia(track)).rejects.toMatchObject({ code: 'invalid-response' })
  })
  it('cancels before dispatch and rejects a late response, then allows a fresh retry', async () => {
    let cancelled = true
    const signal = { isCancelled: () => cancelled, subscribe: () => () => {} }
    const { plugin, request } = setup([media()])
    await expect(plugin.resolveMedia(track, { cancellation: signal })).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    expect(request).not.toHaveBeenCalled()
    cancelled = false
    request.mockImplementationOnce(async () => {
      cancelled = true
      return { status: 200, statusText: '', headers: '', body: JSON.stringify(media()) }
    })
    await expect(plugin.resolveMedia(track, { cancellation: signal })).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    cancelled = false
    await expect(plugin.resolveMedia(track, { cancellation: signal })).resolves.toMatchObject({
      type: 'remote-url',
    })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('passes listing cancellation to HTTP and never loads the next page', async () => {
    let cancelled = false
    const cancellation = { isCancelled: () => cancelled, subscribe: () => () => {} }
    const { plugin, request } = setup([{ code: 200, result: { songCount: 2, songs: [song(1)] } }])
    const listing = plugin.search({ query: 'test', pageSize: 1 })
    const pages = listing.pages({ cancellation })[Symbol.asyncIterator]()
    await pages.next()
    expect(request.mock.calls[0]![0].cancellation).toBe(cancellation)
    cancelled = true
    await expect(pages.next()).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('distinguishes signed-out, expiry, malformed response and connectivity', async () => {
    const { plugin } = setup([
      { code: 200, profile: null, account: null },
      { code: 301 },
      { code: 200 },
      new AppError('network-error'),
      { code: 200, profile: { userId: 5, nickname: '用户' }, account: { id: 5 } },
    ])
    expect(await plugin.getSession()).toEqual({ status: 'signed-out' })
    expect(await plugin.getSession()).toMatchObject({
      status: 'expired',
      error: { code: 'not-authenticated' },
    })
    expect(await plugin.getSession()).toMatchObject({
      status: 'unavailable',
      error: { code: 'invalid-response' },
    })
    expect(await plugin.getSession()).toMatchObject({
      status: 'unavailable',
      error: { code: 'network-error' },
    })
    expect(await plugin.getSession()).toMatchObject({
      status: 'signed-in',
      user: { id: '5', name: '用户' },
    })
  })
  it.each([301, 403, 405, 429, -460])(
    'does not replay search on business error %s',
    async (code) => {
      const { plugin, request } = setup([{ code }])
      await expect(
        plugin.search({ query: 'test' }).pages()[Symbol.asyncIterator]().next(),
      ).rejects.toBeInstanceOf(AppError)
      expect(request).toHaveBeenCalledTimes(1)
    },
  )
  it.each([
    { code: 200 },
    { code: 200, result: { songCount: 1, songs: [{ id: 1 }] } },
    { result: {} },
  ])('rejects malformed successful envelopes', async (value) => {
    const { plugin } = setup([value])
    await expect(
      plugin.search({ query: 'test' }).pages()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
