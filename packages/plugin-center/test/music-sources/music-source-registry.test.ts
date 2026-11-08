import type { MusicSourceAvailability, MusicSourcePlugin } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'

import { createMusicSourceRegistry } from '../../src/music-sources/index'

function createPlugin(
  checkAvailability: MusicSourcePlugin['checkAvailability'],
): MusicSourcePlugin {
  return {
    descriptor: {
      id: 'test',
      name: 'Test',
      provenance: 'built-in',
      capabilities: { search: false, importUrl: false, session: false },
      importUrlScopes: [],
    },
    checkAvailability,
    validateImportUrl: () => undefined,
    getSession: async () => ({ status: 'not-required' }),
    getLoginUrl: () => undefined,
    search: () => {
      throw new Error('unsupported')
    },
    importFromUrl: () => {
      throw new Error('unsupported')
    },
    resolveMedia: async () => {
      throw new Error('unsupported')
    },
  }
}

describe('headless source registry', () => {
  it('replaces native source generations without promoting them to built-ins', () => {
    const builtin = createPlugin(async () => ({ status: 'available', checkedAtMs: 1 }))
    const outside = {
      ...builtin,
      descriptor: { ...builtin.descriptor, id: 'native', name: 'Native' },
    }
    const registry = createMusicSourceRegistry({
      externalPlugins: 'sandboxed',
      builtInPlugins: [builtin],
    })
    registry.setRuntimeSources([outside, builtin])
    expect(registry.plugins.map((plugin) => plugin.descriptor.id)).toEqual(['test', 'native'])
    expect(registry.getPlugin('native')?.descriptor.provenance).toBe('external')
    expect(registry.canPrefetchMedia({ source: { pluginId: 'native' } } as never)).toBe(false)
    registry.activate('native')
    registry.setRuntimeSources([])
    expect(registry.activePluginId).toBe('test')
    expect(registry.getPlugin('native')).toBeUndefined()
    const none = createMusicSourceRegistry({
      externalPlugins: 'none',
      builtInPlugins: [builtin],
    })
    none.setRuntimeSources([outside])
    expect(none.plugins).toHaveLength(1)
    registry.dispose()
    none.dispose()
  })
  it('derives external identity from directory membership even if a factory claims built-in', async () => {
    const builtIn = createPlugin(async () => ({ status: 'available', checkedAtMs: 1 }))
    const outside = {
      ...createPlugin(async () => ({ status: 'available', checkedAtMs: 1 })),
      descriptor: { ...builtIn.descriptor, id: 'outside', name: 'Outside' },
    }
    const registry = createMusicSourceRegistry({
      externalPlugins: 'declarative',
      builtInPlugins: [builtIn],
    })
    registry.setRuntimeSources([outside])
    await registry.checkAvailability('outside')
    expect(registry.getPlugin('outside')?.descriptor.provenance).toBe('external')
    expect(registry.canPrefetchMedia({ source: { pluginId: 'outside' } } as never)).toBe(false)
    expect(() => registry.remove('test')).toThrow('内置插件不能删除')
    registry.remove('outside')
  })
  it('lets only the latest availability request publish state', async () => {
    const requests: Array<(value: MusicSourceAvailability) => void> = []
    const plugin = createPlugin(
      () =>
        new Promise((resolve) => {
          requests.push(resolve)
        }),
    )
    const registry = createMusicSourceRegistry({
      externalPlugins: 'declarative',
      builtInPlugins: [plugin],
    })
    const first = registry.checkAvailability('test')
    const second = registry.checkAvailability('test')
    requests[1]!({ status: 'available', checkedAtMs: 2 })
    await second
    requests[0]!({ status: 'unchecked' })
    await first
    expect(registry.getAvailability('test')).toEqual({ status: 'available', checkedAtMs: 2 })
  })

  it('supports unsubscribe and maps rejected checks into serializable errors', async () => {
    const plugin = createPlugin(async () => {
      throw new Error('offline')
    })
    const registry = createMusicSourceRegistry({
      externalPlugins: 'declarative',
      builtInPlugins: [plugin],
    })
    const changed = vi.fn()
    const plugins = registry.plugins
    const unsubscribe = registry.subscribe(changed)
    await registry.checkAvailability('test')
    expect(registry.plugins).toBe(plugins)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(registry.getAvailability('test')).toMatchObject({
      status: 'unavailable',
      error: { code: 'upstream-error', message: 'offline' },
    })
    unsubscribe()
    registry.activate('test')
    expect(changed).toHaveBeenCalledTimes(2)
  })
})
