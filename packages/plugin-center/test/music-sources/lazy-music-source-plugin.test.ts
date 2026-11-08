import { MusicSourceError } from '@any-music/core'
import type { MusicSourcePlugin, TrackPage } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { LazyMusicSourcePlugin } from '../../src/music-sources/lazy-music-source-plugin'

const descriptor = {
  id: 'lazy-test',
  name: '惰性测试源',
  provenance: 'built-in',
  capabilities: { search: true, importUrl: true, session: true },
  importUrlScopes: [{ origin: 'https://music.example.com', pathnamePrefix: '/' }],
} as const

describe('LazyMusicSourcePlugin', () => {
  it('retries a rejected import and shares a pending load across concurrent consumers', async () => {
    const loadPlugin = vi
      .fn<() => Promise<MusicSourcePlugin>>()
      .mockRejectedValueOnce(new Error('module unavailable'))
      .mockResolvedValueOnce(createLoadedPlugin())
    const plugin = new LazyMusicSourcePlugin({ descriptor, validateImportUrl: vi.fn(), loadPlugin })
    await expect(plugin.getSession()).rejects.toThrow()
    const sessions = await Promise.all([plugin.getSession(), plugin.getSession()])
    expect(sessions).toEqual([{ status: 'signed-out' }, { status: 'signed-out' }])
    expect(loadPlugin).toHaveBeenCalledTimes(2)
  })

  it('keeps metadata and local URL validation available without loading platform code', async () => {
    const validateImportUrl = vi.fn()
    const loadPlugin = vi.fn(async () => createLoadedPlugin())
    const plugin = new LazyMusicSourcePlugin({
      descriptor,
      loginUrl: 'https://music.example.com/login',
      validateImportUrl,
      loadPlugin,
    })

    plugin.validateImportUrl('https://music.example.com/album/1')
    const availability = await plugin.checkAvailability()

    expect(plugin.descriptor).toBe(descriptor)
    expect(plugin.getLoginUrl()).toBe('https://music.example.com/login')
    expect(validateImportUrl).toHaveBeenCalledOnce()
    expect(availability.status).toBe('available')
    expect(loadPlugin).not.toHaveBeenCalled()
  })

  it('loads a platform module only when the first listing page is consumed', async () => {
    const loadedPlugin = createLoadedPlugin()
    const loadPlugin = vi.fn(async () => loadedPlugin)
    const plugin = new LazyMusicSourcePlugin({
      descriptor,
      validateImportUrl: vi.fn(),
      loadPlugin,
    })

    const listing = plugin.search({ query: '  hello  ' })
    expect(loadPlugin).not.toHaveBeenCalled()

    const firstPage = await listing.pages()[Symbol.asyncIterator]().next()

    expect(loadPlugin).toHaveBeenCalledOnce()
    expect(firstPage.value).toMatchObject({ pageNumber: 1, hasMore: false })
  })

  it('reuses a successful dynamic import across session and media actions', async () => {
    const loadedPlugin = createLoadedPlugin()
    const loadPlugin = vi.fn(async () => loadedPlugin)
    const plugin = new LazyMusicSourcePlugin({
      descriptor,
      validateImportUrl: vi.fn(),
      loadPlugin,
    })

    await plugin.getSession()
    await expect(
      plugin.resolveMedia({
        id: 'lazy-test:track:1',
        title: 'Track',
        artists: [],
        source: { pluginId: descriptor.id, mediaKind: 'audio', resourceId: '1' },
      }),
    ).resolves.toMatchObject({ type: 'remote-url' })

    expect(loadPlugin).toHaveBeenCalledOnce()
  })

  it('keeps a platform supplied search page URL even when the first page requires verification', async () => {
    const loadedPlugin: MusicSourcePlugin = {
      ...createLoadedPlugin(),
      search: () => ({
        id: 'search:verify',
        title: '搜索页',
        sourceUrl: 'https://music.example.com/search/verify',
        pages: () => ({
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              throw new MusicSourceError('verification-required', '请在来源页面验证。')
            },
          }),
        }),
      }),
    }
    const loadPlugin = vi.fn(async () => loadedPlugin)
    const lazyPlugin = new LazyMusicSourcePlugin({
      descriptor,
      validateImportUrl: vi.fn(),
      loadPlugin,
    })
    const listing = lazyPlugin.search({ query: 'verify' })

    expect(loadPlugin).not.toHaveBeenCalled()
    await expect(listing.pages()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'verification-required',
    })

    expect(loadPlugin).toHaveBeenCalledOnce()
    expect(listing.sourceUrl).toBe('https://music.example.com/search/verify')
  })
})

function createLoadedPlugin(): MusicSourcePlugin {
  const page: TrackPage = {
    items: [],
    pageNumber: 1,
    pageSize: 20,
    hasMore: false,
  }
  return {
    descriptor,
    checkAvailability: () => Promise.resolve({ status: 'available', checkedAtMs: Date.now() }),
    validateImportUrl: () => undefined,
    getSession: () => Promise.resolve({ status: 'signed-out' }),
    getLoginUrl: () => 'https://music.example.com/login',
    search: () => createListing(page),
    importFromUrl: () => createListing(page),
    resolveMedia: () =>
      Promise.resolve({
        type: 'remote-url',
        url: 'https://cdn.example.com/track.mp3',
        backupUrls: [],
        quality: { id: 'default', label: 'MP3', rank: 1 },
        availableQualities: [{ id: 'default', label: 'MP3', rank: 1 }],
        loadingStrategy: 'eager',
      }),
  }
}

function createListing(page: TrackPage) {
  return {
    id: 'listing:1',
    title: 'Listing',
    pages: async function* () {
      yield page
    },
  }
}
