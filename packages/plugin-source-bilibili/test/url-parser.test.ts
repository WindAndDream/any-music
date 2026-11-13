import type { HttpClient } from '@any-music/core'
import { LazyMusicSourcePlugin } from '@any-music/plugin-center/music-sources'
import { describe, expect, it, vi } from 'vitest'

import { BILIBILI_MUSIC_SOURCE_DESCRIPTOR, parseBilibiliImportUrl } from '../src/index'
import { BilibiliApi, BilibiliMusicSourcePlugin } from '../src/runtime'

const VIDEO_URL = 'https://www.bilibili.com/video/BV1xx411c7mD/'
const SUPPORTED_TARGETS = [
  { url: VIDEO_URL, target: { kind: 'video', bvid: 'BV1xx411c7mD' } },
  {
    url: 'https://www.bilibili.com/video/BV16a4y157MW/?spm_id_from=333.788.videopod.episodes&vd_source=477fe4e09f719cc0425726478862f34e&p=2',
    target: { kind: 'video', bvid: 'BV16a4y157MW', page: 2 },
  },
  {
    url: 'https://space.bilibili.com/123/lists/456',
    target: { kind: 'season', mid: '123', seasonId: '456' },
  },
  {
    url: 'https://space.bilibili.com/123/upload/video',
    target: { kind: 'upper-video', mid: '123' },
  },
  {
    url: 'https://space.bilibili.com/123/upload/audio',
    target: { kind: 'upper-audio', mid: '123' },
  },
  {
    url: 'https://space.bilibili.com/123/search?keyword=%20music%20',
    target: { kind: 'upper-video', mid: '123', keyword: 'music' },
  },
  {
    url: 'https://space.bilibili.com/123/favlist?fid=456',
    target: { kind: 'favorite', mid: '123', mediaId: '456' },
  },
] as const

const UNDECLARED_URLS = [
  'http://www.bilibili.com/video/BV1xx411c7mD/',
  'ftp://www.bilibili.com/video/BV1xx411c7mD/',
  'https://www.bilibili.com:444/video/BV1xx411c7mD/',
  'http://space.bilibili.com/123/upload/video',
  'ftp://space.bilibili.com/123/upload/video',
  'https://space.bilibili.com:444/123/upload/video',
  'https://www.bilibili.com.example.com/video/BV1xx411c7mD/',
  'https://www.bilibili.com@evil.example/video/BV1xx411c7mD/',
  'https://www.bilibili.com/video-other/BV1xx411c7mD/',
  'https://space.bilibili.com.example.com/123/upload/video',
] as const

describe('parseBilibiliImportUrl', () => {
  it.each(SUPPORTED_TARGETS)('preserves the supported import target: $url', ({ url, target }) => {
    expect(parseBilibiliImportUrl(url)).toEqual({ ...target, url })
  })

  it.each([
    `  ${VIDEO_URL}?from=search#part  `,
    'https://WWW.BILIBILI.COM:443/video/BV1xx411c7mD/?from=search#part',
  ])('preserves URL normalization, queries and fragments: %s', (input) => {
    expect(parseBilibiliImportUrl(input)).toEqual({
      kind: 'video',
      bvid: 'BV1xx411c7mD',
      url: `${VIDEO_URL}?from=search#part`,
    })
  })

  it('accepts the default HTTPS port for space URLs', () => {
    expect(parseBilibiliImportUrl('https://space.bilibili.com:443/123/upload/audio')).toEqual({
      kind: 'upper-audio',
      mid: '123',
      url: 'https://space.bilibili.com/123/upload/audio',
    })
  })

  it.each(UNDECLARED_URLS)('rejects a URL outside the declared scope: %s', (url) => {
    expect(() => parseBilibiliImportUrl(url)).toThrowError(
      expect.objectContaining({ code: 'unsupported-url' }),
    )
  })

  it.each([
    'https://www.bilibili.com/video/not-a-bvid',
    'https://space.bilibili.com/not-a-mid/upload/video',
    'https://space.bilibili.com/123/favlist?fid=invalid',
    'https://space.bilibili.com/123/unsupported',
  ])('still rejects unsupported resources within a declared origin: %s', (url) => {
    expect(() => parseBilibiliImportUrl(url)).toThrowError(
      expect.objectContaining({ code: 'unsupported-url' }),
    )
  })

  it('preserves the semantic error and original cause for malformed input', () => {
    expect(() => parseBilibiliImportUrl('not a URL')).toThrowError(
      expect.objectContaining({ code: 'invalid-input', cause: expect.any(TypeError) }),
    )
  })

  it.each(['0', '-1', '1.5', '', 'NaN', '9007199254740992'])(
    'rejects an invalid video part before loading a runtime: %s',
    (page) => {
      const { request, runtime, lazy, loadPlugin } = createPlugins()
      const url = `${VIDEO_URL}?p=${page}`
      for (const plugin of [runtime, lazy]) {
        expect(() => plugin.importFromUrl({ url })).toThrowError(
          expect.objectContaining({ code: 'invalid-input' }),
        )
      }
      expect(request).not.toHaveBeenCalled()
      expect(loadPlugin).not.toHaveBeenCalled()
    },
  )
})

