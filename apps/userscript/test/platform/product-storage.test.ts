import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  tabs: new Map<string, Record<string, unknown>>(),
  reads: [] as string[],
  writes: [] as string[],
  failStaging: false,
  failTabSave: false,
  beforeWrite: undefined as ((key: string) => Promise<void> | void) | undefined,
  afterWrite: undefined as ((key: string) => void) | undefined,
  onTabs: undefined as
    | ((resolve: (tabs: Record<string, Record<string, unknown>>) => void) => void)
    | undefined,
}))
const configure = vi.hoisted(() => vi.fn())
const clone = vi.hoisted(
  () =>
    <T>(value: T): T =>
      value === undefined ? value : JSON.parse(JSON.stringify(value)),
)
const manager = vi.hoisted(() => (tabId: string) => ({
  GM: {
    getTab: async () => clone(fixture.tabs.get(tabId) ?? {}),
    saveTab: async (tab: Record<string, unknown>) => {
      if (fixture.failTabSave) throw new Error('Tab registration failed')
      fixture.tabs.set(tabId, clone(tab))
    },
    getTabs: () =>
      new Promise<Record<string, Record<string, unknown>>>((resolve) => {
        if (fixture.onTabs) fixture.onTabs(resolve)
        else resolve(clone(Object.fromEntries(fixture.tabs)))
      }),
    getValue: async <T>(key: string, fallback?: T) => {
      fixture.reads.push(key)
      return clone((fixture.values.get(key) as T | undefined) ?? fallback)
    },
    setValue: async (key: string, value: unknown) => {
      await fixture.beforeWrite?.(key)
      if (fixture.failStaging && key.endsWith(':core')) throw new Error('Staging write failed')
      fixture.values.set(key, clone(value))
      fixture.writes.push(key)
      fixture.afterWrite?.(key)
    },
    deleteValue: async (key: string) => {
      await fixture.beforeWrite?.(key)
      fixture.values.delete(key)
      fixture.writes.push(key)
      fixture.afterWrite?.(key)
    },
    listValues: async () => Array.from(fixture.values.keys()),
  },
  // Product IO must never depend on the stale document-start cache.
  GM_getValue: () => {
    throw new Error('Synchronous GM cache read')
  },
  GM_setValue: () => {
    throw new Error('Unacknowledged GM write')
  },
  GM_deleteValue: () => {
    throw new Error('Unacknowledged GM deletion')
  },
  GM_openInTab: vi.fn(),
}))
vi.mock('$', () => manager('one'))
vi.mock('@any-music/music-workbench', () => ({ configureWorkbenchRuntime: configure }))
vi.mock('../../src/features/music-sources/built-in-music-sources', () => ({
  builtInMusicSources: [],
}))
vi.mock('../../src/features/plugins/built-in-workbench-modules', () => ({
  builtInFeatureModules: [],
  loadTagManagement: vi.fn(),
  loadMusicCreation: vi.fn(),
  builtInWorkbenchModules: [],
  builtInUiThemes: [],
}))
vi.mock('../../src/platform/http/gm-http-client', () => ({
  gmHttpClient: {},
  gmHttpTransport: {},
  configureGmHttpCache: vi.fn(),
}))
vi.mock('../../src/platform/http/gm-proxy', () => ({ configureGmHttpProxy: vi.fn() }))

import { configureUserscriptWorkbench } from '../../src/platform/configure-userscript-workbench'

const POINTER = 'any-music:userscript:product-data:commit'
async function realm(tab: string) {
  vi.resetModules()
  vi.doMock('$', () => manager(tab))
  return import('../../src/platform/product-storage')
}
beforeEach(() => {
  fixture.values.clear()
  fixture.tabs.clear()
  fixture.reads.length = fixture.writes.length = 0
  fixture.failStaging = fixture.failTabSave = false
  fixture.beforeWrite = fixture.afterWrite = fixture.onTabs = undefined
  configure.mockReset()
})

