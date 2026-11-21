import { AppError } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import type { DouyinBrowserCatalog } from '@any-music/plugin-source-douyin/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadDouyinPlugin } from '@/features/music-sources/native-source-plugins'
import { createNativeHttpClient } from '@/platform/native-http'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

function response(body: { userId: string | null } | { nickname: string }) {
  const encoder = new TextEncoder()
  const metadata = encoder.encode(
    JSON.stringify({ status: 200, statusText: 'OK', headers: '', responseType: 'text' }),
  )
  const payload = encoder.encode(JSON.stringify(body))
  const bytes = new Uint8Array(4 + metadata.byteLength + payload.byteLength)
  new DataView(bytes.buffer).setUint32(0, metadata.byteLength)
  bytes.set(metadata, 4)
  bytes.set(payload, 4 + metadata.byteLength)
  return bytes.buffer
}

beforeEach(() => {
  native.invoke.mockReset()
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'request_state') return { userAgent: 'native-desktop-agent', webId: '1' }
    if (command === 'http_request')
      return args.request.url === 'https://www.douyin.com/user/self'
        ? response({ nickname: '测试抖音昵称' })
        : response({ userId: '123' })
    throw new Error(`Unexpected native command: ${command}`)
  })
})

describe('native Douyin session composition', () => {
  it('reads the real nickname through native HTTP after confirming login', async () => {
    const plugin = await loadDouyinPlugin({
      accountId: 'account-a',
      http: createNativeHttpClient('account-a'),
    })
    expect(await plugin.getSession()).toEqual({
      status: 'signed-in',
      user: { id: '123', name: '测试抖音昵称' },
    })
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      'request_state',
      'http_request',
      'http_request',
    ])
    expect(native.invoke).toHaveBeenNthCalledWith(2, 'http_request', {
      request: expect.objectContaining({
        accountId: 'account-a',
        url: 'https://www.douyin.com/aweme/v1/web/query/user/?device_platform=webapp&aid=6383&channel=channel_pc_web&publish_video_strategy_type=2',
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({ Referer: 'https://www.douyin.com/jingxuan' }),
        maxResponseBytes: 32 * 1024,
      }),
    })
    expect(native.invoke).toHaveBeenNthCalledWith(3, 'http_request', {
      request: expect.objectContaining({
        accountId: 'account-a',
        url: 'https://www.douyin.com/user/self',
        method: 'GET',
        credentials: 'include',
      }),
    })
  })

  it('keeps session errors and cancellation independent of the catalog page reader', async () => {
    const cancellation = new CancellationSource()
    const getSelfImportProfile = vi.fn()
    const catalog: DouyinBrowserCatalog = { getSelfImportProfile, openSearch: vi.fn() }
    const createPageCatalog = vi.fn(() => catalog)
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: '{"userId":null}',
        headers: '',
        statusText: 'OK',
      })
      .mockRejectedValueOnce(new AppError('verification-required', '账号需要验证'))
      .mockRejectedValueOnce(new AppError('operation-cancelled'))
    const plugin = await loadDouyinPlugin(
      { accountId: 'account-a', http: { request }, cancellation: cancellation.signal },
      { createPageCatalog },
    )
    expect(createPageCatalog).toHaveBeenCalledExactlyOnceWith({
      accountId: 'account-a',
      cancellation: cancellation.signal,
    })
    expect(await plugin.getSession()).toEqual({ status: 'signed-out' })
    expect(await plugin.getSession()).toMatchObject({
      status: 'unavailable',
      error: { code: 'verification-required' },
    })
    await expect(plugin.getSession()).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(['request_state'])
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ cancellation: cancellation.signal }),
    )
    expect(request).toHaveBeenCalledTimes(3)
    expect(getSelfImportProfile).not.toHaveBeenCalled()
    expect(catalog.openSearch).not.toHaveBeenCalled()
  })

  it('keeps a confirmed login when the nickname lookup fails', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        headers: '',
        body: '{"userId":"123"}',
      })
      .mockRejectedValueOnce(new AppError('request-timeout'))
    const plugin = await loadDouyinPlugin({ accountId: 'account-a', http: { request } })
    expect(await plugin.getSession()).toEqual({
      status: 'signed-in',
      user: { id: '123', name: '' },
    })
  })
})
