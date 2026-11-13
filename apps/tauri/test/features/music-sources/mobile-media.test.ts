import { AppError } from '@any-music/core'
import type { MusicSourcePlugin, ResolvedMediaSource, Track } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { createBuiltInMusicSources } from '@/features/music-sources/built-in-music-sources'

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
afterEach(() => {
  vi.restoreAllMocks()
  native.invoke.mockReset()
})

describe('Android account-bound media', () => {
  it.each(['success', 'failure', 'cancelled'] as const)(
    'registers descriptors without reading media and releases all grants on %s',
    async (outcome) => {
      const account: NativeAccount = {
        id: 'native-account',
        platformId: 'bilibili',
        name: 'B 站',
        status: 'ready',
        state: { login: 'signed-in', verification: 'not-required', connection: 'available' },
        enabled: true,
        userAgent: '',
        webId: '',
        proxyId: 'phone-proxy',
        backupProxyIds: [],
        authentication: 'credential',
      }
      const track: Track = {
        id: 'song',
        title: '歌曲',
        artists: [],
        source: { pluginId: 'bilibili', resourceId: '1', mediaKind: 'audio' },
      }
      const source: ResolvedMediaSource = {
        type: 'remote-url',
        url: 'https://cdn.example/primary',
        backupUrls: ['https://cdn.example/backup'],
        requestHeaders: { Referer: 'https://www.bilibili.com/' },
        loadingStrategy: 'range',
        quality: { id: 'default', label: '默认', rank: 1 },
        availableQualities: [],
        release: vi.fn(),
      }
      const resolveMedia = vi.fn().mockResolvedValue(source)
      const plugin = { resolveMedia } as unknown as MusicSourcePlugin
      const runtime = new AccountRuntime()
      const cancellation = new CancellationSource()
      const release = vi.fn()
      vi.spyOn(runtime, 'lease').mockResolvedValue(release)
      vi.spyOn(runtime, 'run').mockImplementation(async (_platform, _operation, execute) =>
        execute(account, plugin, cancellation.signal),
      )
      native.invoke.mockImplementation(async (command, input) => {
        if (command !== 'register_media') return
        if (outcome === 'cancelled') cancellation.cancel()
        if (outcome === 'failure' && input.url.endsWith('backup'))
          throw new AppError('network-error', 'grant failed')
        return `http://127.0.0.1:12345/media/${input.url.split('/').at(-1)}`
      })
      const pending = createBuiltInMusicSources(runtime, 'mobile')[0]!.resolveMedia(track)
      if (outcome === 'success') {
        const media = await pending
        expect(media).toMatchObject({
          accountId: account.id,
          url: 'http://127.0.0.1:12345/media/primary',
          backupUrls: ['http://127.0.0.1:12345/media/backup'],
          requestHeaders: undefined,
        })
        expect(release).not.toHaveBeenCalled()
        media.release?.()
        media.release?.()
      } else {
        await expect(pending).rejects.toMatchObject({
          code: outcome === 'failure' ? 'network-error' : 'operation-cancelled',
        })
      }
      expect(resolveMedia).toHaveBeenCalledOnce()
      const registrations = native.invoke.mock.calls.filter(
        ([command]) => command === 'register_media',
      )
      expect(registrations).toHaveLength(2)
      for (const [, input] of registrations)
        expect(input).toMatchObject({
          accountId: account.id,
          headers: source.requestHeaders,
          cacheIdentity: { trackId: track.id, qualityId: source.quality.id },
        })
      expect(native.invoke).not.toHaveBeenCalledWith('http_request', expect.anything())
      expect(native.invoke).toHaveBeenCalledWith('release_media', {
        urls:
          outcome === 'failure'
            ? ['http://127.0.0.1:12345/media/primary']
            : ['http://127.0.0.1:12345/media/primary', 'http://127.0.0.1:12345/media/backup'],
      })
      expect(source.release).toHaveBeenCalledOnce()
      expect(release).toHaveBeenCalledOnce()
    },
  )
})