describe('production GM storage composition', () => {
  it('drains cache writers before releasing the manager-owned tab registration', async () => {
    const storage = await (await realm('one')).createGmProductStorage()
    let finish!: () => void
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    storage.onDispose(cleanup)
    const closing = storage.dispose()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(fixture.tabs.get('one')).toHaveProperty('anyMusicProductWriter')
    await expect((await realm('two')).createGmProductStorage()).rejects.toThrow()
    finish()
    await closing
    expect(fixture.tabs.get('one')).not.toHaveProperty('anyMusicProductWriter')
    await (await (await realm('two')).createGmProductStorage()).dispose()
  })
  it('awaits initial persistence and releases registration after failed staging', async () => {
    fixture.failStaging = true
    await expect(configureUserscriptWorkbench()).rejects.toThrow('Staging write failed')
    expect(configure).not.toHaveBeenCalled()
    expect(fixture.values.has(POINTER)).toBe(false)
    expect(fixture.tabs.get('one')).not.toHaveProperty('anyMusicProductWriter')
    fixture.failStaging = false
    await configureUserscriptWorkbench()
    expect(configure.mock.lastCall![0].externalPlugins).toBe('none')
    expect(fixture.values.get(POINTER)).toMatchObject({ sequence: 1 })
  })

  it('uses namespaced current data and leaves earlier business keys untouched', async () => {
    fixture.values.set('any-music:dev-preview:gm:local-library:v1', { marker: 'dev' })
    fixture.values.set('any-music:userscript:playback-queue:v1', { marker: 'earlier' })
    const release = await configureUserscriptWorkbench()
    const storage = configure.mock.lastCall![0].storage
    expect(storage.read('playback-queue:v1').trackIds).toEqual([])
    storage.write('playback-queue:v1', { schemaVersion: 1, trackIds: [], mode: 'repeat-one' })
    await storage.flush()
    expect(fixture.values.get(POINTER)).toMatchObject({ sequence: 2 })
    expect(fixture.values.get('any-music:userscript:playback-queue:v1')).toEqual({
      marker: 'earlier',
    })
    expect(fixture.values.get('any-music:dev-preview:gm:local-library:v1')).toEqual({
      marker: 'dev',
    })
    expect(
      fixture.reads.every(
        (key) =>
          key.startsWith('any-music:userscript:product-data:') ||
          key.startsWith('any-music:userscript:resource-cache:') ||
          key.endsWith('runtime:proxy:v1'),
      ),
    ).toBe(true)
    expect(
      fixture.writes.every(
        (key) =>
          key.startsWith('any-music:userscript:product-data:') ||
          key.startsWith('any-music:userscript:resource-cache:'),
      ),
    ).toBe(true)
    await release()
    expect(fixture.tabs.get('one')).not.toHaveProperty('anyMusicProductWriter')
  })
  it('releases the writer when runtime configuration rejects', async () => {
    configure.mockImplementationOnce(() => {
      throw new Error('Configuration failed')
    })
    await expect(configureUserscriptWorkbench()).rejects.toThrow('Configuration failed')
    expect(fixture.tabs.get('one')).not.toHaveProperty('anyMusicProductWriter')
    await (await realm('two')).createGmProductStorage()
  })
})

