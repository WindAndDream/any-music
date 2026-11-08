import { AppError, MusicSourceError, createAppErrorState } from '@any-music/core'
import type { MusicSourcePlugin, Track, TrackListing, TrackPage } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { useTrackCatalog } from '#workbench/features/music-sources/use-track-catalog'

describe('useTrackCatalog', () => {
  it('retains the first account across continuation and replaces it on refresh', async () => {
    let selected = 'first'
    const createListing = () => {
      const listing: TrackListing = {
        id: 'list',
        title: 'List',
        async *pages(options) {
          listing.account = {
            id: selected,
            name: selected,
            state: { login: 'signed-in', verification: 'not-required', connection: 'available' },
          }
          yield {
            items: [createTrack(options?.continuation?.nextPage ?? 1)],
            pageNumber: options?.continuation?.nextPage ?? 1,
            pageSize: 1,
            hasMore: true,
            continuation: { kind: 'page', nextPage: (options?.continuation?.nextPage ?? 1) + 1 },
          }
        },
      }
      return listing
    }
    const catalog = useTrackCatalog(createPlugin(createListing))
    await catalog.search('test')
    expect(catalog.originAccount.value).toEqual({
      id: 'first',
      name: 'first',
      customName: undefined,
    })
    catalog.restore(
      {
        tracks: catalog.tracks.value,
        loadedPageCount: 1,
        hasMore: true,
        continuation: { kind: 'page', nextPage: 2 },
        account: catalog.originAccount.value,
      },
      createListing,
    )
    selected = 'second'
    await catalog.loadNext()
    expect(catalog.account.value?.id).toBe('second')
    expect(catalog.originAccount.value?.id).toBe('first')
    await catalog.search('test')
    expect(catalog.originAccount.value?.id).toBe('second')
  })
  it('offers verification immediately for a restored challenge without consuming a page first', async () => {
    const verify = vi.fn().mockResolvedValue(undefined)
    const pages = vi.fn(async function* () {
      yield { items: [createTrack(2)], pageNumber: 1, pageSize: 10, hasMore: false }
    })
    const createListing = vi.fn(() => ({ id: 'restored', title: 'Restored', pages, verify }))
    const catalog = useTrackCatalog(createPlugin(createListing))
    catalog.restore(
      {
        tracks: [createTrack(1)],
        loadedPageCount: 7,
        hasMore: false,
        error: createAppErrorState('verification-required'),
      },
      createListing,
    )
    expect(createListing).not.toHaveBeenCalled()
    catalog.prepareVerification()
    expect(catalog.canVerify.value).toBe(true)
    expect(catalog.tracks.value).toEqual([createTrack(1)])
    expect(pages).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    await catalog.verify()
    expect(verify).toHaveBeenCalledOnce()
    expect(pages).toHaveBeenCalledOnce()
    expect(createListing).toHaveBeenCalledOnce()
    expect(catalog.tracks.value).toEqual([createTrack(2)])
    expect(catalog.error.value).toBeUndefined()
  })
  it('deduplicates a resumed page and aborts an in-flight continuation when the catalog is reset', async () => {
    let finish!: (value: IteratorResult<TrackPage>) => void
    let cancellation: Parameters<TrackListing['pages']>[0]
    const pages = vi.fn((options: Parameters<TrackListing['pages']>[0]) => {
      cancellation = options
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            new Promise<IteratorResult<TrackPage>>((resolve) => {
              finish = resolve
            }),
        }),
      }
    })
    const catalog = useTrackCatalog(createPlugin(() => ({ id: 'list', title: 'List', pages })))
    const createListing = vi.fn(() => ({ id: 'list', title: 'List', pages }))
    catalog.restore(
      {
        tracks: [createTrack(1)],
        loadedPageCount: 1,
        hasMore: true,
        continuation: { kind: 'page', nextPage: 2 },
      },
      createListing,
    )
    expect(createListing).not.toHaveBeenCalled()
    const pending = catalog.loadNext()
    expect(pages).toHaveBeenCalledWith(
      expect.objectContaining({ continuation: { kind: 'page', nextPage: 2 } }),
    )
    finish({
      done: false,
      value: {
        items: [createTrack(1), createTrack(2)],
        pageNumber: 2,
        pageSize: 2,
        hasMore: true,
        continuation: { kind: 'page', nextPage: 3 },
      },
    })
    await pending
    expect(catalog.tracks.value).toEqual([createTrack(1), createTrack(2)])
    const next = catalog.loadNext()
    catalog.reset()
    expect(cancellation?.cancellation?.isCancelled()).toBe(true)
    finish({
      done: false,
      value: { items: [createTrack(3)], pageNumber: 3, pageSize: 1, hasMore: false },
    })
    await next
    expect(catalog.tracks.value).toEqual([])
    expect(catalog.isLoading.value).toBe(false)
  })
  it('attributes a replacement search failure to the new request and ignores the old completed verification', async () => {
    let finish!: () => void
    let requestCount = 0
    const verify = vi.fn(async (options: Parameters<NonNullable<TrackListing['verify']>>[0]) => {
      options?.onProgress?.('restoring')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const catalog = useTrackCatalog(
      createPlugin(() => ({
        id: String(++requestCount),
        title: '列表',
        verify,
        pages: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw new AppError(requestCount === 1 ? 'verification-required' : 'upstream-error')
            },
          }),
        }),
      })),
    )
    await catalog.search('旧词')
    const pending = catalog.verify()
    await catalog.search('新词')
    finish()
    await pending
    expect(catalog.errorCode.value).toBe('upstream-error')
    expect(catalog.failureOperation.value).toBe('search')
    expect(catalog.isVerifying.value).toBe(false)
    expect(catalog.canVerify.value).toBe(false)
  })
  it('cancels only restoration after confirmed verification and reloads without requiring another verification', async () => {
    let finish!: () => void
    let verified = false
    const verify = vi.fn(async (options: Parameters<NonNullable<TrackListing['verify']>>[0]) => {
      verified = true
      options?.onProgress?.('restoring')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    const catalog = useTrackCatalog(
      createPlugin(() => ({
        id: 'confirmed',
        title: '列表',
        verify,
        async *pages() {
          if (!verified) throw new AppError('verification-required')
          yield { items: [], pageNumber: 1, pageSize: 1, hasMore: false }
        },
      })),
    )
    await catalog.search('音乐')
    const pending = catalog.verify()
    expect(catalog.verificationPhase.value).toBe('restoring')
    catalog.cancelVerification()
    finish()
    await pending
    expect(catalog.errorCode.value).toBe('operation-cancelled')
    expect(catalog.failureOperation.value).toBe('restore')
    expect(catalog.canVerify.value).toBe(false)
    await catalog.reload()
    expect(catalog.error.value).toBeUndefined()
    expect(catalog.loadedPageCount.value).toBe(1)
    expect(verify).toHaveBeenCalledOnce()
  })
  it('restarts an invalidated idle listing from page one without mixing old pages', async () => {
    let identity = 'a'
    const listing: TrackListing = {
      id: 'accounts',
      title: '账号列表',
      get account() {
        return { id: identity }
      },
      async *pages() {
        const current = identity
        yield {
          items: [{ ...createTrack(1), id: `${current}:1` }],
          pageNumber: 1,
          pageSize: 1,
          hasMore: true,
        }
        yield {
          items: [{ ...createTrack(2), id: `${current}:2` }],
          pageNumber: 2,
          pageSize: 1,
          hasMore: false,
        }
      },
    }
    const search = vi.fn(() => listing)
    const catalog = useTrackCatalog(createPlugin(search))
    await catalog.search('音乐')
    identity = 'b'
    catalog.invalidate(createAppErrorState('operation-cancelled'), true)
    await catalog.loadNext()
    expect(catalog.tracks.value.map((track) => track.id)).toEqual(['b:1'])
    expect(catalog.loadedPageCount.value).toBe(1)
    await catalog.loadNext()
    expect(catalog.tracks.value.map((track) => track.id)).toEqual(['b:1', 'b:2'])
    expect(search).toHaveBeenCalledOnce()
  })
  it('cancels pending pages on invalidation, retains loaded tracks and rejects late results', async () => {
    let finish!: () => void
    let signal: Parameters<TrackListing['pages']>[0]
    const catalog = useTrackCatalog(
      createPlugin(() => ({
        id: 'pending',
        title: '歌曲',
        async *pages(options) {
          signal = options
          yield { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: true }
          await new Promise<void>((resolve) => {
            finish = resolve
          })
          yield { items: [createTrack(2)], pageNumber: 2, pageSize: 1, hasMore: false }
        },
      })),
    )
    await catalog.search('音乐')
    const pending = catalog.loadNext()
    catalog.invalidate(createAppErrorState('operation-cancelled', '账号已删除'))
    expect(signal?.cancellation?.isCancelled()).toBe(true)
    finish()
    await pending
    expect(catalog.tracks.value.map((track) => track.id)).toEqual(['test:1'])
    expect(catalog.errorMessage.value).toContain('账号已删除')
    expect(catalog.isLoading.value).toBe(false)
    expect(catalog.hasMore.value).toBe(false)
  })
  it('keeps verification available after a launch failure and displays the actual cause before retrying', async () => {
    let verified = false
    const verify = vi
      .fn()
      .mockRejectedValueOnce(
        new AppError('network-error', '无法启动账号浏览器（Windows 错误码 5）。'),
      )
      .mockImplementationOnce(async () => {
        verified = true
      })
    const catalog = useTrackCatalog(
      createPlugin(() => ({
        id: 'verify',
        title: '验证列表',
        verify,
        async *pages() {
          if (!verified) throw new AppError('verification-required')
          yield { items: [], pageNumber: 1, pageSize: 10, hasMore: false }
        },
      })),
    )
    await catalog.search('音乐')
    await catalog.verify()
    expect(catalog.errorCode.value).toBe('verification-required')
    expect(catalog.verificationError.value?.code).toBe('network-error')
    expect(catalog.verificationErrorMessage.value).toContain('Windows 错误码 5')
    expect(catalog.verificationPhase.value).toBe('failed')
    expect(catalog.canVerify.value).toBe(true)
    expect(catalog.isVerifying.value).toBe(false)
    await catalog.verify()
    expect(verify).toHaveBeenCalledTimes(2)
    expect(catalog.error.value).toBeUndefined()
    expect(catalog.canVerify.value).toBe(false)
  })
  it('verifies only on demand, rejects duplicate actions and restores the same listing once', async () => {
    let finish!: () => void
    let verified = false
    const verify = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            verified = true
            resolve()
          }
        }),
    )
    const createListing = vi.fn(() => ({
      id: 'verify',
      title: '验证列表',
      verify,
      async *pages() {
        if (!verified) throw new AppError('verification-required')
        yield { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: true }
      },
    }))
    const catalog = useTrackCatalog(createPlugin(createListing))
    await catalog.search('音乐')
    expect(catalog.canVerify.value).toBe(true)
    expect(verify).not.toHaveBeenCalled()
    const pending = catalog.verify()
    await catalog.verify()
    expect(verify).toHaveBeenCalledOnce()
    expect(catalog.isVerifying.value).toBe(true)
    finish()
    await pending
    expect(createListing).toHaveBeenCalledOnce()
    expect(catalog.error.value).toBeUndefined()
    expect(catalog.tracks.value).toEqual([createTrack(1)])
    expect(catalog.isVerifying.value).toBe(false)
  })

  it('aborts verification on reset and ignores its late success', async () => {
    let finish!: () => void
    let signal: Parameters<NonNullable<TrackListing['verify']>>[0]
    const pages = vi.fn(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new AppError('verification-required')),
      }),
    }))
    const catalog = useTrackCatalog(
      createPlugin(() => ({
        id: 'verify',
        title: '验证列表',
        pages,
        verify: (options) => {
          signal = options
          return new Promise<void>((resolve) => {
            finish = resolve
          })
        },
      })),
    )
    await catalog.search('音乐')
    const pending = catalog.verify()
    catalog.reset()
    expect(signal?.cancellation?.isCancelled()).toBe(true)
    finish()
    await pending
    expect(pages).toHaveBeenCalledOnce()
    expect(catalog.error.value).toBeUndefined()
    expect(catalog.tracks.value).toEqual([])
  })
  it('resumes an in-flight page exactly once without requesting the iterator again', async () => {
    let finish!: (page: IteratorResult<TrackPage>) => void
    const response = new Promise<IteratorResult<TrackPage>>((resolve) => {
      finish = resolve
    })
    const next = vi.fn(() => response)
    const catalog = useTrackCatalog(
      createPlugin(() => ({
        id: 'pending',
        title: '音乐',
        pages: () => ({ [Symbol.asyncIterator]: () => ({ next }) }),
      })),
    )
    const search = catalog.search('音乐')
    catalog.pause()
    expect(catalog.isLoading.value).toBe(false)
    await catalog.loadNext()
    expect(next).toHaveBeenCalledTimes(1)
    const resumed = catalog.resume()
    expect(catalog.isLoading.value).toBe(true)
    await catalog.loadNext()
    finish({
      done: false,
      value: { items: [createTrack(1)], pageNumber: 1, pageSize: 1, hasMore: false },
    })
    await Promise.all([search, resumed])
    expect(next).toHaveBeenCalledTimes(1)
    expect(catalog.tracks.value).toEqual([createTrack(1)])
    expect(catalog.isLoading.value).toBe(false)
  })

  it('discards a paused request when reset and ignores its later failure', async () => {
    let fail!: (error: Error) => void
    const response = new Promise<IteratorResult<TrackPage>>((_resolve, reject) => {
      fail = reject
    })
    const close = vi.fn(() => Promise.resolve({ done: true as const, value: undefined }))
    const catalog = useTrackCatalog(
      createPlugin(() => ({
        id: 'pending',
        title: '音乐',
        pages: () => ({ [Symbol.asyncIterator]: () => ({ next: () => response, return: close }) }),
      })),
    )
    const search = catalog.search('音乐')
    catalog.pause()
    catalog.reset()
    fail(new AppError('network-error', '旧请求错误'))
    await search
    await catalog.resume()
    expect(close).toHaveBeenCalledTimes(1)
    expect(catalog.tracks.value).toEqual([])
    expect(catalog.error.value).toBeUndefined()
    expect(catalog.isLoading.value).toBe(false)
    expect(catalog.hasMore.value).toBe(false)
  })

  it('loads exactly one lazy page per request and reports the restored page number', async () => {
    const requestedPages: number[] = []
    const plugin = createPlugin(() => ({
      id: 'search:test',
      title: '测试搜索',
      pages: () => createPages(requestedPages),
    }))
    const catalog = useTrackCatalog(plugin)

    await catalog.search('test')
    expect(requestedPages).toEqual([1])
    expect(catalog.loadedPageCount.value).toBe(1)
    expect(catalog.tracks.value.map((track) => track.id)).toEqual(['test:1'])

    await catalog.loadNext()
    expect(requestedPages).toEqual([1, 2])
    expect(catalog.loadedPageCount.value).toBe(2)
    expect(catalog.tracks.value.map((track) => track.id)).toEqual(['test:1', 'test:2'])
    expect(catalog.hasMore.value).toBe(false)
  })

  it('maps terminal source failures without retaining stale tracks', async () => {
    const plugin = createPlugin(() => ({
      id: 'search:missing',
      title: '失效搜索',
      pages: () => failingPages(),
    }))
    const catalog = useTrackCatalog(plugin)

    await catalog.search('missing')

    expect(catalog.tracks.value).toEqual([])
    expect(catalog.errorCode.value).toBe('not-found')
    expect(catalog.error.value).toMatchObject({
      code: 'not-found',
      statusCode: 'AM-1004',
      message: '内容已失效。',
    })
    expect(catalog.errorMessage.value).toBe('内容已失效。（错误码：AM-1004）')
    expect(catalog.hasMore.value).toBe(false)
  })

  it('removes loaded tracks and keeps later pages from reintroducing the same ids', async () => {
    const plugin = createPlugin(() => ({
      id: 'search:remove',
      title: '删除测试',
      pages: () => repeatedPages(),
    }))
    const catalog = useTrackCatalog(plugin)
    await catalog.search('remove')

    catalog.removeTracks(['test:1'])
    await catalog.loadNext()

    expect(catalog.tracks.value.map((track) => track.id)).toEqual(['test:2'])
  })

  it('preserves loaded tracks and the recovery URL when a later page becomes unavailable', async () => {
    const plugin = createPlugin(() => ({
      id: 'search:partial',
      title: '部分搜索结果',
      sourceUrl: 'https://example.com/search/partial',
      pages: () => partiallyFailingPages(),
    }))
    const catalog = useTrackCatalog(plugin)

    await catalog.search('partial')
    await catalog.loadNext()

    expect(catalog.tracks.value.map((track) => track.id)).toEqual(['test:1'])
    expect(catalog.sourceUrl.value).toBe('https://example.com/search/partial')
    expect(catalog.error.value).toMatchObject({
      code: 'pagination-unavailable',
      statusCode: 'AM-3006',
    })
    expect(catalog.hasMore.value).toBe(false)
  })
})

