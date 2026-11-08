import type { Track } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { describe, expect, it, vi } from 'vitest'

import { AccountRuntime } from '../../../src/features/accounts/account-runtime'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))

describe('account and source cancellation', () => {
  it.each(['account', 'operation'])(
    'cancels the same Rust request when %s lifetime ends',
    async (kind) => {
      native.invoke.mockReset()
      let finish!: (value: unknown) => void
      native.invoke.mockImplementation(async (command) => {
        if (command === 'http_request')
          return new Promise((resolve) => {
            finish = resolve
          })
        return undefined
      })
      const account = new CancellationSource(),
        operation = new CancellationSource()
      const plugin = await new AccountRuntime().createPlugin(
        {
          backupProxyIds: [],
          state: {
            login: 'signed-in' as 'signed-in' | 'signed-out',
            verification: 'not-required' as const,
            connection: 'available' as const,
          },

          id: 'b-account',
          platformId: 'bilibili',
          name: 'B',
          status: 'ready',
          enabled: true,
          userAgent: 'agent',
          webId: '1',
          proxyId: null,
          authentication: 'credential',
        },
        account.signal,
      )
      const track: Track = {
        id: 'bilibili:video:BV1',
        title: '歌曲',
        artists: [],
        source: { pluginId: 'bilibili', resourceId: 'BV1', partId: '1', mediaKind: 'video' },
      }
      const pending = plugin.resolveMedia(track, { cancellation: operation.signal })
      await vi.waitFor(() =>
        expect(
          native.invoke.mock.calls.filter(([command]) => command === 'http_request'),
        ).toHaveLength(1),
      )
      const request = native.invoke.mock.calls.find(([command]) => command === 'http_request')![1]
        .request
      expect(request).toMatchObject({ accountId: 'b-account', credentials: 'include' })
      if (kind === 'account') account.cancel()
      else operation.cancel()
      expect(native.invoke).toHaveBeenCalledWith('cancel_request', { requestId: request.requestId })
      finish({
        status: 200,
        statusText: 'OK',
        headers: '',
        body: JSON.stringify({ code: 0, data: {} }),
      })
      await expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
      expect(
        native.invoke.mock.calls.filter(([command]) => command === 'http_request'),
      ).toHaveLength(1)
    },
  )
})