describe('Bilibili import preflight', () => {
  it.each(UNDECLARED_URLS)('rejects before creating a runtime or lazy listing: %s', (url) => {
    const { request, runtime, lazy, loadPlugin } = createPlugins()
    for (const plugin of [runtime, lazy]) {
      expect(() => plugin.validateImportUrl(url)).toThrowError(
        expect.objectContaining({ code: 'unsupported-url' }),
      )
      expect(() => plugin.importFromUrl({ url })).toThrowError(
        expect.objectContaining({ code: 'unsupported-url' }),
      )
    }
    expect(request).not.toHaveBeenCalled()
    expect(loadPlugin).not.toHaveBeenCalled()
  })

  it.each(SUPPORTED_TARGETS)('keeps accepted listing creation lazy: $url', ({ url }) => {
    const { request, runtime, lazy, loadPlugin } = createPlugins()
    for (const plugin of [runtime, lazy]) {
      expect(() => plugin.validateImportUrl(url)).not.toThrow()
      const listing = plugin.importFromUrl({ url })
      expect(listing.sourceUrl).toBe(url)
      listing.pages()[Symbol.asyncIterator]()
    }
    expect(request).not.toHaveBeenCalled()
    expect(loadPlugin).not.toHaveBeenCalled()
  })

  it('can load and reuse the runtime after a rejected URL without changing HTTP credentials', async () => {
    const { request, lazy, loadPlugin } = createPlugins()
    expect(() => lazy.importFromUrl({ url: UNDECLARED_URLS[0] })).toThrowError()
    expect(loadPlugin).not.toHaveBeenCalled()
    await expect(lazy.getSession()).resolves.toEqual({ status: 'signed-out' })
    await expect(lazy.getSession()).resolves.toEqual({ status: 'signed-out' })
    expect(loadPlugin).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledTimes(2)
    for (const [input] of request.mock.calls) expect(input.credentials).toBe('include')
  })
})

function createPlugins() {
  const request = vi.fn<HttpClient['request']>().mockResolvedValue({
    status: 200,
    statusText: 'OK',
    headers: '',
    body: JSON.stringify({ code: 0, data: { isLogin: false } }),
  })
  const runtime = new BilibiliMusicSourcePlugin(new BilibiliApi({ request }), () => false)
  const loadPlugin = vi.fn(async () => runtime)
  const lazy = new LazyMusicSourcePlugin({
    descriptor: BILIBILI_MUSIC_SOURCE_DESCRIPTOR,
    validateImportUrl: (url) => {
      parseBilibiliImportUrl(url)
    },
    loadPlugin,
  })
  return { request, runtime, lazy, loadPlugin }
}
