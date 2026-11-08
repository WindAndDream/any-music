import { AppError } from '@any-music/core'
import type {
  CancellationSignal,
  MediaResolveOptions,
  MusicSourcePlugin,
  ResolvedMediaSource,
  Track,
  TrackPage,
} from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { createMusicSourceRegistry } from '../../src/music-sources/index'

const track: Track = {
  id: 'bilibili:video:1',
  title: '保留',
  artists: [],
  source: { pluginId: 'bilibili', resourceId: '1', mediaKind: 'video' },
}
const page: TrackPage = { items: [track], pageNumber: 1, pageSize: 1, hasMore: true }
function media(release = vi.fn()): ResolvedMediaSource {
  return {
    type: 'remote-url',
    url: 'https://example.com/audio',
    backupUrls: [],
    quality: { id: 'highest', label: '最高', rank: 2 },
    availableQualities: [{ id: 'highest', label: '最高', rank: 2 }],
    loadingStrategy: 'range',
    release,
  }
}
function setup(
  overrides: Partial<MusicSourcePlugin> = {},
  prepareMedia?: (track: Track, source: ResolvedMediaSource) => Promise<ResolvedMediaSource>,
) {
  const raw: MusicSourcePlugin = {
    descriptor: {
      id: 'bilibili',
      name: 'Bilibili',
      provenance: 'built-in',
      capabilities: { search: true, importUrl: true, session: true },
      importUrlScopes: [],
    },
    checkAvailability: async () => ({ status: 'available', checkedAtMs: 1 }),
    validateImportUrl() {},
    getLoginUrl: () => undefined,
    getSession: async () => ({ status: 'not-required' }),
    search: () => ({
      id: 'listing',
      title: '列表',
      async *pages() {
        yield page
      },
    }),
    importFromUrl: () => ({
      id: 'import',
      title: '导入',
      async *pages() {
        yield page
      },
    }),
    resolveMedia: vi.fn(async () => media()),
    ...overrides,
  }
  const registry = createMusicSourceRegistry({
    externalPlugins: 'declarative',
    builtInPlugins: [raw],
    prepareMedia,
  })
  return { raw, registry, plugin: registry.getPlugin('bilibili')! }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}

describe('host source lifetime', () => {
  it('releases the reader on its final page even when the UI never calls next or return again', async () => {
    const close = vi.fn()
    const { plugin, registry } = setup({
      search: () => ({
        id: 'last',
        title: '最后一页',
        async *pages() {
          try {
            yield { ...page, hasMore: false }
          } finally {
            close()
          }
        },
      }),
    })
    const pages = plugin.search({ query: '音乐' }).pages()[Symbol.asyncIterator]()
    await expect(pages.next()).resolves.toMatchObject({ value: { hasMore: false } })
    expect(close).toHaveBeenCalledTimes(1)
    registry.dispose()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('consumes one page per next, closes early once and never fetches the next page', async () => {
    const requests: number[] = [],
      closed = vi.fn()
    const { plugin } = setup({
      search: () => ({
        id: 'list',
        title: '列表',
        async *pages() {
          try {
            requests.push(1)
            yield page
            requests.push(2)
            yield { ...page, pageNumber: 2 }
          } finally {
            closed()
          }
        },
      }),
    })
    const pages = plugin.search({ query: '音乐' }).pages()[Symbol.asyncIterator]()
    expect(requests).toEqual([])
    await pages.next()
    expect(requests).toEqual([1])
    await pages.return?.()
    await pages.return?.()
    expect(requests).toEqual([1])
    expect(closed).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending page at the transport, closes once and rejects late results after re-enabling', async () => {
    const pending = deferred<IteratorResult<TrackPage>>()
    let signal!: CancellationSignal
    const close = vi.fn(async () => ({ done: true as const, value: undefined }))
    const next = vi.fn(() => pending.promise)
    const { plugin, registry } = setup({
      search: () => ({
        id: 'list',
        title: '列表',
        pages(options) {
          signal = options!.cancellation!
          return { [Symbol.asyncIterator]: () => ({ next, return: close }) }
        },
      }),
    })
    const listing = plugin.search({ query: '音乐' })
    const pages = listing.pages()[Symbol.asyncIterator]()
    const result = pages.next()
    registry.setEnabled('bilibili', false)
    expect(signal.isCancelled()).toBe(true)
    registry.setEnabled('bilibili', true)
    pending.resolve({ done: false, value: page })
    await expect(result).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(close).toHaveBeenCalledTimes(1)
    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('blocks new media and prefetch while disabled and releases a late resolver exactly once', async () => {
    const pending = deferred<ResolvedMediaSource>(),
      release = vi.fn()
    let signal!: CancellationSignal
    const resolver = vi.fn((_track: Track, options?: MediaResolveOptions) => {
      signal = options!.cancellation!
      return pending.promise
    })
    const { registry } = setup({ resolveMedia: resolver })
    const result = registry.resolveMedia(track)
    registry.setEnabled('bilibili', false)
    expect(signal.isCancelled()).toBe(true)
    expect(registry.canPrefetchMedia(track)).toBe(false)
    await expect(registry.resolveMedia(track)).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    registry.setEnabled('bilibili', true)
    pending.resolve(media(release))
    await expect(result).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(release).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('preserves omitted/default and explicit quality and releases active leases on failure/disposal', async () => {
    const release = vi.fn()
    const { registry, raw } = setup({ resolveMedia: vi.fn(async () => media(release)) })
    const first = await registry.resolveMedia(track)
    expect(first.quality.id).toBe('highest')
    expect(vi.mocked(raw.resolveMedia).mock.lastCall?.[1]?.qualityId).toBeUndefined()
    first.release?.()
    first.release?.()
    expect(release).toHaveBeenCalledTimes(1)
    await registry.resolveMedia(track, { qualityId: 'highest' })
    expect(raw.resolveMedia).toHaveBeenLastCalledWith(
      track,
      expect.objectContaining({ qualityId: 'highest' }),
    )
    registry.dispose()
    registry.dispose()
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('revokes active media on availability failure and does not retry until explicit action', async () => {
    const release = vi.fn(),
      resolveMedia = vi.fn(async () => media(release))
    const { registry, raw } = setup({
      resolveMedia,
      checkAvailability: async () => {
        throw new AppError('network-error')
      },
    })
    await registry.resolveMedia(track)
    await registry.checkAvailability('bilibili')
    expect(release).toHaveBeenCalledTimes(1)
    await expect(registry.resolveMedia(track)).rejects.toMatchObject({
      code: 'operation-cancelled',
    })
    raw.checkAvailability = async () => ({ status: 'available', checkedAtMs: 2 })
    await registry.checkAvailability('bilibili')
    expect(resolveMedia).toHaveBeenCalledTimes(1)
    await registry.resolveMedia(track)
    expect(resolveMedia).toHaveBeenCalledTimes(2)
    registry.dispose()
  })

  it('releases native resources returned after cancellation during media preparation', async () => {
    const pending = deferred<ResolvedMediaSource>(),
      originalRelease = vi.fn(),
      grantRelease = vi.fn()
    const prepare = vi.fn(() => pending.promise)
    const { registry } = setup({ resolveMedia: async () => media(originalRelease) }, prepare)
    const result = registry.resolveMedia(track)
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
    registry.setEnabled('bilibili', false)
    expect(originalRelease).toHaveBeenCalledTimes(1)
    pending.resolve(media(grantRelease))
    await expect(result).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(grantRelease).toHaveBeenCalledTimes(1)
  })
})
