/* eslint-disable no-await-in-loop -- Observe transaction phases and cleanup in order. */
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import type {
  LoadedRootTheme,
  ThemeAllocation,
  ThemeResources,
} from '../../src/trusted/theme-contracts'
import { createThemeController } from '../../src/trusted/theme-controller'
import { THEME_ROOT_POINT } from '../../src/trusted/theme-directory'
import { rootComposition, rootTheme } from './root-theme-fixture'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
function allocation(id: string): ThemeAllocation {
  return {
    registryRevision: 1,
    lifecycleGeneration: 1,
    slots: Object.fromEntries([[THEME_ROOT_POINT, [`theme.${id}/root`]]]),
  }
}
function fixture(
  options: {
    load?: (id: string) => Promise<LoadedRootTheme>
    fallback?: LoadedRootTheme
    prepareAllocation?: (id: string) => Promise<ThemeAllocation>
    afterRender?: ThemeResources['afterRender']
  } = {},
) {
  const active = new Set<object>(),
    allocated = new Set<object>()
  const prepare = vi.fn(() => {
    const key = {}
    allocated.add(key)
    return {
      activate: () => {
        active.add(key)
      },
      deactivate: () => {
        active.delete(key)
      },
      dispose: () => {
        active.delete(key)
        allocated.delete(key)
      },
    }
  })
  const restore = vi.fn(),
    onFailure = vi.fn()
  const controller = createThemeController({
    composition: rootComposition(options.load, options.fallback),
    form: 'desktop',
    resources: {
      prepare,
      capture: () => restore,
      afterRender:
        options.afterRender ??
        ((cb) => {
          void nextTick(cb)
        }),
    },
    prepareAllocation: options.prepareAllocation,
    onFailure,
  })
  return { controller, active, allocated, prepare, restore, onFailure }
}
describe('complete-root transactions', () => {
  it.each(['new-selection', 'dispose', 'render-failure'])(
    'aborts pending semantic restoration on %s and waits for the current restoration',
    async (reason) => {
      const signals: AbortSignal[] = []
      const release = deferred<void>()
      const nextLoad = deferred<LoadedRootTheme>()
      let loads = 0
      const controller = createThemeController({
        composition: rootComposition(async (id) =>
          ++loads > 1 ? nextLoad.promise : rootTheme(id),
        ),
        form: 'desktop',
        resources: {
          prepare: () => ({ activate() {}, deactivate() {}, dispose() {} }),
          capture: (signal) => {
            signals.push(signal!)
            return () =>
              new Promise<void>((resolve) => {
                signal!.addEventListener('abort', () => resolve(), { once: true })
                void release.promise.then(resolve)
              })
          },
          afterRender: (restore) => {
            void nextTick(restore)
          },
        },
      })
      const first = controller.select('studio')
      let finished = false
      void first.then(() => {
        finished = true
      })
      await nextTick()
      await nextTick()
      await nextTick()
      expect(finished).toBe(false)
      expect(signals).toHaveLength(1)
      if (reason === 'new-selection') {
        const second = controller.select('default')
        expect(signals[0]!.aborted).toBe(true) // New loader is still pending.
        controller.dispose()
        nextLoad.resolve(rootTheme('default'))
        await second
      } else if (reason === 'dispose') controller.dispose()
      else controller.reportRenderFailure(controller.current.value.generation, new Error('render'))
      expect(signals[0]!.aborted).toBe(true)
      release.resolve()
      await first
      controller.dispose()
    },
  )
  it('admits an injected third complete theme through the same root slot and recovery path', async () => {
    const base = rootComposition()
    const paper = {
      ...rootTheme('studio'),
      definition: { ...rootTheme('studio').definition, id: 'paper' },
    }
    const load = vi.fn(async () => paper)
    const controller = createThemeController({
      composition: {
        ...base,
        themes: [
          ...base.themes,
          { descriptor: { ...base.themes[1]!.descriptor, id: 'paper', title: '纸页' }, load },
        ],
      },
      form: 'mobile',
      resources: {
        prepare: () => ({ activate() {}, deactivate() {}, dispose() {} }),
        capture: () => () => {},
        afterRender: (restore) => restore(),
      },
      prepareAllocation: async (id) => allocation(id),
    })
    expect(await controller.select('paper')).toBe(true)
    expect(controller.current.value.theme).toBe(paper)
    expect(controller.current.value.allocation?.slots).toEqual({
      'theme.root': ['theme.paper/root'],
    })
    controller.reportRenderFailure(controller.current.value.generation, new Error('paper render'))
    await vi.waitFor(() => expect(controller.current.value.theme.definition.id).toBe('default'))
    expect(controller.needsRecovery.value).toBe(false)
    expect(await controller.select('paper')).toBe(true)
    expect(load).toHaveBeenCalledTimes(2)
    controller.dispose()
  })
  it('uses the preloaded fallback when its matching registration fails to import', async () => {
    const value = fixture({
      load: async () => {
        throw new Error('default import failed')
      },
    })
    expect(await value.controller.select('default')).toBe(false)
    expect(value.controller.current.value.theme.definition.id).toBe('default')
    expect(value.controller.needsRecovery.value).toBe(false)
    expect(value.active.size).toBe(1)
    value.controller.dispose()
  })
  it('commits A → B → A as a single root/resource and preserves normalized settings', async () => {
    const value = fixture({ prepareAllocation: async (id) => allocation(id) })
    for (const id of ['default', 'studio', 'default']) {
      expect(await value.controller.select(id, { schemaVersion: 1, density: 'compact' })).toBe(true)
      expect(value.controller.current.value.theme.definition.id).toBe(id)
      expect(value.controller.current.value.settings.density).toBe('compact')
      expect(value.active.size).toBe(1)
      expect(value.allocated.size).toBe(1)
    }
    expect(value.restore).toHaveBeenCalledTimes(3)
    value.controller.dispose()
    expect(value.allocated.size).toBe(0)
  })
  it('rejects delayed A after B and skips stale imports, allocation and fallback failures', async () => {
    const slow = deferred<LoadedRootTheme>()
    const allocate = vi.fn(async (id: string) => allocation(id))
    const value = fixture({
      load: (id) => (id === 'default' ? slow.promise : Promise.resolve(rootTheme(id))),
      prepareAllocation: allocate,
    })
    const old = value.controller.select('default')
    expect(await value.controller.select('studio')).toBe(true)
    const committed = value.controller.current.value
    slow.reject(new Error('obsolete import'))
    expect(await old).toBe(false)
    expect(value.controller.current.value).toBe(committed)
    expect(allocate.mock.calls.map(([id]) => id)).toEqual(['studio'])
    expect(value.onFailure).not.toHaveBeenCalled()
    value.controller.dispose()
  })
  it.each(['import', 'coverage', 'activation', 'allocation', 'resource'])(
    'rolls back %s failure and retries the same loader',
    async (phase) => {
      let fail = true
      const cleanup = vi.fn()
      const load = vi.fn(async (id: string) => {
        if (id === 'studio' && fail && phase === 'import') throw new Error('import failed')
        const theme = rootTheme(id)
        if (id === 'studio' && fail && phase === 'coverage')
          return { ...theme, definition: { ...theme.definition, views: {} } } as LoadedRootTheme
        if (id === 'studio' && fail && phase === 'activation')
          return {
            ...theme,
            activate(defer: (cb: () => void) => void) {
              defer(cleanup)
              throw new Error('activation failed')
            },
          }
        return theme
      })
      const value = fixture({
        load,
        prepareAllocation: async (id) => {
          if (id === 'studio' && fail && phase === 'allocation')
            throw new Error('allocation failed')
          return allocation(id)
        },
      })
      if (phase === 'resource')
        value.prepare.mockImplementationOnce(() => {
          throw new Error('style failed')
        })
      expect(await value.controller.select('studio')).toBe(false)
      expect(value.controller.current.value.theme.definition.id).toBe('default')
      expect(value.active.size).toBe(1)
      expect(value.allocated.size).toBe(1)
      expect(value.controller.needsRecovery.value).toBe(false)
      if (phase === 'activation') expect(cleanup).toHaveBeenCalledOnce()
      fail = false
      expect(await value.controller.select('studio')).toBe(true)
      expect(load.mock.calls.filter(([id]) => id === 'studio')).toHaveLength(2)
      value.controller.dispose()
      expect(value.allocated.size).toBe(0)
    },
  )
  it('leaves a healthy root usable when fallback fails and exposes recovery when neither root works', async () => {
    const value = fixture({
      fallback: {
        ...rootTheme('default'),
        activate() {
          throw new Error('fallback failed')
        },
      },
    })
    expect(await value.controller.select('studio')).toBe(true)
    expect(await value.controller.select('unknown')).toBe(false)
    expect(value.controller.current.value.theme.definition.id).toBe('studio')
    expect(value.controller.needsRecovery.value).toBe(false)
    value.controller.reportRenderFailure(
      value.controller.current.value.generation,
      new Error('root failed'),
    )
    await nextTick()
    await nextTick()
    expect(value.controller.needsRecovery.value).toBe(true)
    expect(value.allocated.size).toBe(0)
    value.controller.dispose()
  })
  it('does not let a stale fallback replace a newer selection', async () => {
    const pending = deferred<ThemeAllocation>()
    const value = fixture({
      prepareAllocation: (id) =>
        id === 'default' ? pending.promise : Promise.resolve(allocation(id)),
    })
    const old = value.controller.select('unknown')
    await nextTick()
    expect(await value.controller.select('studio')).toBe(true)
    pending.reject(new Error('stale fallback allocation'))
    expect(await old).toBe(false)
    expect(value.controller.current.value.theme.definition.id).toBe('studio')
    expect(value.active.size).toBe(1)
    value.controller.dispose()
  })
  it('ignores retired render errors and does not recover over an already pending newer selection', async () => {
    const imported = deferred<LoadedRootTheme>()
    let delay = false
    const value = fixture({
      load: (id) => (delay ? imported.promise : Promise.resolve(rootTheme(id))),
    })
    await value.controller.select('studio')
    const retired = value.controller.current.value.generation
    await value.controller.select('default')
    value.controller.reportRenderFailure(retired, new Error('retired root'))
    expect(value.onFailure).not.toHaveBeenCalled()
    delay = true
    const pending = value.controller.select('studio')
    value.controller.reportRenderFailure(
      value.controller.current.value.generation,
      new Error('current root failed'),
    )
    expect(value.prepare).toHaveBeenCalledTimes(2)
    imported.resolve(rootTheme('studio'))
    expect(await pending).toBe(true)
    expect(value.controller.current.value.theme.definition.id).toBe('studio')
    expect(value.controller.needsRecovery.value).toBe(false)
    expect(value.active.size).toBe(1)
    value.controller.dispose()
  })
  it('settles rapid commits with reversed post-render cleanup and only restores the final root', async () => {
    const callbacks: (() => void)[] = []
    const value = fixture({
      afterRender: (callback) => {
        callbacks.push(callback)
      },
    })
    const selections: Promise<boolean>[] = []
    for (const id of ['default', 'studio', 'default']) {
      selections.push(value.controller.select(id))
      await nextTick()
      await nextTick()
    }
    callbacks.toReversed().forEach((callback) => callback())
    expect(await Promise.all(selections)).toEqual([false, false, true])
    expect(value.active.size).toBe(1)
    expect(value.allocated.size).toBe(1)
    expect(value.restore).toHaveBeenCalledOnce()
    value.controller.dispose()
  })
  it.each(['version', 'form', 'optional'])(
    'rejects incompatible %s before allocating or activating resources',
    async (invalid) => {
      const base = rootComposition()
      const load = vi.fn(async () => rootTheme('studio'))
      const allocate = vi.fn(async (id: string) => allocation(id))
      const controller = createThemeController({
        composition: {
          ...base,
          themes: base.themes.map((entry) =>
            entry.descriptor.id === 'default'
              ? entry
              : {
                  descriptor: {
                    ...entry.descriptor,
                    ...(invalid === 'version' ? { contractVersion: 9 as unknown as 1 } : {}),
                    ...(invalid === 'form' ? { forms: ['mobile'] as const } : {}),
                  },
                  load,
                },
          ),
        },
        form: 'desktop',
        resources: {
          prepare: () => ({ activate() {}, deactivate() {}, dispose() {} }),
          capture: () => () => {},
          afterRender: (cb) => cb(),
        },
        prepareAllocation: allocate,
        requiredOptionalViews: () => (invalid === 'optional' ? ['tags'] : []),
      })
      expect(await controller.select('studio')).toBe(false)
      expect(allocate.mock.calls.some(([id]) => id === 'studio')).toBe(false)
      expect(load).toHaveBeenCalledTimes(invalid === 'optional' ? 1 : 0)
      controller.dispose()
    },
  )
  it.each(['import', 'allocation', 'activation', 'render'])(
    'disposes during %s and releases queued resources without waiting for the renderer',
    async (phase) => {
      const imported = deferred<LoadedRootTheme>(),
        allocated = deferred<ThemeAllocation>()
      const callbacks: (() => void)[] = []
      const cleanup = vi.fn()
      const value = fixture({
        load: () =>
          phase === 'import'
            ? imported.promise
            : Promise.resolve({
                ...rootTheme('studio'),
                activate(defer) {
                  defer(cleanup)
                  if (phase === 'activation') value.controller.dispose()
                },
              }),
        prepareAllocation: () =>
          phase === 'allocation' ? allocated.promise : Promise.resolve(allocation('studio')),
        afterRender: (cb) => {
          callbacks.push(cb)
        },
      })
      const selected = value.controller.select('studio')
      await nextTick()
      await nextTick()
      await nextTick()
      value.controller.dispose()
      imported.resolve(rootTheme('studio'))
      allocated.resolve(allocation('studio'))
      expect(await selected).toBe(false)
      expect(value.allocated.size).toBe(0)
      for (const callback of callbacks) callback()
      expect(value.restore).not.toHaveBeenCalled()
      if (phase === 'activation' || phase === 'render') expect(cleanup).toHaveBeenCalledOnce()
    },
  )
  it('releases rapid commits immediately on disposal even when post-render callbacks never execute', async () => {
    const callbacks: (() => void)[] = []
    const value = fixture({
      afterRender: (cb) => {
        callbacks.push(cb)
      },
    })
    const selections: Promise<boolean>[] = []
    for (const id of ['default', 'studio', 'default']) {
      selections.push(value.controller.select(id))
      await nextTick()
      await nextTick()
    }
    expect(value.active.size).toBe(1)
    value.controller.dispose()
    expect(value.allocated.size).toBe(0)
    expect(await Promise.all(selections)).toEqual([false, false, false])
    callbacks.toReversed().forEach((callback) => callback())
    expect(value.restore).not.toHaveBeenCalled()
  })
})
