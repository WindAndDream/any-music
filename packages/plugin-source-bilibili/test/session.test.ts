import { AppError } from '@any-music/core'
import type { HttpClient } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { BilibiliApi } from '../src/bilibili-api'
import { BilibiliMusicSourcePlugin } from '../src/bilibili-plugin'

function response(body: unknown) {
  return { status: 200, statusText: 'OK', headers: '', body: JSON.stringify(body) }
}

describe('Bilibili account session', () => {
  it('exposes expired authentication and recovers only on a fresh included-credentials check', async () => {
    const request = vi
      .fn<HttpClient['request']>()
      .mockResolvedValueOnce(response({ code: -101, message: '账号未登录' }))
      .mockResolvedValueOnce(
        response({ code: 0, data: { isLogin: true, mid: 42, uname: '测试用户' } }),
      )
    const plugin = new BilibiliMusicSourcePlugin(new BilibiliApi({ request }))

    await expect(plugin.getSession()).resolves.toMatchObject({
      status: 'expired',
      error: { code: 'not-authenticated' },
    })
    expect(request).toHaveBeenCalledOnce()
    await expect(plugin.getSession()).resolves.toMatchObject({
      status: 'signed-in',
      user: { id: '42', name: '测试用户' },
    })
    expect(request).toHaveBeenCalledTimes(2)
    for (const [input] of request.mock.calls) {
      expect(input).toMatchObject({
        url: 'https://api.bilibili.com/x/web-interface/nav',
        credentials: 'include',
      })
    }
  })

  it('preserves a successful signed-out response', async () => {
    const request = vi
      .fn<HttpClient['request']>()
      .mockResolvedValue(response({ code: 0, data: { isLogin: false } }))
    const plugin = new BilibiliMusicSourcePlugin(new BilibiliApi({ request }))
    await expect(plugin.getSession()).resolves.toEqual({ status: 'signed-out' })
    expect(request).toHaveBeenCalledOnce()
  })

  it('keeps network failures unavailable instead of suggesting that login repairs transport', async () => {
    const request = vi
      .fn<HttpClient['request']>()
      .mockRejectedValue(new AppError('network-error', '网络不可用。'))
    const plugin = new BilibiliMusicSourcePlugin(new BilibiliApi({ request }))
    await expect(plugin.getSession()).resolves.toMatchObject({
      status: 'unavailable',
      error: { code: 'network-error' },
    })
    expect(request).toHaveBeenCalledOnce()
  })
})