function createPlugin(createListing: () => TrackListing): MusicSourcePlugin {
  return {
    descriptor: {
      id: 'test',
      name: '测试源',
      provenance: 'built-in',
      capabilities: { search: true, importUrl: true, session: false },
      importUrlScopes: [{ origin: 'https://example.com', pathnamePrefix: '/' }],
    },
    checkAvailability: () => Promise.resolve({ status: 'available', checkedAtMs: 1 }),
    validateImportUrl: () => undefined,
    getSession: () => Promise.resolve({ status: 'not-required' }),
    getLoginUrl: () => undefined,
    search: createListing,
    importFromUrl: createListing,
    resolveMedia: () => Promise.reject(new Error('not used')),
  }
}

async function* createPages(requestedPages: number[]): AsyncIterable<TrackPage> {
  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    requestedPages.push(pageNumber)
    yield {
      items: [createTrack(pageNumber)],
      pageNumber,
      pageSize: 1,
      total: 2,
      hasMore: pageNumber < 2,
    }
  }
}

async function* repeatedPages(): AsyncIterable<TrackPage> {
  yield {
    items: [createTrack(1)],
    pageNumber: 1,
    pageSize: 1,
    total: 3,
    hasMore: true,
  }
  yield {
    items: [createTrack(1), createTrack(2)],
    pageNumber: 2,
    pageSize: 2,
    total: 3,
    hasMore: false,
  }
}

async function* partiallyFailingPages(): AsyncIterable<TrackPage> {
  yield {
    items: [createTrack(1)],
    pageNumber: 1,
    pageSize: 1,
    hasMore: true,
  }
  throw new MusicSourceError('pagination-unavailable', '搜索暂时无法继续加载；已保留当前结果。')
}

function failingPages(): AsyncIterable<TrackPage> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => Promise.reject(new MusicSourceError('not-found', '内容已失效。')),
      }
    },
  }
}

function createTrack(index: number): Track {
  return {
    id: `test:${index}`,
    title: `Track ${index}`,
    artists: [{ name: 'Tester' }],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: String(index) },
  }
}
