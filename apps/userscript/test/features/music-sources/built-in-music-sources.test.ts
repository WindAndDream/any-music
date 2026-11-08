import type { HttpRequest } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

const http = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/platform/http/gm-http-client', () => ({ gmHttpClient: http }))

describe('Userscript source package composition', () => {
  it.each([
    ['www.bilibili.com', ['bilibili', 'douyin', 'netease']],
    ['music.163.com', ['netease', 'bilibili', 'douyin']],
    ['www.douyin.com', ['douyin', 'bilibili', 'netease']],
  ])('keeps assigned sources with host priority on %s', async (hostname, expected) => {
    vi.resetModules()
    vi.stubGlobal('window', { location: { hostname } })
    try {
      const { builtInMusicSources } =
        await import('../../../src/features/music-sources/built-in-music-sources')
      expect(builtInMusicSources.map((source) => source.descriptor.id)).toEqual(expected)
      const { builtInWorkbenchModules } =
        await import('../../../src/features/plugins/built-in-workbench-modules')
      expect(
        builtInWorkbenchModules
          .filter((module) => module.id.startsWith('source.'))
          .map((module) => module.id),
      ).toEqual(['source.bilibili', 'source.douyin', 'source.netease'])
      expect(http.request).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('assembles NetEase lazily with authenticated GM transport', async () => {
    http.request.mockReset()
    vi.stubGlobal('window', { location: { hostname: 'music.163.com' } })
    try {
      const { builtInMusicSources } =
        await import('../../../src/features/music-sources/built-in-music-sources')
      const source = builtInMusicSources.find((value) => value.descriptor.id === 'netease')!
      http.request.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: '',
        body: JSON.stringify({ code: 200, profile: null, account: null }),
      })
      expect(await source.getSession()).toEqual({ status: 'signed-out' })
      expect(http.request).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          url: 'https://music.163.com/api/w/nuser/account/get',
          credentials: 'include',
        }),
      )
    } finally {
      http.request.mockReset()
      vi.unstubAllGlobals()
    }
  })
  it('defers protocol work, keeps include on GM and aborts the pending source request', async () => {
    vi.stubGlobal('window', { location: { hostname: 'example.com' } })
    try {
      const { AppError } = await import('@any-music/core')
      const { builtInMusicSources } =
        await import('../../../src/features/music-sources/built-in-music-sources')
      const plugin = builtInMusicSources.find((value) => value.descriptor.id === 'bilibili')!
      const controller = new AbortController()
      let request!: HttpRequest
      http.request.mockImplementation((input: HttpRequest) => {
        request = input
        return new Promise((_resolve, reject) =>
          input.cancellation?.subscribe(() => reject(new AppError('operation-cancelled'))),
        )
      })
      const listing = plugin.importFromUrl({ url: 'https://www.bilibili.com/video/BV123456' })
      expect(http.request).not.toHaveBeenCalled()
      const pages = listing.pages({
        cancellation: {
          isCancelled: () => controller.signal.aborted,
          subscribe(listener) {
            controller.signal.addEventListener('abort', listener)
            return () => controller.signal.removeEventListener('abort', listener)
          },
        },
      })
      const pending = pages[Symbol.asyncIterator]().next()
      await vi.waitFor(() => expect(http.request).toHaveBeenCalledTimes(1))
      expect(request).toMatchObject({
        credentials: 'include',
        url: expect.stringContaining('/x/web-interface/view'),
      })
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
      expect(http.request).toHaveBeenCalledTimes(1)
      expect(request.cancellation?.isCancelled()).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
