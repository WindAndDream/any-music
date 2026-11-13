import { AppError, MusicSourceError } from '@any-music/core'
import type { HttpClient, HttpRequest, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { DouyinApi, DouyinRiskControlError } from '../src/douyin-api'
import { DouyinMusicSourcePlugin } from '../src/douyin-plugin'
import type { DouyinProtectedPageSource } from '../src/runtime-contracts'

describe('Douyin search listings', () => {
  it('resumes search with the exact retained cursor rather than deriving an offset from page size', async () => {
    const load = vi.fn().mockResolvedValue({
      status_code: 0,
      data: [{ type: 1, aweme_info: aweme('work') }],
      cursor: 41,
      has_more: 1,
    })
    const close = vi.fn().mockResolvedValue(undefined)
    const plugin = new DouyinMusicSourcePlugin({
      openSearch: () => ({ load, close }),
    } as unknown as DouyinApi)
    const listing = plugin.search({ query: '音乐' })
    const pagesToResume = listing.pages({
      continuation: { kind: 'cursor', nextPage: 3, cursor: 27 },
    })
    const iterator = pagesToResume[Symbol.asyncIterator]()
    expect(load).not.toHaveBeenCalled()
    const next = await iterator.next()
    expect(load).toHaveBeenCalledExactlyOnceWith(27)
    expect(next.value).toMatchObject({
      pageNumber: 3,
      continuation: { kind: 'cursor', nextPage: 4, cursor: 41 },
    })
    await iterator.return?.()
    expect(close).toHaveBeenCalledOnce()
  })
  it.each(['search', 'media'])(
    'cancels %s at HTTP without continuing a fallback and permits an explicit retry',
    async (kind) => {
      const controller = new AbortController()
      const cancellation = {
        isCancelled: () => controller.signal.aborted,
        subscribe(listener: () => void) {
          controller.signal.addEventListener('abort', listener)
          return () => controller.signal.removeEventListener('abort', listener)
        },
      }
      const request = vi.fn(
        (input: HttpRequest) =>
          new Promise<never>((_resolve, reject) => {
            input.cancellation?.subscribe(() => reject(new AppError('operation-cancelled')))
          }),
      )
      const fallback = vi.fn()
      const plugin = new DouyinMusicSourcePlugin(new DouyinApi({ request }, createRequestState), {
        isCurrentPage: () => false,
        getCapturedAwemePage: fallback,
      })
      const pending =
        kind === 'search'
          ? plugin.search({ query: '音乐' }).pages({ cancellation })[Symbol.asyncIterator]().next()
          : plugin.resolveMedia(createVideoTrack('123'), { cancellation })
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
      expect(request.mock.lastCall?.[0].credentials).toBe('include')
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
      expect(request).toHaveBeenCalledTimes(1)
      expect(fallback).not.toHaveBeenCalled()
      // A fresh user request owns a fresh signal; cancellation is never stored on the shared API.
      request.mockImplementation(async () => {
        throw new AppError('network-error')
      })
      await expect(
        plugin.search({ query: '重试' }).pages()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({ code: 'network-error' })
      expect(request).toHaveBeenCalledTimes(2)
    },
  )
  it.each([undefined, null, {}])(
    'reports a missing or malformed result list after one request instead of an empty success: %j',
    async (data) => {
      const load = vi.fn().mockResolvedValue({ status_code: 0, data, has_more: 0 })
      const close = vi.fn().mockResolvedValue(undefined)
      const plugin = new DouyinMusicSourcePlugin({
        openSearch: () => ({ load, close }),
      } as unknown as DouyinApi)
      await expect(
        plugin.search({ query: '周杰伦' }).pages()[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({
        code: 'invalid-response',
        message: '抖音搜索响应缺少有效的结果列表。',
      })
      expect(load).toHaveBeenCalledExactlyOnceWith(0)
      expect(close).toHaveBeenCalledOnce()
    },
  )

  it('keeps an explicit empty first page successful but rejects an empty page promising more', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ status_code: 0, data: [], has_more: 0 })
      .mockResolvedValueOnce({ status_code: 0, data: [], has_more: 1, cursor: 10 })
    const close = vi.fn().mockResolvedValue(undefined)
    const plugin = new DouyinMusicSourcePlugin({
      openSearch: () => ({ load, close }),
    } as unknown as DouyinApi)
    const listing = plugin.search({ query: '周杰伦' })
    const first = listing.pages()[Symbol.asyncIterator]()
    await expect(first.next()).resolves.toMatchObject({ value: { items: [], hasMore: false } })
    await first.return?.()
    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'invalid-response',
      message: '抖音搜索响应声明还有结果，但未返回当前页内容。',
    })
    expect(load.mock.calls).toEqual([[0], [0]])
    expect(close).toHaveBeenCalledTimes(2)
  })

  it.each([
    { status_code: 0, data: [], has_more: 0, result_status: 5 },
    { status_code: 0, data: [], hasMore: false, result_status: 2 },
    { status_code: 0, data: [] },
  ])('rejects an ambiguous empty first page instead of caching no results: %j', async (data) => {
    const load = vi.fn().mockResolvedValue(data)
    const close = vi.fn().mockResolvedValue(undefined)
    const plugin = new DouyinMusicSourcePlugin({
      openSearch: () => ({ load, close }),
    } as unknown as DouyinApi)
    await expect(
      plugin.search({ query: '动漫歌曲' }).pages()[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ code: 'invalid-response' })
    expect(load).toHaveBeenCalledExactlyOnceWith(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it.each([0, false])(
    'accepts an explicit terminal page after seven useful pages: %s',
    async (has_more) => {
      const load = vi.fn(async (offset: number) =>
        offset < 70
          ? {
              status_code: 0,
              data: [{ aweme_info: aweme(`page-${offset}`) }],
              cursor: offset + 10,
              has_more: 1,
            }
          : { status_code: 0, result_status: 0, data: [], cursor: offset, has_more },
      )
      const close = vi.fn().mockResolvedValue(undefined)
      const plugin = new DouyinMusicSourcePlugin({
        openSearch: () => ({ load, close }),
      } as unknown as DouyinApi)
      const pages = []
      for await (const page of plugin.search({ query: '音乐' }).pages()) pages.push(page)
      expect(pages).toHaveLength(8)
      expect(pages.at(-1)).toMatchObject({ items: [], hasMore: false, pageNumber: 8 })
      expect(pages.at(-1)?.continuation).toBeUndefined()
      expect(load.mock.calls).toEqual([0, 10, 20, 30, 40, 50, 60, 70].map((offset) => [offset]))
      expect(close).toHaveBeenCalledOnce()
    },
  )

  it('keeps an empty later page without a termination flag distinct from normal exhaustion', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ aweme_info: aweme('first') }], cursor: 10, has_more: 1 })
      .mockResolvedValueOnce({ status_code: 0, data: [] })
    const close = vi.fn().mockResolvedValue(undefined)
    const plugin = new DouyinMusicSourcePlugin({
      openSearch: () => ({ load, close }),
    } as unknown as DouyinApi)
    const iterator = plugin.search({ query: '音乐' }).pages()[Symbol.asyncIterator]()
    await iterator.next()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'pagination-unavailable' })
    expect(load.mock.calls).toEqual([[0], [10]])
    expect(close).toHaveBeenCalledOnce()
  })

  it('loads browser pages lazily and closes the target when consumption stops or fails', async () => {
    const load = vi.fn().mockResolvedValue({
      status_code: 0,
      data: [{ type: 1, aweme_info: aweme('work') }],
      cursor: 10,
      has_more: 1,
    })
    const close = vi.fn().mockResolvedValue(undefined)
    const openSearch = vi.fn(() => ({ load, close }))
    const plugin = new DouyinMusicSourcePlugin({ openSearch } as unknown as DouyinApi)
    const listing = plugin.search({ query: '音乐' })
    expect(openSearch).not.toHaveBeenCalled()
    const iterator = listing.pages()[Symbol.asyncIterator]()
    await iterator.next()
    expect(load).toHaveBeenCalledExactlyOnceWith(0)
    await iterator.return?.()
    expect(close).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
    const retry = listing.pages()[Symbol.asyncIterator]()
    load.mockRejectedValueOnce(new AppError('operation-cancelled'))
    await expect(retry.next()).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(close).toHaveBeenCalledTimes(2)
  })
  it('keeps work cards but drops live and unrelated search cards', async () => {
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes() {
        return {
          data: [
            {
              type: 1,
              doc_type: 156,
              aweme_info: {
                aweme_id: 'live-card',
                aweme_type: 101,
                video: { bit_rate: [{ bit_rate: 128_000 }] },
              },
            },
            { type: 1, doc_type: 153, aweme_info: aweme('video-work') },
            { type: 6, doc_type: 108 },
            { type: 77, doc_type: 305 },
            {
              aweme_info: {
                aweme_id: 'note-work',
                aweme_type: 68,
                images: [{ url_list: ['https://image.example/note.jpg'] }],
                music: { title: '图文配乐' },
              },
            },
          ],
          has_more: 0,
        }
      },
    } as unknown as DouyinApi

    const listing = new DouyinMusicSourcePlugin(api).search({ query: '音乐' })
    const iterator = listing.pages()[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        items: [{ id: 'douyin:video:video-work' }, { id: 'douyin:video:note-work' }],
        hasMore: false,
      },
    })
  })

  it('excludes live works when either captured live marker is present', async () => {
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes() {
        return {
          data: [
            { aweme_info: { ...aweme('live-by-aweme-type'), aweme_type: 101 } },
            { doc_type: 156, aweme_info: aweme('live-by-document-type') },
          ],
          has_more: 0,
        }
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '华语' })

    await expect(listing.pages()[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { items: [], hasMore: false },
    })
  })

  it('keeps later search pages reachable when the current page contains only non-work cards', async () => {
    const calls: number[] = []
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes(_query: string, offset: number) {
        calls.push(offset)
        return offset === 0
          ? {
              data: [
                {
                  type: 1,
                  doc_type: 156,
                  aweme_info: { ...aweme('live-card'), aweme_type: 101 },
                },
              ],
              has_more: 1,
              cursor: 10,
            }
          : {
              data: [{ type: 1, doc_type: 153, aweme_info: aweme('music-work') }],
              has_more: 0,
              cursor: 20,
            }
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '音乐' })
    const iterator = listing.pages()[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { items: [], hasMore: true },
    })
    expect(calls).toEqual([0])
    await expect(iterator.next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:music-work' }], hasMore: false },
    })
    expect(calls).toEqual([0, 10])
  })

  it('keeps the native ten-item search contract separate from account list page sizes', async () => {
    const calls: Array<{ query: string; offset: number; count: number }> = []
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes(query: string, offset: number, count: number) {
        calls.push({ query, offset, count })
        return { data: [], has_more: 0 }
      },
    } as unknown as DouyinApi
    const plugin = new DouyinMusicSourcePlugin(api)
    const textSearch = plugin.search({ query: '音乐', pageSize: 18 })
    const urlSearch = plugin.importFromUrl({
      url: 'https://www.douyin.com/search/%E5%8F%A4%E9%A3%8E?type=general',
      pageSize: 18,
    })
    expect(urlSearch.sourceUrl).toBe(
      'https://www.douyin.com/jingxuan/search/%E5%8F%A4%E9%A3%8E?type=general',
    )

    await textSearch.pages()[Symbol.asyncIterator]().next()
    await urlSearch.pages()[Symbol.asyncIterator]().next()

    expect(calls).toEqual([
      { query: '音乐', offset: 0, count: 10 },
      { query: '古风', offset: 0, count: 10 },
    ])
  })

  it('exposes the matching search page when risk control requires user verification', async () => {
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes() {
        throw new DouyinRiskControlError()
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '周杰伦' })

    expect(listing.sourceUrl).toBe(
      'https://www.douyin.com/jingxuan/search/%E5%91%A8%E6%9D%B0%E4%BC%A6?type=general',
    )
    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'verification-required',
      statusCode: 'AM-3005',
    })
  })

  it('recognizes a first-page verification challenge inside a successful empty search response', async () => {
    const calls: number[] = []
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes(_query: string, offset: number) {
        calls.push(offset)
        return {
          status_code: 0,
          result_status: 5,
          data: [],
          has_more: 0,
          search_nil_info: { search_nil_type: 'verify_check' },
        }
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '首屏验证' })

    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'verification-required',
      statusCode: 'AM-3005',
    })
    expect(calls).toEqual([0])
  })

  it('keeps the first page and identifies a later empty verification response', async () => {
    const calls: number[] = []
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes(_query: string, offset: number) {
        calls.push(offset)
        return offset === 0
          ? { status_code: 0, data: [{ aweme_info: aweme('first-page') }], has_more: 1, cursor: 10 }
          : {
              status_code: 0,
              result_status: 5,
              data: [],
              has_more: 0,
              search_nil_info: { search_nil_type: 'verify_check' },
            }
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '翻页验证' })
    const iterator = listing.pages()[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:first-page' }], hasMore: true },
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'verification-required',
      statusCode: 'AM-3005',
    })
    expect(calls).toEqual([0, 10])
  })

  it('keeps the first page meaningful when Douyin returns an empty promised follow-up page', async () => {
    let requestCount = 0
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes() {
        requestCount += 1
        return requestCount === 1
          ? { data: [{ aweme_info: aweme('first-page') }], has_more: 1, cursor: 10 }
          : { status_code: 0, result_status: 5, data: [], has_more: 0, cursor: 10 }
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '高频搜索' })
    const iterator = listing.pages()[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:first-page' }], hasMore: true },
    })
    await expect(iterator.next()).rejects.toMatchObject({
      code: 'pagination-unavailable',
      statusCode: 'AM-3006',
      message: '抖音搜索的后续结果暂时无法获取，已加载的歌曲仍可使用。请稍后重试。',
    })
  })

  it('keeps an offline follow-up page distinct from Douyin pagination limits', async () => {
    let requestCount = 0
    const api = {
      openSearch: DouyinApi.prototype.openSearch,
      async searchAwemes() {
        requestCount += 1
        if (requestCount === 1) {
          return { data: [{ aweme_info: aweme('first-page') }], has_more: 1, cursor: 10 }
        }
        throw new AppError('network-error', '网络连接已中断。')
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).search({ query: '断网搜索' })
    const iterator = listing.pages()[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:first-page' }], hasMore: true },
    })
    await expect(iterator.next()).rejects.toMatchObject({ code: 'network-error' })
    expect(requestCount).toBe(2)
  })
})