describe('manager-owned single writer sessions', () => {
  it('rejects another tab before reading product data or acknowledging any save', async () => {
    const first = await (await realm('one')).createGmProductStorage()
    first.write('ui-theme:v1', { themeId: 'studio' })
    await first.flush()
    const before = clone([...fixture.values])
    const reads = fixture.reads.length
    await expect((await realm('two')).createGmProductStorage()).rejects.toThrow('另一个标签页')
    expect(fixture.reads).toHaveLength(reads)
    expect([...fixture.values]).toEqual(before)
    await first.dispose()
    expect(() => first.write('ui-theme:v1', {})).toThrow('session changed')
    const second = await (await realm('two')).createGmProductStorage()
    expect(second.read('ui-theme:v1')).toEqual({ themeId: 'studio' })
    second.write('playback-queue:v1', { schemaVersion: 1, trackIds: [], mode: 'repeat-one' })
    await second.flush()
    await second.dispose()
    const restored = await (await realm('three')).createGmProductStorage()
    expect(restored.read('ui-theme:v1')).toEqual({ themeId: 'studio' })
    expect(restored.read('playback-queue:v1')).toMatchObject({ mode: 'repeat-one' })
  })

  it('does not grant two simultaneous initializations ownership', async () => {
    const one = await realm('one')
    const two = await realm('two')
    const callbacks: ((tabs: Record<string, Record<string, unknown>>) => void)[] = []
    fixture.onTabs = (resolve) => {
      callbacks.push(resolve)
    }
    const first = one.createGmProductStorage()
    const second = two.createGmProductStorage()
    const settled = Promise.allSettled([first, second])
    await vi.waitFor(() => expect(callbacks).toHaveLength(2))
    const snapshot = clone(Object.fromEntries(fixture.tabs))
    callbacks.forEach((resolve) => resolve(snapshot))
    const results = await settled
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(fixture.writes).toEqual([])
    expect([...fixture.tabs.values()].every((tab) => tab.anyMusicProductWriter === undefined)).toBe(
      true,
    )
    fixture.onTabs = undefined
    await (await realm('three')).createGmProductStorage()
  })

  it('refuses an inventory that omits its own acknowledged registration', async () => {
    fixture.onTabs = (resolve) => resolve({})
    await expect((await realm('one')).createGmProductStorage()).rejects.toThrow('Unable to confirm')
    expect(fixture.reads).toEqual([])
    expect(fixture.writes).toEqual([])
    expect(fixture.tabs.get('one')).not.toHaveProperty('anyMusicProductWriter')
  })

  it('cancels pending initialization when the page exits before inventory completion', async () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    try {
      let resolveInventory: ((tabs: Record<string, Record<string, unknown>>) => void) | undefined
      fixture.onTabs = (resolve) => {
        resolveInventory = resolve
      }
      const pending = (await realm('one')).createGmProductStorage()
      const rejected = expect(pending).rejects.toThrow('initialization was replaced')
      await vi.waitFor(() => expect(resolveInventory).toBeDefined())
      target.dispatchEvent(new Event('pagehide'))
      resolveInventory!(clone(Object.fromEntries(fixture.tabs)))
      await rejected
      expect(fixture.reads).toEqual([])
      expect(fixture.writes).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('retains suspended owners and recovers automatically after their tabs close', async () => {
    await (await realm('one')).createGmProductStorage()
    await expect((await realm('two')).createGmProductStorage()).rejects.toThrow('另一个标签页')
    fixture.tabs.delete('one')
    await (await realm('two')).createGmProductStorage()
    expect(fixture.values.get(POINTER)).toMatchObject({ sequence: 1 })
  })

  it('freezes old instances before reconfiguration and does not let late disposal erase the new owner', async () => {
    const module = await realm('one')
    const old = await module.createGmProductStorage()
    const pending = module.createGmProductStorage()
    expect(() => old.write('ui-theme:v1', {})).toThrow('session changed')
    const current = await pending
    await old.dispose()
    expect(fixture.tabs.get('one')).toHaveProperty('anyMusicProductWriter')
    current.write('ui-theme:v1', { themeId: 'studio' })
    await current.flush()
    expect(current.read('ui-theme:v1')).toEqual({ themeId: 'studio' })
  })

  it('freezes pagehide/BFCache writers before another tab can acquire the session', async () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    try {
      const storage = await (await realm('one')).createGmProductStorage()
      target.dispatchEvent(new Event('pagehide'))
      expect(() => storage.write('ui-theme:v1', {})).toThrow('session changed')
      await storage.dispose()
      await (await realm('two')).createGmProductStorage()
      expect(() => storage.write('ui-theme:v1', {})).toThrow('session changed')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('drains acknowledged writes before releasing ownership', async () => {
    const storage = await (await realm('one')).createGmProductStorage()
    let resume: (() => void) | undefined
    fixture.beforeWrite = () =>
      new Promise<void>((resolve) => {
        resume = resolve
      })
    storage.write('ui-theme:v1', { themeId: 'studio' })
    const disposing = storage.dispose()
    await vi.waitFor(() => expect(resume).toBeDefined())
    expect(() => storage.write('ui-theme:v1', {})).toThrow('session changed')
    await expect((await realm('two')).createGmProductStorage()).rejects.toThrow('另一个标签页')
    fixture.beforeWrite = undefined
    resume!()
    await disposing
    expect((await (await realm('two')).createGmProductStorage()).read('ui-theme:v1')).toEqual({
      themeId: 'studio',
    })
  })

  it('keeps each queued generation isolated from later saves and caller mutations', async () => {
    const storage = await (await realm('one')).createGmProductStorage()
    const durableBefore = clone(fixture.values.get(POINTER))
    let resume: (() => void) | undefined
    fixture.beforeWrite = () =>
      new Promise<void>((resolve) => {
        resume = resolve
      })
    const first = { themeId: 'studio' }
    storage.write('ui-theme:v1', first)
    first.themeId = 'caller-mutated'
    const firstRead = storage.read<typeof first>('ui-theme:v1')!
    firstRead.themeId = 'read-mutated'
    const firstSnapshot = storage.snapshot()
    firstSnapshot.host.theme = { themeId: 'snapshot-mutated' }
    await vi.waitFor(() => expect(resume).toBeDefined())

    const second = { themeId: 'default' }
    storage.write('ui-theme:v1', second)
    second.themeId = 'later-caller-mutated'
    expect(storage.read('ui-theme:v1')).toEqual({ themeId: 'default' })
    expect(fixture.values.get(POINTER)).toEqual(durableBefore)
    const published: unknown[] = []
    fixture.afterWrite = (key) => {
      if (key !== POINTER) return
      const commit = fixture.values.get(POINTER) as { slot: number; id: string }
      const host = fixture.values.get(
        `any-music:userscript:product-data:g${commit.slot}:${commit.id}:host`,
      ) as { theme: unknown }
      published.push(clone(host.theme))
    }
    fixture.beforeWrite = undefined
    resume!()
    await storage.flush()
    expect(published).toEqual([{ themeId: 'studio' }, { themeId: 'default' }])
    fixture.afterWrite = undefined
    await storage.dispose()
    const restored = await (await realm('two')).createGmProductStorage()
    expect(restored.read('ui-theme:v1')).toEqual({ themeId: 'default' })
    await restored.dispose()
  })

  it('preserves failed registration and requires that tab to close if release cannot persist', async () => {
    const storage = await (await realm('one')).createGmProductStorage()
    fixture.failTabSave = true
    await expect(storage.dispose()).rejects.toThrow('Tab registration failed')
    expect(() => storage.write('ui-theme:v1', {})).toThrow('session changed')
    fixture.failTabSave = false
    await expect((await realm('two')).createGmProductStorage()).rejects.toThrow('另一个标签页')
    fixture.tabs.delete('one')
    await (await realm('two')).createGmProductStorage()
  })

  it.each([false, true])(
    'recovers every acknowledged GM write failure, persisted-before-error=%s',
    async (persistFirst) => {
      const initial = await (await realm('seed')).createGmProductStorage()
      const baseline = clone([...fixture.values])
      const before = initial.snapshot()
      const revision = initial.revision()
      initial.write('ui-theme:v1', { themeId: 'studio' })
      await initial.flush()
      const after = initial.snapshot()
      await initial.dispose()
      fixture.values.clear()
      baseline.forEach(([key, value]) => fixture.values.set(key, clone(value)))
      fixture.tabs.clear()
      const probe = await (await realm('probe')).createGmProductStorage()
      fixture.writes.length = 0
      probe.write('ui-theme:v1', { themeId: 'default' })
      await probe.flush()
      const points = fixture.writes.length
      await probe.dispose()
      for (let point = 1; point <= points; point++) {
        fixture.values.clear()
        baseline.forEach(([key, value]) => fixture.values.set(key, clone(value)))
        fixture.tabs.clear()
        // eslint-disable-next-line no-await-in-loop
        const storage = await (await realm('one')).createGmProductStorage()
        let count = 0
        const fail = () => {
          if (++count === point) throw new Error('GM power loss')
        }
        if (persistFirst) fixture.afterWrite = fail
        else fixture.beforeWrite = fail
        storage.write('ui-theme:v1', { themeId: 'studio' })
        // eslint-disable-next-line no-await-in-loop
        await expect(storage.flush()).rejects.toThrow('GM power loss')
        expect(() => storage.write('ui-theme:v1', {})).toThrow('persistence failed')
        fixture.beforeWrite = fixture.afterWrite = undefined
        // eslint-disable-next-line no-await-in-loop
        await storage.dispose().catch(() => {})
        // eslint-disable-next-line no-await-in-loop
        const restored = await (await realm('two')).createGmProductStorage()
        expect(restored.snapshot()).toEqual(restored.revision() === revision ? before : after)
        // eslint-disable-next-line no-await-in-loop
        await restored.dispose()
      }
    },
  )
})

vi.mock('../../src/features/plugins/built-in-themes', () => ({
  builtInThemes: {},
  protectedStyles: 'host-css',
}))
