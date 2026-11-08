import { createMusicSourceRegistry } from '@any-music/plugin-center/music-sources'
import { describe, expect, it } from 'vitest'

import { createUnavailableMusicSources } from '../../../src/features/music-sources/unavailable-music-sources'

describe('unavailable native source metadata', () => {
  it('keeps the real registry constructible and source identities stable without desktop ports', async () => {
    const plugins = createUnavailableMusicSources('desktop')
    const registry = createMusicSourceRegistry({
      externalPlugins: 'none',
      builtInPlugins: plugins,
    })
    expect(registry).toBeDefined()
    expect(plugins.map((p) => p.descriptor.id)).toEqual(['bilibili', 'douyin', 'netease'])
    await Promise.all(
      plugins.map(async (plugin) => {
        expect(await plugin.checkAvailability()).toMatchObject({
          status: 'unavailable',
          error: { code: 'unsupported-operation' },
        })
        expect(await plugin.getSession()).toMatchObject({ status: 'unavailable' })
        expect(plugin.getLoginUrl()).toBeUndefined()
        expect(() => plugin.search({ query: 'test' })).toThrow('暂不支持')
      }),
    )
  })
})
