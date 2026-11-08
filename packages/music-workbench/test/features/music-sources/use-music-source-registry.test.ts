import type { MusicSourcePlugin, ResolvedMediaSource, Track } from '@any-music/core'
import type { ExternalPluginPolicy } from '@any-music/plugin-center'
import type { NativePluginSnapshot } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { useMusicSourceRegistry } from '#workbench/features/music-sources/use-music-source-registry'

import type { NativePluginAuthorityPort } from '../../../src/features/plugins/use-native-plugin-authority'
const policy = vi.hoisted(() => ({
  value: 'declarative' as ExternalPluginPolicy,
  port: undefined as NativePluginAuthorityPort | undefined,
}))
vi.mock('#workbench/runtime/workbench-runtime', () => ({
  getWorkbenchRuntime: () => ({
    externalPlugins: policy.value,
    nativePluginAuthority: policy.port,
  }),
}))

describe('useMusicSourceRegistry', () => {
  it('withdraws sources, cancels native pages, and rejects callbacks from a disabled generation', async () => {
    const subscribers: ((states: readonly NativePluginSnapshot[]) => void)[] = []
    const unsubscribe = vi.fn()
    let finish!: (value: { token: string; value: unknown }) => void
    const port: NativePluginAuthorityPort = {
      snapshot: vi.fn(async () => []),
      revoke: vi.fn(async () => {}),
      subscribeInstalls: vi.fn((receive) => {
        subscribers.push(receive)
        return unsubscribe
      }),
      cancelExecution: vi.fn(async () => {}),
      execute: vi.fn(
        () =>
          new Promise<{ token: string; value: unknown }>((resolve) => {
            finish = resolve
          }),
      ),
    }
    const state: NativePluginSnapshot = {
      installId: 'install',
      pluginId: 'org.example.catalog',
      contentHash: 'a'.repeat(64),
      publisher: 'unsigned',
      generation: 1,
      dataGeneration: 1,
      permissionEpoch: 1,
      enabled: true,
      historicalLevel: 'L0',
      contributions: ['music.sources'],
      commands: [{ id: 'search', title: { en: 'Search', 'zh-CN': '搜索' } }],
    }
    policy.port = port
    const enabled = shallowRef(false)
    const scope = effectScope()
    try {
      const registry = scope.run(() =>
        useMusicSourceRegistry(
          [createPlugin(async () => ({ status: 'available', checkedAtMs: 1 }))],
          enabled,
        ),
      )!
      expect(port.subscribeInstalls).not.toHaveBeenCalled()
      enabled.value = true
      subscribers[0]!([state])
      registry.activate(state.pluginId)
      expect(port.execute).not.toHaveBeenCalled()
      const pages = registry.activePlugin.value.search({ query: 'one' }).pages()
      const pending = pages[Symbol.asyncIterator]().next()
      const cancelled = expect(pending).rejects.toMatchObject({ code: 'operation-cancelled' })
      expect(port.execute).toHaveBeenCalledOnce()
      enabled.value = false
      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(port.cancelExecution).toHaveBeenCalledExactlyOnceWith('install')
      expect(registry.activePluginId.value).toBe('test')
      subscribers[0]!([state])
      expect(registry.plugins.value.map((plugin) => plugin.descriptor.id)).toEqual(['test'])
      finish({ token: 'late', value: { items: [], pageNumber: 1, pageSize: 20, hasMore: false } })
      await cancelled
      enabled.value = true
      subscribers[1]!([state])
      expect(registry.getPlugin(state.pluginId)).toBeDefined()
      expect(port.execute).toHaveBeenCalledOnce()
      expect(port.revoke).not.toHaveBeenCalled()
    } finally {
      scope.stop()
      policy.port = undefined
    }
  })
  it('never subscribes to external installs under the none policy even when the feature is enabled', () => {
    policy.value = 'none'
    const subscribeInstalls = vi.fn()
    policy.port = { snapshot: async () => [], revoke: async () => {}, subscribeInstalls }
    const scope = effectScope()
    try {
      scope.run(() =>
        useMusicSourceRegistry(
          [createPlugin(async () => ({ status: 'available', checkedAtMs: 1 }))],
          true,
        ),
      )
      expect(subscribeInstalls).not.toHaveBeenCalled()
    } finally {
      scope.stop()
      policy.value = 'declarative'
      policy.port = undefined
    }
  })
  it('applies none to source commands, media and background prefetch', async () => {
    policy.value = 'none'
    try {
      const plugin = createPlugin(async () => ({ status: 'available', checkedAtMs: 1 }))
      const manifest = { id: 'outside' }
      const registry = useMusicSourceRegistry([plugin])
      expect(registry.plugins.value.map((item) => item.descriptor.id)).toEqual(['test'])
      expect(() => registry.activate(manifest.id)).toThrow('仅支持内置')
      expect(() => registry.setEnabled(manifest.id, true)).toThrow('仅支持内置')
      await expect(registry.checkAvailability(manifest.id)).rejects.toThrow('仅支持内置')
      await expect(registry.resolveMedia(createTrack(manifest.id))).rejects.toThrow('仅支持内置')
      expect(registry.getPlugin(manifest.id)).toBeUndefined()
      expect(registry.canPrefetchMedia(createTrack(manifest.id))).toBe(false)
      expect(registry.canPrefetchMedia(createTrack('test'))).toBe(true)
      registry.activate('test')
    } finally {
      policy.value = 'declarative'
    }
  })
  it('converts a rejected availability check into a stable unavailable state', async () => {
    const plugin = createPlugin(() => Promise.reject(new Error('upstream timed out')))
    const registry = useMusicSourceRegistry([plugin])

    const result = await registry.checkAvailability(plugin.descriptor.id)

    expect(result).toMatchObject({
      status: 'unavailable',
      error: {
        code: 'upstream-error',
        statusCode: 'AM-3002',
        message: 'upstream timed out',
      },
    })
    expect(registry.getAvailability(plugin.descriptor.id)).toEqual(result)
  })

  it('forwards an explicitly selected quality to the owning plugin', async () => {
    const track: Track = {
      id: 'test:track:1',
      title: '测试歌曲',
      artists: [{ id: 'artist:1', name: '测试歌手' }],
      source: { pluginId: 'test', mediaKind: 'audio', resourceId: '1' },
    }
    const quality = { id: 'quality:high', label: '高音质', rank: 2 }
    const source: ResolvedMediaSource = {
      type: 'remote-url',
      url: 'https://media.example/high.mp3',
      backupUrls: [],
      loadingStrategy: 'range',
      quality,
      availableQualities: [quality],
    }
    const plugin = createPlugin(() =>
      Promise.resolve({ status: 'available', checkedAtMs: Date.now() }),
    )
    const resolveMedia = vi.fn(() => Promise.resolve(source))
    plugin.resolveMedia = resolveMedia
    const registry = useMusicSourceRegistry([plugin])

    const resolved = await registry.resolveMedia(track, { qualityId: quality.id })
    expect(resolved).toMatchObject(source)
    expect(resolveMedia).toHaveBeenCalledWith(
      track,
      expect.objectContaining({ qualityId: quality.id, cancellation: expect.any(Object) }),
    )
    resolved.release?.()
  })
})

function createTrack(pluginId: string): Track {
  return {
    id: `${pluginId}:audio:1`,
    title: '测试歌曲',
    artists: [{ name: '测试歌手' }],
    source: { pluginId, mediaKind: 'audio', resourceId: '1' },
  }
}

/** 构造完整插件契约，确保测试覆盖注册表而不是依赖不完整的类型替身。 */
function createPlugin(
  checkAvailability: MusicSourcePlugin['checkAvailability'],
): MusicSourcePlugin {
  return {
    descriptor: {
      id: 'test',
      name: '测试源',
      provenance: 'built-in',
      capabilities: { search: false, importUrl: false, session: false },
      importUrlScopes: [],
    },
    checkAvailability,
    validateImportUrl: () => undefined,
    getSession: () => Promise.resolve({ status: 'not-required' }),
    getLoginUrl: () => undefined,
    search: () => {
      throw new Error('not supported')
    },
    importFromUrl: () => {
      throw new Error('not supported')
    },
    resolveMedia: () => Promise.reject(new Error('not supported')),
  }
}
