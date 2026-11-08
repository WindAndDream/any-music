import { AppError } from '@any-music/core'
import type { HttpResponse } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import type { DouyinBrowserCatalog } from '@any-music/plugin-source-douyin/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadDouyinPlugin } from '@/features/music-sources/native-source-plugins'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

const profile = new TextEncoder().encode(
  JSON.stringify({ status_code: 0, user: { uid: '123', nickname: '页面账号' } }),
)
const response = (): HttpResponse => ({ status: 200, statusText: '', headers: '', body: profile })

beforeEach(() => {
  native.invoke.mockReset()
  native.invoke.mockImplementation(async (command) => {
    if (command === 'request_state') return { userAgent: 'native-desktop-agent', webId: '1' }
    if (command === 'douyin_catalog_request') return Uint8Array.from([0, 200, ...profile])
    throw new Error(`Unexpected native command: ${command}`)
  })
})

describe('native Douyin page reader composition', () => {
  it('retains native account-bound CDP as the production default', async () => {
    const request = vi.fn()
    const plugin = await loadDouyinPlugin({ accountId: 'account-a', http: { request } })
    expect((await plugin.getSession()).status).toBe('signed-in')
    expect(native.invoke).toHaveBeenLastCalledWith(
      'douyin_catalog_request',
      expect.objectContaining({ accountId: 'account-a' }),
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('passes identity/cancellation to a trusted alternate page reader without falling back to CDP or HTTP', async () => {
    const cancellation = new CancellationSource()
    const getSelfProfile = vi
      .fn()
      .mockResolvedValueOnce(response())
      .mockRejectedValueOnce(new AppError('verification-required', '页面需要验证'))
    const catalog: DouyinBrowserCatalog = { getSelfProfile, openSearch: vi.fn() }
    const createPageCatalog = vi.fn(() => catalog)
    const request = vi.fn()
    const plugin = await loadDouyinPlugin(
      { accountId: 'account-a', http: { request }, cancellation: cancellation.signal },
      { createPageCatalog },
    )
    expect(createPageCatalog).toHaveBeenCalledExactlyOnceWith({
      accountId: 'account-a',
      cancellation: cancellation.signal,
    })
    expect(await plugin.getSession()).toMatchObject({
      status: 'signed-in',
      user: { name: '页面账号' },
    })
    expect(await plugin.getSession()).toMatchObject({
      status: 'unavailable',
      error: { code: 'verification-required' },
    })
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(['request_state'])
    expect(request).not.toHaveBeenCalled()
    expect(catalog.openSearch).not.toHaveBeenCalled()
  })
})