describe('Douyin user mix listings', () => {
  it('expands directories and mix pages lazily without prefetching later mixes', async () => {
    const calls: string[] = []
    const api = {
      async getUserMixes() {
        calls.push('directory')
        return {
          status_code: 0,
          mix_infos: [
            { mix_id: 'mix-1', mix_name: '第一合集' },
            { mix_id: 'mix-2', mix_name: '第二合集' },
          ],
          has_more: 0,
          cursor: 0,
        }
      },
      async getMixAwemes(mixId: string, cursor: number) {
        calls.push(`${mixId}:${cursor}`)
        if (mixId === 'mix-1' && cursor === 0) {
          return { aweme_list: [aweme('1')], has_more: 1, cursor: 2 }
        }
        if (mixId === 'mix-1') return { aweme_list: [aweme('2')], has_more: 0, cursor: 2 }
        return { aweme_list: [aweme('3')], has_more: 0, cursor: 0 }
      },
    } as unknown as DouyinApi
    const plugin = new DouyinMusicSourcePlugin(api)
    const listing = plugin.importFromUrl({
      url: 'https://www.douyin.com/user/public-sec?showSubTab=compilation',
    })
    const iterator = listing.pages()[Symbol.asyncIterator]()

    expect(calls).toEqual([])
    expect((await iterator.next()).value?.items.map((track: Track) => track.id)).toEqual([
      'douyin:video:1',
    ])
    expect(calls).toEqual(['directory', 'mix-1:0'])
    expect((await iterator.next()).value?.items[0]?.sourceTags).toContain('合集：第一合集')
    expect(calls).toEqual(['directory', 'mix-1:0', 'mix-1:2'])
    expect((await iterator.next()).value?.items.map((track: Track) => track.id)).toEqual([
      'douyin:video:3',
    ])
    expect(calls).toEqual(['directory', 'mix-1:0', 'mix-1:2', 'mix-2:0'])
  })
})

