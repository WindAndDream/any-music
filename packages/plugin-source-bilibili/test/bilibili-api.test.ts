import { AppError } from '@any-music/core'
import type { HttpClient } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { BilibiliApi } from '../src/bilibili-api'

describe('Bilibili HTML5 playback contract', () => {
  it('cancels WBI material loading before a business request and does not poison later operations', async () => {
    const controller = new AbortController()
    const request = vi.fn<HttpClient['request']>(
      (input) =>
        new Promise((_resolve, reject) => {
          input.cancellation?.subscribe(() => reject(new AppError('operation-cancelled')))
        }),
    )
    const api = new BilibiliApi({ request })
    const signal = {
      isCancelled: () => controller.signal.aborted,
      subscribe(listener: () => void) {
        controller.signal.addEventListener('abort', listener)
        return () => controller.signal.removeEventListener('abort', listener)
      },
    }
    const pending = api.withCancellation(signal).searchVideos('音乐', 1, 1)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.lastCall?.[0]).toMatchObject({
      credentials: 'include',
      url: expect.stringContaining('/x/web-interface/nav'),
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(request).toHaveBeenCalledTimes(1)
    request.mockRejectedValueOnce(new AppError('network-error'))
    await expect(api.searchVideos('音乐', 1, 1)).rejects.toMatchObject({ code: 'network-error' })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('preserves a transport network failure for the shared recovery flow', async () => {
    const httpClient: HttpClient = {
      request: () => Promise.reject(new AppError('network-error', '网络连接已中断。')),
    }

    await expect(new BilibiliApi(httpClient).getNav()).rejects.toMatchObject({
      code: 'network-error',
    })
  })

  it('requests the progressive compatibility response explicitly', async () => {
    let requestUrl = ''
    const httpClient: HttpClient = {
      async request(request) {
        requestUrl = request.url
        return {
          status: 200,
          statusText: 'OK',
          headers: '',
          body: JSON.stringify({ code: 0, message: '0', data: { durl: [] } }),
        }
      },
    }

    await new BilibiliApi(httpClient).getHtml5VideoPlayUrl('BV-test', 'cid-test')

    const url = new URL(requestUrl)
    expect(url.pathname).toBe('/x/player/playurl')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      bvid: 'BV-test',
      cid: 'cid-test',
      qn: '127',
      fnval: '0',
      platform: 'html5',
      high_quality: '1',
    })
  })
})
