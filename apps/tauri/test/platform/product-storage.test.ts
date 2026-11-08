import {
  createProductGenerationStorage,
  loadProductGeneration,
} from '@any-music/music-workbench/storage'
import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createProductStorage } from '../../src/platform/product-storage'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const KEY = 'any-music:tauri:product:v2'
let local: Map<string, string>
let native: unknown
let nativeWrites: unknown[]
let localCount: number
let nativeCount: number
let localFail: number
let nativeFail: number
let persistFirst: boolean
let beforeLocalWrite: ((value: string) => void) | undefined
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}
function sorted(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(sorted)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sorted(item)]),
        )
      : value
}

describe('S06 desktop generation mirrors', () => {
  beforeEach(() => {
    local = new Map()
    const values: Record<string, unknown> = {}
    const storage = createProductGenerationStorage(
      {
        withExclusiveWrite: (operation) => operation(),
        read: <T>(key: string, fallback?: T) => (values[key] as T | undefined) ?? fallback,
        write: (key, value) => {
          values[key] = clone(value)
        },
        remove: (key) => {
          delete values[key]
        },
      },
      { runtime: 'tauri' },
    )
    const library = storage.read<Record<string, unknown>>('local-library:v1')!
    storage.write('local-library:v1', {
      ...library,
      profile: { id: 'stable-id', displayName: 'Fixture' },
    })
    native = { schemaVersion: 2, revision: 1, values }
    nativeWrites = []
    localCount = nativeCount = 0
    localFail = nativeFail = Infinity
    persistFirst = false
    beforeLocalWrite = undefined
    vi.stubGlobal('window', { dispatchEvent: vi.fn() })
    vi.stubGlobal(
      'CustomEvent',
      class {
        readonly type: string
        constructor(type: string) {
          this.type = type
        }
      },
    )
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem(key: string, value: string) {
        beforeLocalWrite?.(value)
        localCount++
        if (localCount === localFail && !persistFirst) throw new Error('Local power loss')
        local.set(key, value)
        if (localCount === localFail && persistFirst) throw new Error('Local power loss')
      },
    })
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'load_product_data') return clone(native)
      nativeCount++
      if (nativeCount === nativeFail && !persistFirst) throw new Error('Native power loss')
      native = clone((args as { value: unknown }).value)
      nativeWrites.push(native)
      if (nativeCount === nativeFail && persistFirst) throw new Error('Native power loss')
      return undefined
    })
  })
  it('commits the same generation to renderer and native before returning storage', async () => {
    const store = await createProductStorage()
    expect(store.read('local-library:v1')).toMatchObject({ profile: { id: 'stable-id' } })
    expect(JSON.parse(local.get(KEY)!)).toEqual(native)
    expect(nativeWrites).not.toHaveLength(0)
    store.write('ui-theme:v1', { themeId: 'studio', settingsByTheme: {} })
    await vi.waitFor(() => expect(JSON.parse(local.get(KEY)!)).toEqual(native))
  })
  it('isolates queued native generations from later saves and caller mutations', async () => {
    const store = await createProductStorage()
    nativeWrites = []
    let resume: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      resume = resolve
    })
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'load_product_data') return clone(native)
      await blocked
      native = clone((args as { value: unknown }).value)
      nativeWrites.push(native)
      return undefined
    })
    const first = { themeId: 'studio', settingsByTheme: { studio: { density: 'compact' } } }
    const second = { themeId: 'default', settingsByTheme: { default: { density: 'comfortable' } } }
    const expectedFirst = clone(first)
    const expectedSecond = clone(second)
    try {
      store.write('ui-theme:v1', first)
      first.themeId = 'mutated-input'
      first.settingsByTheme.studio.density = 'mutated-input'
      const read = store.read<typeof first>('ui-theme:v1')!
      read.settingsByTheme.studio.density = 'mutated-read'
      store.write('ui-theme:v1', second)
      second.settingsByTheme.default.density = 'mutated-second-input'
    } finally {
      resume!()
    }
    await vi.waitFor(() => expect(native).toEqual(JSON.parse(local.get(KEY)!)))
    const publishedThemes = nativeWrites.map((snapshot) => {
      const { values } = snapshot as { values: Record<string, unknown> }
      return loadProductGeneration({
        read: <T>(key: string, fallback?: T) => (values[key] as T | undefined) ?? fallback,
        write: () => {
          throw new Error('Read only')
        },
      })!.data.host.theme
    })
    // Every intermediate native mirror must still describe a complete immutable generation.
    expect(publishedThemes).toContainEqual(expectedFirst)
    expect(publishedThemes.at(-1)).toEqual(expectedSecond)
    for (const theme of publishedThemes.filter((value) => value !== undefined))
      expect([expectedFirst, expectedSecond]).toContainEqual(theme)
    expect((await createProductStorage()).read('ui-theme:v1')).toEqual(expectedSecond)
  })
  it('reclaims abandoned staging generations before a bounded mirror can block downloads and source preferences', async () => {
    const snapshot = native as {
      schemaVersion: number
      revision: number
      values: Record<string, unknown>
    }
    const liveKeys = Object.keys(snapshot.values)
    snapshot.values['product-data:g0:abandoned:host'] = { draft: 'x'.repeat(120_000) }
    snapshot.values['product-data:g1:abandoned:core'] = { draft: 'y'.repeat(120_000) }
    snapshot.values['product-data:unrelated'] = { preserved: true }
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (value.length > 100_000)
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      local.set(key, value)
    })
    const storage = await createProductStorage()
    const recovered = JSON.parse(local.get(KEY)!).values
    for (const key of liveKeys) expect(recovered[key]).toEqual(snapshot.values[key])
    expect(recovered['product-data:g0:abandoned:host']).toBeUndefined()
    expect(recovered['product-data:g1:abandoned:core']).toBeUndefined()
    expect(recovered['product-data:unrelated']).toEqual({ preserved: true })
    storage.write('music-source-workspace:v1', {
      schemaVersion: 1,
      activePluginId: 'bilibili',
      disabledPluginIds: [],
      drawers: [],
    })
    storage.write('download-history:v1', { schemaVersion: 2, batches: [] })
    await vi.waitFor(() => expect(JSON.parse(local.get(KEY)!)).toEqual(native))
    const restored = await createProductStorage()
    expect(restored.read('music-source-workspace:v1')).toMatchObject({ activePluginId: 'bilibili' })
    expect(setItem).toHaveBeenCalled()
    setItem.mockRestore()
  })
  it.each([false, true])(
    'recovers every renderer/native write point on restart (%s)',
    async (persist) => {
      const starting = clone(native)
      await createProductStorage()
      const localPoints = localCount
      const nativePoints = nativeCount
      for (const channel of ['local', 'native'] as const) {
        const total = channel === 'local' ? localPoints : nativePoints
        for (let point = 1; point <= total; point++) {
          local.clear()
          native = clone(starting)
          localCount = nativeCount = 0
          localFail = channel === 'local' ? point : Infinity
          nativeFail = channel === 'native' ? point : Infinity
          persistFirst = persist
          // Fault points share the simulated durable disk and must execute in crash order.
          // eslint-disable-next-line no-await-in-loop
          await expect(createProductStorage()).rejects.toThrow('power loss')
          localFail = nativeFail = Infinity
          // eslint-disable-next-line no-await-in-loop
          const restored = await createProductStorage()
          expect(restored.read('local-library:v1')).toMatchObject({ profile: { id: 'stable-id' } })
          expect(JSON.parse(local.get(KEY)!)).toEqual(native)
        }
      }
    },
  )
  it('refuses future envelopes or generations without overwriting either mirror', async () => {
    await createProductStorage()
    const before = local.get(KEY)
    native = { schemaVersion: 3, values: {} }
    const writes = nativeWrites.length
    await expect(createProductStorage()).rejects.toThrow('newer')
    expect(local.get(KEY)).toBe(before)
    expect(nativeWrites).toHaveLength(writes)
    native = JSON.parse(before!)
    ;(native as { values: Record<string, unknown> }).values['product-data:commit'] = {
      schemaVersion: 99,
    }
    await expect(createProductStorage()).rejects.toThrow('Unsupported')
    expect(nativeWrites).toHaveLength(writes)
  })
  it('recovers a damaged local JSON mirror from the complete native generation', async () => {
    await createProductStorage()
    local.set(KEY, 'broken')
    expect((await createProductStorage()).read('local-library:v1')).toMatchObject({
      profile: { id: 'stable-id' },
    })
    expect(JSON.parse(local.get(KEY)!)).toEqual(native)
  })
  it('restores the latest native generation after native key reordering and WebView mirror loss', async () => {
    const storage = await createProductStorage()
    storage.write('module-recovery:v1', {
      disableOptional: false,
      disabledModuleIds: ['feature.tags'],
    })
    await vi.waitFor(() => expect(JSON.parse(local.get(KEY)!)).toEqual(native))
    native = sorted(native)
    local.delete(KEY)
    const restored = await createProductStorage()
    expect(restored.read('module-recovery:v1')).toEqual({
      disableOptional: false,
      disabledModuleIds: ['feature.tags'],
    })
    expect(JSON.parse(local.get(KEY)!)).toEqual(native)
  })
  it('retains failed snapshots and refuses writes after native persistence failure', async () => {
    const storage = await createProductStorage()
    nativeFail = nativeCount + 1
    storage.write('ui-theme:v1', { themeId: 'studio', settingsByTheme: {} })
    await vi.waitFor(() => expect(window.dispatchEvent).toHaveBeenCalled())
    expect(() => storage.write('ui-theme:v1', {})).toThrow('Native mirror failed')
    nativeFail = Infinity
    expect((await createProductStorage()).read('ui-theme:v1')).toMatchObject({ themeId: 'studio' })
  })
  it('rejects an older renderer storage instance without replacing the current mirror', async () => {
    const stale = await createProductStorage()
    const current = await createProductStorage()
    current.write('ui-theme:v1', { themeId: 'studio' })
    await vi.waitFor(() => expect(JSON.parse(local.get(KEY)!)).toEqual(native))
    const before = local.get(KEY)
    expect(() =>
      stale.write('playback-queue:v1', { schemaVersion: 1, trackIds: [], mode: 'repeat-one' }),
    ).toThrow('mirror changed')
    expect(local.get(KEY)).toBe(before)
    expect((await createProductStorage()).read('ui-theme:v1')).toEqual({ themeId: 'studio' })
  })
  it('prevents reentry at final pointer publication and retains the saved generation', async () => {
    const storage = await createProductStorage()
    const pointer = JSON.parse(local.get(KEY)!).values['product-data:commit'].id
    let interleaved = false
    beforeLocalWrite = (text) => {
      if (!interleaved && JSON.parse(text).values['product-data:commit'].id !== pointer) {
        interleaved = true
        expect(() => storage.write('ui-theme:v1', { themeId: 'studio' })).toThrow('busy')
      }
    }
    storage.write('playback-queue:v1', { schemaVersion: 1, trackIds: [], mode: 'repeat-one' })
    beforeLocalWrite = undefined
    expect(interleaved).toBe(true)
    await vi.waitFor(() => expect(JSON.parse(local.get(KEY)!)).toEqual(native))
    expect((await createProductStorage()).read('playback-queue:v1')).toMatchObject({
      mode: 'repeat-one',
    })
  })
})