describe('Douyin account collection listings', () => {
  it('routes collection videos independently from the liked-aweme endpoint', async () => {
    const calls: string[] = []
    const api = {
      async getCollectedAwemes() {
        calls.push('collection')
        return { aweme_list: [aweme('collected')], has_more: 0, cursor: 0 }
      },
      async getUserFavorites() {
        calls.push('liked')
        return { aweme_list: [], has_more: 0, cursor: 0 }
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).importFromUrl({
      url: 'https://www.douyin.com/user/self?showTab=favorite_collection',
    })

    const page = await listing.pages()[Symbol.asyncIterator]().next()
    expect(page.value?.items[0]?.id).toBe('douyin:video:collected')
    expect(calls).toEqual(['collection'])
  })

  it('flattens collected mixes and collection folders only when consumed', async () => {
    const calls: string[] = []
    const api = {
      async getCollectedMixes() {
        calls.push('collected-mixes')
        return { mix_infos: [{ mix_id: 'saved-mix', mix_name: '收藏合集' }], has_more: 0 }
      },
      async getMixAwemes() {
        calls.push('mix-page')
        return { aweme_list: [aweme('mix-item')], has_more: 0, cursor: 0 }
      },
      async getCollectFolders() {
        calls.push('folders')
        return {
          collects_list: [{ collects_id_str: 'folder-1', collects_name: '学习' }],
          has_more: 0,
        }
      },
      async getCollectFolderAwemes() {
        calls.push('folder-page')
        return { aweme_list: [aweme('folder-item')], has_more: 0, cursor: 0 }
      },
    } as unknown as DouyinApi
    const plugin = new DouyinMusicSourcePlugin(api)
    const mixes = plugin.importFromUrl({
      url: 'https://www.douyin.com/user/self?showSubTab=compilation&showTab=favorite_collection',
    })
    const folders = plugin.importFromUrl({
      url: 'https://www.douyin.com/user/self?showSubTab=favorite_folder&showTab=favorite_collection',
    })

    expect(calls).toEqual([])
    const mixPage = await mixes.pages()[Symbol.asyncIterator]().next()
    expect(mixPage.value?.items[0]?.sourceTags).toContain('合集：收藏合集')
    expect(calls).toEqual(['collected-mixes', 'mix-page'])
    const folderPage = await folders.pages()[Symbol.asyncIterator]().next()
    expect(folderPage.value?.items[0]?.sourceTags).toContain('收藏夹：学习')
    expect(calls).toEqual(['collected-mixes', 'mix-page', 'folders', 'folder-page'])
  })

  it('re-resolves collected music instead of persisting its listing URL', async () => {
    const api = {
      async getCollectedMusic() {
        return {
          mc_list: [
            {
              id_str: 'music-1',
              title: '收藏音乐',
              play_url: { url_list: ['https://media.example/stale.mp3'] },
            },
          ],
          has_more: 0,
          cursor: 0,
        }
      },
      async getMusicDetail() {
        return {
          id_str: 'music-1',
          title: '收藏音乐',
          play_url: { url_list: ['https://media.example/current.mp3'] },
        }
      },
    } as unknown as DouyinApi
    const plugin = new DouyinMusicSourcePlugin(api)
    const listing = plugin.importFromUrl({
      url: 'https://www.douyin.com/user/self?showSubTab=music&showTab=favorite_collection',
    })
    const page = await listing.pages()[Symbol.asyncIterator]().next()
    const track = page.value?.items[0]

    expect(track?.id).toBe('douyin:music:music-1')
    expect(JSON.stringify(track)).not.toContain('stale.mp3')
    await expect(plugin.resolveMedia(track as Track)).resolves.toMatchObject({
      url: 'https://media.example/current.mp3',
    })
  })
})

describe('Douyin work imports', () => {
  it.each(['mix_info', 'mixInfo'] as const)(
    'expands %s lazily, pages the mix and retries detail freshly',
    async (key) => {
      const getAwemeDetail = vi.fn().mockResolvedValue({
        ...aweme('123'),
        [key]: key === 'mix_info' ? { mix_id: '456' } : { mixId: '456' },
      })
      const getMixAwemes = vi.fn().mockImplementation(async (_id, cursor) => ({
        aweme_list: [aweme(cursor === 0 ? 'first' : 'second')],
        cursor: cursor === 0 ? 6 : 12,
        has_more: cursor === 0 ? 1 : 0,
      }))
      const plugin = new DouyinMusicSourcePlugin({
        getAwemeDetail,
        getMixAwemes,
      } as unknown as DouyinApi)
      const listing = plugin.importFromUrl({ url: 'https://www.douyin.com/video/123', pageSize: 6 })
      expect(getAwemeDetail).not.toHaveBeenCalled()
      const pages = listing.pages()[Symbol.asyncIterator]()
      expect((await pages.next()).value).toMatchObject({
        items: [{ id: 'douyin:video:first' }],
        pageSize: 6,
        hasMore: true,
      })
      expect(getMixAwemes).toHaveBeenCalledExactlyOnceWith('456', 0, 6)
      expect((await pages.next()).value).toMatchObject({
        items: [{ id: 'douyin:video:second' }],
        hasMore: false,
      })
      await pages.return?.()
      expect(getAwemeDetail).toHaveBeenCalledExactlyOnceWith('123', 'video')
      expect(getMixAwemes.mock.calls).toEqual([
        ['456', 0, 6],
        ['456', 6, 6],
      ])
      const retry = listing.pages()[Symbol.asyncIterator]()
      await retry.next()
      await retry.return?.()
      expect(getAwemeDetail).toHaveBeenCalledTimes(2)
    },
  )

  it.each([
    undefined,
    {},
    { mix_id: '' },
    { mix_id: '../user/self' },
    { mix_id: 456 },
    { mix_id: '1'.repeat(33) },
  ])('keeps works without a valid mix as single imports: %j', async (mix) => {
    const getAwemeDetail = vi.fn().mockResolvedValue({ ...aweme('123'), mix_info: mix })
    const getMixAwemes = vi.fn()
    const plugin = new DouyinMusicSourcePlugin({
      getAwemeDetail,
      getMixAwemes,
    } as unknown as DouyinApi)
    const listing = plugin.importFromUrl({ url: 'https://www.douyin.com/video/123' })
    const pages = listing.pages()[Symbol.asyncIterator]()
    expect((await pages.next()).value).toMatchObject({
      items: [{ id: 'douyin:video:123' }],
      total: 1,
      hasMore: false,
    })
    expect((await pages.next()).done).toBe(true)
    expect(getMixAwemes).not.toHaveBeenCalled()
  })

  it('resolves only the selected work for playback even when it belongs to a mix', async () => {
    const getAwemeDetail = vi
      .fn()
      .mockResolvedValue({ ...aweme('123'), mix_info: { mix_id: '456' } })
    const getMixAwemes = vi.fn()
    const plugin = new DouyinMusicSourcePlugin({
      getAwemeDetail,
      getMixAwemes,
    } as unknown as DouyinApi)
    await expect(plugin.resolveMedia(createVideoTrack('123'))).resolves.toMatchObject({
      url: 'https://media.example/123',
    })
    expect(getMixAwemes).not.toHaveBeenCalled()
    expect(getAwemeDetail).toHaveBeenCalledExactlyOnceWith('123', 'video')
  })

  it('retains a mix rejection and cancels its reader without silently importing only the video', async () => {
    const error = new AppError('verification-required')
    const close = vi.fn()
    const load = vi.fn().mockRejectedValue(error)
    const plugin = new DouyinMusicSourcePlugin({
      hasBrowserImport: true,
      getAwemeDetail: vi.fn().mockResolvedValue({ ...aweme('123'), mix_info: { mix_id: '456' } }),
      openImport: () => ({ load, close }),
    } as unknown as DouyinApi)
    const listing = plugin.importFromUrl({ url: 'https://www.douyin.com/video/123' })
    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toBe(error)
    expect(close).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledExactlyOnceWith(0)
  })
})

describe('Douyin history imports', () => {
  it('uses only the history endpoint with descending cursors and stops on early return', async () => {
    const getSelfHistory = vi
      .fn()
      .mockResolvedValueOnce({ aweme_list: [aweme('1')], max_cursor: 1723456789123, has_more: 1 })
      .mockResolvedValueOnce({ aweme_list: [aweme('2')], max_cursor: 1723456789000, has_more: 1 })
    const getSelfProfile = vi.fn()
    const getUserPosts = vi.fn()
    const plugin = new DouyinMusicSourcePlugin({
      getSelfHistory,
      getSelfProfile,
      getUserPosts,
    } as unknown as DouyinApi)
    const listing = plugin.importFromUrl({ url: 'https://www.douyin.com/user/self?showTab=record' })
    expect(listing.title).toBe('我的抖音观看历史')
    expect(getSelfHistory).not.toHaveBeenCalled()
    const pages = listing.pages()[Symbol.asyncIterator]()
    await pages.next()
    await pages.next()
    await pages.return?.()
    expect(getSelfHistory.mock.calls).toEqual([
      [0, 18],
      [1723456789123, 18],
    ])
    expect(getSelfProfile).not.toHaveBeenCalled()
    expect(getUserPosts).not.toHaveBeenCalled()
  })
})

describe('Douyin media detail fallback', () => {
  it('resolves a public search result from its page when aweme detail is rejected with HTTP 403', async () => {
    const requests: string[] = []
    const pageAweme = {
      awemeId: 'public-403',
      desc: '公开作品',
      video: {
        duration: 1_000,
        playAddr: { urlList: ['https://media.example/public-403.mp4'] },
      },
    }
    const flightPayload = JSON.stringify([1, `0:${JSON.stringify(pageAweme)}\n`])
    const client: HttpClient = {
      async request(request) {
        requests.push(new URL(request.url).pathname)
        if (request.url.includes('/aweme/v1/web/aweme/detail/')) {
          return {
            status: 403,
            statusText: 'Forbidden',
            headers: 'content-type: text/html',
            body: new TextEncoder().encode('<html>forbidden</html>'),
          }
        }
        return {
          status: 200,
          statusText: 'OK',
          headers: 'content-type: text/html',
          body: `<script>self.__pace_f.push(${flightPayload})</script>`,
        }
      },
    }
    const plugin = new DouyinMusicSourcePlugin(new DouyinApi(client, createRequestState))

    await expect(plugin.resolveMedia(createVideoTrack('public-403'))).resolves.toMatchObject({
      url: 'https://media.example/public-403.mp4',
    })
    expect(requests).toEqual(['/aweme/v1/web/aweme/detail/', '/video/public-403'])
  })

  it.each([
    { statusCode: 2_198, expectedCode: 'access-denied' },
    { statusCode: 2_483, expectedCode: 'verification-required' },
  ])(
    'does not hide business error $statusCode behind the public page fallback',
    async ({ statusCode, expectedCode }) => {
      let requestCount = 0
      const client: HttpClient = {
        async request() {
          requestCount += 1
          return {
            status: 403,
            statusText: 'Forbidden',
            headers: 'content-type: application/json',
            body: new TextEncoder().encode(
              JSON.stringify({ status_code: statusCode, status_msg: 'business rejection' }),
            ),
          }
        },
      }
      const plugin = new DouyinMusicSourcePlugin(new DouyinApi(client, createRequestState))

      await expect(plugin.resolveMedia(createVideoTrack('private'))).rejects.toMatchObject({
        code: expectedCode,
      })
      expect(requestCount).toBe(1)
    },
  )

  it('keeps the original access error when the detail API and public pages are all rejected', async () => {
    let requestCount = 0
    const client: HttpClient = {
      async request() {
        requestCount += 1
        return {
          status: 403,
          statusText: 'Forbidden',
          headers: 'content-type: text/html',
          body: new TextEncoder().encode('<html>forbidden</html>'),
        }
      },
    }
    const plugin = new DouyinMusicSourcePlugin(new DouyinApi(client, createRequestState))

    await expect(plugin.resolveMedia(createVideoTrack('unavailable'))).rejects.toMatchObject({
      code: 'access-denied',
      statusCode: 'AM-2002',
    })
    expect(requestCount).toBe(4)
  })

  it('skips metadata-only React Flight entries and continues to the playable share page', async () => {
    const requests: string[] = []
    const metadataOnly = { awemeId: 'flight-card', desc: '只有卡片元数据' }
    const playableShare = {
      aweme_id: 'flight-card',
      video: { play_addr: { url_list: ['https://media.example/from-share.mp4'] } },
    }
    const flightPayload = JSON.stringify([1, `0:${JSON.stringify(metadataOnly)}\n`])
    const routerPayload = JSON.stringify({ loaderData: { video: playableShare } })
    const client: HttpClient = {
      async request(request) {
        const url = new URL(request.url)
        requests.push(`${url.hostname}${url.pathname}`)
        if (url.pathname.includes('/aweme/detail/')) {
          return {
            status: 403,
            statusText: 'Forbidden',
            headers: 'content-type: text/html',
            body: new TextEncoder().encode('<html>forbidden</html>'),
          }
        }
        if (url.hostname === 'www.iesdouyin.com') {
          return {
            status: 200,
            statusText: 'OK',
            headers: 'content-type: text/html',
            body: `<script>window._ROUTER_DATA = ${routerPayload}</script>`,
          }
        }
        return {
          status: 200,
          statusText: 'OK',
          headers: 'content-type: text/html',
          body: `<script>self.__pace_f.push(${flightPayload})</script>`,
        }
      },
    }
    const plugin = new DouyinMusicSourcePlugin(new DouyinApi(client, createRequestState))

    await expect(plugin.resolveMedia(createVideoTrack('flight-card'))).resolves.toMatchObject({
      url: 'https://media.example/from-share.mp4',
    })
    expect(requests).toEqual([
      'www.douyin.com/aweme/v1/web/aweme/detail/',
      'www.douyin.com/video/flight-card',
      'www.douyin.com/note/flight-card',
      'www.iesdouyin.com/share/video/flight-card/',
    ])
  })
})

describe('Douyin protected self listings', () => {
  it('opens captured liked pages after a failed GM request and retries GM on every cursor', async () => {
    const calls: string[] = []
    const api = {
      async getSelfProfile() {
        calls.push('profile')
        return { user: { sec_uid: 'self-sec-uid' } }
      },
      async getUserFavorites() {
        calls.push('gm-favorite')
        throw new DouyinRiskControlError()
      },
    } as unknown as DouyinApi
    const capturedPages = new Map([
      [0, { aweme_list: [aweme('liked-1')], has_more: 1, max_cursor: 9 }],
      [9, { aweme_list: [aweme('liked-2')], has_more: 0, max_cursor: 9 }],
    ])
    const protectedPageSource = {
      isCurrentPage: () => true,
      async getCapturedAwemePage(kind, cursor) {
        calls.push(`capture:${kind}:${cursor}`)
        return capturedPages.get(cursor)
      },
    } satisfies DouyinProtectedPageSource
    const listing = new DouyinMusicSourcePlugin(api, protectedPageSource).importFromUrl({
      url: 'https://www.douyin.com/user/self?showSubTab=video&showTab=like',
    })
    const iterator = listing.pages()[Symbol.asyncIterator]()

    expect((await iterator.next()).value?.items[0]?.id).toBe('douyin:video:liked-1')
    expect(calls).toEqual(['profile', 'gm-favorite', 'capture:self-favorites:0'])
    expect((await iterator.next()).value?.items[0]?.id).toBe('douyin:video:liked-2')
    expect(calls).toEqual([
      'profile',
      'gm-favorite',
      'capture:self-favorites:0',
      'gm-favorite',
      'capture:self-favorites:9',
    ])
  })

  it('reports a page fallback error when neither request path returns a usable collection', async () => {
    const api = {
      async getCollectedAwemes() {
        throw new DouyinRiskControlError()
      },
    } as unknown as DouyinApi
    const protectedPageSource = {
      isCurrentPage: () => false,
      async getCapturedAwemePage() {
        return undefined
      },
    } satisfies DouyinProtectedPageSource
    const listing = new DouyinMusicSourcePlugin(api, protectedPageSource).importFromUrl({
      url: 'https://www.douyin.com/user/self?showTab=favorite_collection',
    })

    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toThrow(
      '无法从已打开的页面读取“收藏视频”',
    )
  })

  it.each([
    new MusicSourceError('access-denied', 'ordinary 403'),
    new MusicSourceError('rate-limited', 'ordinary 429'),
  ])('opens the page for every failed response, including %s', async (requestError) => {
    let captureCalls = 0
    const api = {
      async getCollectedAwemes() {
        throw requestError
      },
    } as unknown as DouyinApi
    const protectedPageSource = {
      isCurrentPage: () => false,
      async getCapturedAwemePage() {
        captureCalls += 1
        return { aweme_list: [aweme('page-fallback')], has_more: 0, cursor: 0 }
      },
    } satisfies DouyinProtectedPageSource
    const listing = new DouyinMusicSourcePlugin(api, protectedPageSource).importFromUrl({
      url: 'https://www.douyin.com/user/self?showTab=favorite_collection',
    })

    await expect(listing.pages()[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:page-fallback' }] },
    })
    expect(captureCalls).toBe(1)
  })

  it('opens the liked page when self-profile lookup fails before the favorite request', async () => {
    const api = {
      async getSelfProfile() {
        throw new MusicSourceError('access-denied', 'profile rejected')
      },
    } as unknown as DouyinApi
    const protectedPageSource = {
      isCurrentPage: () => false,
      async getCapturedAwemePage(kind, cursor) {
        expect([kind, cursor]).toEqual(['self-favorites', 0])
        return { aweme_list: [aweme('liked-from-page')], has_more: 0, max_cursor: 0 }
      },
    } satisfies DouyinProtectedPageSource
    const listing = new DouyinMusicSourcePlugin(api, protectedPageSource).importFromUrl({
      url: 'https://www.douyin.com/user/self?showTab=like',
    })

    await expect(listing.pages()[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:liked-from-page' }] },
    })
  })

  it('opens the collection page when HTTP succeeds without an aweme list', async () => {
    const api = {
      async getCollectedAwemes() {
        return { status_code: 0 }
      },
    } as unknown as DouyinApi
    let captureCalls = 0
    const protectedPageSource = {
      isCurrentPage: () => false,
      async getCapturedAwemePage() {
        captureCalls += 1
        return { aweme_list: [], has_more: 0, cursor: 0 }
      },
    } satisfies DouyinProtectedPageSource
    const listing = new DouyinMusicSourcePlugin(api, protectedPageSource).importFromUrl({
      url: 'https://www.douyin.com/user/self?showTab=favorite_collection',
    })

    await expect(listing.pages()[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { items: [], hasMore: false },
    })
    expect(captureCalls).toBe(1)
  })
})

describe('Douyin self recommendation listing', () => {
  it('resolves the current account lazily and uses the dedicated recommendation endpoint', async () => {
    const calls: string[] = []
    const api = {
      async getSelfProfile() {
        calls.push('profile')
        return { user: { sec_uid: 'self-sec-uid' } }
      },
      async getSelfRecommendations(secUid: string, cursor: number) {
        calls.push(`recommend:${secUid}:${cursor}`)
        return { aweme_list: [aweme('recommended')], has_more: 0, max_cursor: 18 }
      },
      async getUserPosts() {
        calls.push('posts')
        return { aweme_list: [], has_more: 0, max_cursor: 0 }
      },
    } as unknown as DouyinApi
    const listing = new DouyinMusicSourcePlugin(api).importFromUrl({
      url: 'https://www.douyin.com/user/self?from_tab_name=main&showTab=recommend',
    })

    expect(calls).toEqual([])
    const page = await listing.pages()[Symbol.asyncIterator]().next()
    expect(page.value?.items[0]?.id).toBe('douyin:video:recommended')
    expect(calls).toEqual(['profile', 'recommend:self-sec-uid:0'])
  })

  it('opens the recommendation page after any unusable direct response', async () => {
    const api = {
      async getSelfProfile() {
        return { user: { sec_uid: 'self-sec-uid' } }
      },
      async getSelfRecommendations() {
        throw new MusicSourceError('access-denied', 'recommendation rejected')
      },
    } as unknown as DouyinApi
    const protectedPageSource = {
      isCurrentPage: () => false,
      async getCapturedAwemePage(kind, cursor) {
        expect([kind, cursor]).toEqual(['self-recommendations', 0])
        return { aweme_list: [aweme('recommended-from-page')], has_more: 0, max_cursor: 0 }
      },
    } satisfies DouyinProtectedPageSource
    const listing = new DouyinMusicSourcePlugin(api, protectedPageSource).importFromUrl({
      url: 'https://www.douyin.com/user/self?from_tab_name=main&showTab=recommend',
    })

    await expect(listing.pages()[Symbol.asyncIterator]().next()).resolves.toMatchObject({
      value: { items: [{ id: 'douyin:video:recommended-from-page' }] },
    })
  })
})

function aweme(id: string) {
  return {
    aweme_id: id,
    desc: `作品 ${id}`,
    video: { duration: 1_000, play_addr: { url_list: [`https://media.example/${id}`] } },
  }
}

function createVideoTrack(resourceId: string): Track {
  return {
    id: `douyin:video:${resourceId}`,
    title: `作品 ${resourceId}`,
    artists: [{ name: '测试作者' }],
    source: {
      pluginId: 'douyin',
      mediaKind: 'video',
      resourceId,
      partId: 'video',
      pageUrl: `https://www.douyin.com/video/${resourceId}`,
    },
  }
}

function createRequestState() {
  return {
    userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
    browserFingerprint: 'test-fingerprint',
    browserLanguage: 'zh-CN',
    browserPlatform: 'Win32',
    browserName: 'Chrome',
    browserVersion: '140.0.0.0',
    browserOnline: 'true',
    cookieEnabled: 'true',
    engineName: 'Blink',
    engineVersion: '140.0.0.0',
    osName: 'Windows',
    osVersion: '10',
    cpuCoreCount: '8',
    deviceMemory: '8',
    screenWidth: '1920',
    screenHeight: '1080',
    downlink: '10',
    effectiveType: '4g',
    roundTripTime: '0',
    supportDash: '1',
    supportH265: '0',
    pcLibraDivert: 'Windows',
    webId: '7123456789012345678',
    uifid: '',
    verifyFp: 'verify_test',
    msToken: '',
  }
}
