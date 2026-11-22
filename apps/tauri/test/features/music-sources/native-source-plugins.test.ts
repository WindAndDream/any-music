import { AppError } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadDouyinPlugin } from '@/features/music-sources/native-source-plugins'
import type { DouyinAccountBrowserCatalog } from '@/platform/douyin-browser-catalog'
import { createNativeHttpClient } from '@/platform/native-http'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

function identityResponse(body: { userId: string | null }) {
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
  native.invoke.mockImplementation(async (command) => {
    if (command === 'request_state') return { userAgent: 'native-desktop-agent', webId: '1' }
    if (command === 'http_request') return identityResponse({ userId: '123' })
    if (command === 'douyin_catalog_request')
      return [0, 200, ...new TextEncoder().encode('{"nickname":"测试抖音昵称"}')]
    throw new Error(`Unexpected native command: ${command}`)
  })
})

describe('native Douyin session composition', () => {
  it('reads the nickname only through the official profile after confirming login', async () => {
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
      'douyin_catalog_request',
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
    expect(native.invoke).toHaveBeenNthCalledWith(3, 'douyin_catalog_request', {
      requestId: expect.any(String),
      accountId: 'account-a',
      importKind: 'self-nickname',
    })
  })

  it('keeps session errors and cancellation independent of the catalog page reader', async () => {
    const cancellation = new CancellationSource()
    const getSelfImportProfile = vi.fn()
    const catalog: DouyinAccountBrowserCatalog = {
      getSelfImportProfile,
      getSelfNickname: vi.fn(),
      openSearch: vi.fn(),
    }
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
    expect(catalog.getSelfNickname).not.toHaveBeenCalled()
    expect(catalog.openSearch).not.toHaveBeenCalled()
  })

  it('keeps the confirmed login when the official profile fails', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 200, body: '{"userId":"123"}' })
    const getSelfNickname = vi.fn().mockRejectedValueOnce(new AppError('verification-required'))
    const plugin = await loadDouyinPlugin(
      { accountId: 'account-a', http: { request } },
      {
        createPageCatalog: () => ({
          getSelfNickname,
          getSelfImportProfile: vi.fn(),
          openSearch: vi.fn(),
        }),
      },
    )
    expect(await plugin.getSession()).toEqual({
      status: 'signed-in',
      user: { id: '123', name: '' },
    })
    expect(request).toHaveBeenCalledOnce()
    expect(getSelfNickname).toHaveBeenCalledOnce()
  })

  it('cancels the in-flight profile request and discards its late nickname', async () => {
    const cancellation = new CancellationSource()
    const request = vi.fn().mockResolvedValueOnce({ status: 200, body: '{"userId":"123"}' })
    let finish!: (value: number[]) => void
    const browserRequest = new Promise<number[]>((resolve) => {
      finish = resolve
    })
    native.invoke.mockImplementation(async (command) => {
      if (command === 'request_state') return { userAgent: 'native-desktop-agent', webId: '1' }
      if (command === 'douyin_catalog_request') return browserRequest
      if (command === 'cancel_request') return undefined
      throw new Error(`Unexpected native command: ${command}`)
    })
    const plugin = await loadDouyinPlugin({
      accountId: 'account-a',
      http: { request },
      cancellation: cancellation.signal,
    })
    const result = plugin.getSession()
    const cancelled = expect(result).rejects.toMatchObject({ code: 'operation-cancelled' })
    await vi.waitFor(() =>
      expect(native.invoke).toHaveBeenLastCalledWith('douyin_catalog_request', expect.anything()),
    )
    const requestId = native.invoke.mock.calls.at(-1)?.[1].requestId
    cancellation.cancel()
    expect(native.invoke).toHaveBeenLastCalledWith('cancel_request', { requestId })
    finish([0, 200, ...new TextEncoder().encode('{"nickname":"过期结果"}')])
    await cancelled
  })
})
