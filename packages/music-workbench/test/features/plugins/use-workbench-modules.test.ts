import { createAppErrorState } from '@any-music/core'
import { createMusicCreationModule } from '@any-music/plugin-music-creation'
import { createTagManagementModule } from '@any-music/plugin-tag-management'
import type { ProductViewId } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useWorkbenchModules } from '../../../src/features/plugins/use-workbench-modules'
import {
  createExternalSourcesModule,
  createWorkbenchModuleDirectory,
} from '../../../src/plugin-adapters/workbench-module-directory'
import type { WorkbenchRuntime } from '../../../src/runtime/workbench-runtime'

function fixture(runtimeId: 'userscript' | 'tauri' = 'tauri') {
  const values = new Map<string, unknown>()
  const runtime = {
    storage: {
      read: (key: string) => values.get(key),
      write: (key: string, value: unknown) => {
        values.set(key, value)
      },
    },
    modules: {
      runtime: runtimeId,
      features: [createTagManagementModule(runtimeId), createMusicCreationModule(runtimeId)],
      form: 'desktop',
      directory: createWorkbenchModuleDirectory(runtimeId, [
        createTagManagementModule(runtimeId),
        createMusicCreationModule(runtimeId),
      ]),
    },
  } as unknown as WorkbenchRuntime
  const ports = {
    navigation: {
      selectView: vi.fn(),
      currentView: (): ProductViewId => 'catalog',
      revision: () => 1,
    },
    interaction: { hasUserGesture: () => false },
    library: { getSummary: () => ({ trackCount: 0, playlistCount: 0 }) },
    playback: { stop: vi.fn() },
    downloads: { cancelActiveBatch: vi.fn() },
  }
  return { values, runtime, ports }
}

describe('independent module recovery startup', () => {
  it.each(['userscript', 'tauri'] as const)(
    'keeps developing creation disabled from startup on %s, including retries and safe startup',
    async (runtime) => {
      const f = fixture()
      const features = [createTagManagementModule(runtime), createMusicCreationModule(runtime)]
      f.runtime.modules = {
        runtime,
        form: 'desktop',
        features,
        directory: createWorkbenchModuleDirectory(runtime, features),
      }
      const scope = effectScope()
      const modules = scope.run(() => useWorkbenchModules(f.runtime, f.ports))!
      try {
        await modules.ready
        expect(modules.getDevelopmentStatus('feature.composer')).toBe('developing')
        expect(modules.getDevelopmentStatus('feature.tags')).toBeUndefined()
        expect(modules.getDevelopmentStatus('unknown')).toBeUndefined()
        expect(modules.getUnavailableReason('feature.composer')).toContain('开发中')
        expect(modules.isEnabled('feature.composer')).toBe(false)
        await modules.setEnabled('feature.composer', true)
        expect(modules.failure.value).toBeUndefined()
        await modules.retry()
        await modules.safeStart()
        expect(modules.getDevelopmentStatus('feature.composer')).toBe('developing')
        expect(modules.isEnabled('feature.composer')).toBe(false)
        expect(modules.canOpenView('composer')).toBe(false)
        expect(modules.canOpenView('custom-tracks')).toBe(false)
      } finally {
        scope.stop()
      }
    },
  )
  it.each(['userscript', 'tauri'] as const)(
    'projects single-song and batch tag choices on %s and keeps additions behind the current contribution',
    async (runtimeId) => {
      const f = fixture(runtimeId)
      const tracks = [
        {
          id: 'song',
          title: 'Song',
          artists: [],
          source: { pluginId: 'source', resourceId: 'song', mediaKind: 'audio' as const },
        },
      ]
      const tagInputOptions = vi.fn(() => [{ value: '通勤', selected: false }])
      const addTags = vi.fn()
      const scope = effectScope()
      const modules = scope.run(() =>
        useWorkbenchModules(f.runtime, {
          ...f.ports,
          interaction: { hasUserGesture: () => true },
          optionalFeatures: { isUsable: () => true, tagInputOptions, addTags },
        }),
      )!
      try {
        await modules.ready
        const context = { selectionCount: 1, selectedTracks: tracks }
        const item = modules.contributions.resolve('trackList.operator.actions', context)[0]!
        expect(item.inputOptions).toEqual([{ value: '通勤', selected: false }])
        expect(tagInputOptions).toHaveBeenLastCalledWith(tracks)
        const singleContext = { ...context, hasTrack: true }
        const manageTags = modules.contributions
          .resolve('track.actions.secondary', singleContext)
          .find((entry) => entry.implementationId === 'manage-tags')!
        expect(manageTags.inputOptions).toEqual([{ value: '通勤', selected: false }])
        expect(tagInputOptions).toHaveBeenLastCalledWith(tracks)
        modules.contributions.invoke!(item, 'trackList.operator.actions', context, '通勤')
        expect(addTags).toHaveBeenCalledWith(tracks, '通勤')
        await modules.setEnabled('feature.tags', false)
        modules.contributions.invoke!(item, 'trackList.operator.actions', context, '夜晚')
        expect(addTags).toHaveBeenCalledOnce()
        expect(modules.contributions.resolve('trackList.operator.actions', context)).toEqual([])
        expect(
          modules.contributions.resolve('track.actions.secondary', singleContext),
        ).not.toContainEqual(expect.objectContaining({ implementationId: 'manage-tags' }))
      } finally {
        scope.stop()
      }
    },
  )
  it('persists the external sources switch and keeps safe startup from re-enabling it', async () => {
    const value = fixture()
    const features = [...value.runtime.modules!.features!, createExternalSourcesModule('tauri')]
    value.runtime.modules!.features = features
    value.runtime.modules!.directory = createWorkbenchModuleDirectory('tauri', features)
    const firstScope = effectScope()
    const first = firstScope.run(() => useWorkbenchModules(value.runtime, value.ports))!
    await first.ready
    expect(first.isEnabled('feature.external-sources')).toBe(true)
    await first.setEnabled('feature.external-sources', false)
    firstScope.stop()
    const nextScope = effectScope()
    const next = nextScope.run(() => useWorkbenchModules(value.runtime, value.ports))!
    await next.ready
    expect(next.isEnabled('feature.external-sources')).toBe(false)
    await next.setEnabled('feature.external-sources', true)
    expect(next.isEnabled('feature.external-sources')).toBe(true)
    await next.safeStart()
    expect(next.isEnabled('feature.external-sources')).toBe(false)
    nextScope.stop()
  })
  it.each(['custom-tracks', 'composer'] as const)(
    'withdraws both creation sections when disabled from %s and restores them together',
    async (view) => {
      const value = fixture()
      // Exercise lifecycle withdrawal with a future build that admits the implementation.
      const features = value.runtime.modules!.features!.map((descriptor) =>
        Object.assign({}, descriptor, { unavailableReason: undefined }),
      )
      value.runtime.modules!.features = features
      value.runtime.modules!.directory = createWorkbenchModuleDirectory('tauri', features)
      value.ports.navigation.currentView = () => view
      const scope = effectScope()
      const modules = scope.run(() => useWorkbenchModules(value.runtime, value.ports))!
      await modules.ready
      const creationViews = () =>
        modules.resolveViews().filter((entry) => entry.id.startsWith('feature.composer/'))
      for (const id of ['custom-tracks', 'composer'] as const)
        expect(modules.canOpenView(id)).toBe(true)
      expect(creationViews()).toHaveLength(2)
      await modules.setEnabled('feature.composer', false)
      for (const id of ['custom-tracks', 'composer'] as const)
        expect(modules.canOpenView(id)).toBe(false)
      expect(creationViews()).toEqual([])
      expect(value.ports.navigation.selectView).toHaveBeenCalledExactlyOnceWith('catalog')
      expect(value.ports.playback.stop).not.toHaveBeenCalled()
      expect(value.ports.downloads.cancelActiveBatch).not.toHaveBeenCalled()
      scope.stop()

      const restoredScope = effectScope()
      const restored = restoredScope.run(() => useWorkbenchModules(value.runtime, value.ports))!
      await restored.ready
      for (const id of ['custom-tracks', 'composer'] as const)
        expect(restored.canOpenView(id)).toBe(false)
      await restored.setEnabled('feature.composer', true)
      for (const id of ['custom-tracks', 'composer'] as const)
        expect(restored.canOpenView(id)).toBe(true)
      expect(
        restored.resolveViews().filter((entry) => entry.id.startsWith('feature.composer/')),
      ).toHaveLength(2)
      restoredScope.stop()
    },
  )
  it('keeps creation destinations closed when their plugin is not injected', async () => {
    const value = fixture()
    value.runtime.modules!.features = []
    value.runtime.modules!.directory = createWorkbenchModuleDirectory('tauri')
    const scope = effectScope()
    const modules = scope.run(() => useWorkbenchModules(value.runtime, value.ports))!
    await modules.ready
    for (const view of ['custom-tracks', 'composer'] as const)
      expect(modules.canOpenView(view)).toBe(false)
    expect(modules.canOpenView('playlists')).toBe(true)
    scope.stop()
  })
  it('withdraws every source contribution while keeping core destinations and services accessible', async () => {
    const value = fixture()
    const features = ['one', 'two'].map((id) => ({
      id: `source.${id}`,
      name: id,
      version: 1,
      installationId: `tauri:${id}`,
      contentHash: `build:${id}`,
      required: false,
      provides: [],
      requires: [{ id: 'host.sources', version: 1 }],
      optional: [],
      contributions: [
        {
          localId: 'provider',
          pointId: 'music.sources',
          contractVersion: 1,
          inputSchema: 'music-source-context.v1',
          eventSchema: 'music-source-result.v1',
          implementation: 'declarative' as const,
          implementationId: id,
          group: 'source',
          order: 0,
        },
      ],
    }))
    const allFeatures = [...value.runtime.modules!.features!, ...features]
    value.runtime.modules!.features = allFeatures
    value.runtime.modules!.directory = createWorkbenchModuleDirectory('tauri', allFeatures)
    const scope = effectScope()
    const modules = scope.run(() => useWorkbenchModules(value.runtime, value.ports))!
    await modules.ready
    expect(modules.isSourceEnabled('one')).toBe(true)
    await modules.setSourceEnabled('one', false)
    await modules.setSourceEnabled('two', false)
    expect(modules.isSourceEnabled('one')).toBe(false)
    expect(modules.isSourceEnabled('two')).toBe(false)
    for (const view of ['favorites', 'playlists', 'plugins'] as const)
      expect(modules.canOpenView(view)).toBe(true)
    expect(modules.canOpenView('custom-tracks')).toBe(false)
    expect(modules.needsRecovery.value).toBe(false)
    expect(value.ports.playback.stop).not.toHaveBeenCalled()
    expect(value.ports.downloads.cancelActiveBatch).not.toHaveBeenCalled()
    await modules.setSourceEnabled('one', true)
    expect(modules.isSourceEnabled('one')).toBe(true)
    scope.stop()
  })
  it('ignores malformed optional-module preferences without blocking core startup', async () => {
    const value = fixture()
    value.values.set('module-recovery:v1', { disableOptional: false, disabledModuleIds: {} })
    const scope = effectScope()
    const modules = scope.run(() => useWorkbenchModules(value.runtime, value.ports))!
    await modules.ready
    expect(modules.failure.value).toBeUndefined()
    expect(modules.canOpenView('playlists')).toBe(true)
    expect(modules.isEnabled('feature.tags')).toBe(true)
    scope.stop()
  })
  it('reports preference write failure after retaining the immediate disable barrier', async () => {
    const value = fixture()
    const scope = effectScope()
    const modules = scope.run(() => useWorkbenchModules(value.runtime, value.ports))!
    await modules.ready
    value.runtime.storage.write = () => {
      throw new Error('disk full')
    }
    await modules.setEnabled('feature.tags', false)
    expect(modules.isEnabled('feature.tags')).toBe(false)
    expect(modules.needsRecovery.value).toBe(true)
    expect(value.ports.playback.stop).not.toHaveBeenCalled()
    scope.stop()
  })
  it('allocates trusted themes through the host and rejects stale contribution/view contexts', async () => {
    const value = fixture()
    let viewRevision = 1
    value.ports.navigation.revision = () => viewRevision
    const scope = effectScope()
    const modules = scope.run(() => useWorkbenchModules(value.runtime, value.ports))!
    await modules.ready
    const item = modules.contributions.resolve('trackList.operator.actions', {
      selectionCount: 2,
    })[0]!
    expect(
      modules.contributions.accepts(item, 'trackList.operator.actions', { selectionCount: 2 }),
    ).toBe(true)
    expect(
      modules.contributions.accepts(item, 'trackList.operator.actions', { selectionCount: 3 }),
    ).toBe(false)
    viewRevision++
    expect(
      modules.contributions.accepts(item, 'trackList.operator.actions', { selectionCount: 2 }),
    ).toBe(false)
    const theme = await modules.prepareTheme('studio')
    expect(theme.slots['theme.root']).toEqual(['theme.studio/root'])
    expect(value.ports.playback.stop).not.toHaveBeenCalled()
    expect(value.ports.downloads.cancelActiveBatch).not.toHaveBeenCalled()
    await modules.safeStart()
    await expect(modules.prepareTheme('studio')).rejects.toThrow()
    expect((await modules.prepareTheme('default')).slots['theme.root']).toEqual([
      'theme.default/root',
    ])
    scope.stop()
  })
  it('opens recovery for a previous failure and safe-starts with optional modules disabled', async () => {
    const fixtureValue = fixture()
    fixtureValue.values.set('module-recovery:v1', {
      disableOptional: false,
      lastFailure: {
        moduleIds: ['core'],
        error: createAppErrorState('invariant-violation', 'previous failure'),
      },
    })
    fixtureValue.values.set('app-shell:v1', {
      theme: 'dark',
      destinationOrder: ['playlists', 'catalog'],
      hiddenDestinationIds: ['history'],
    })
    fixtureValue.values.set('local-library:v1', { tracks: ['kept'] })
    const restoreTheme = vi.fn()
    const scope = effectScope()
    const modules = scope.run(() =>
      useWorkbenchModules(fixtureValue.runtime, fixtureValue.ports, restoreTheme),
    )!
    await modules.ready
    expect(modules.failure.value).toMatchObject({ message: 'previous failure' })
    await modules.safeStart()
    expect(modules.failure.value).toBeUndefined()
    expect(modules.canOpenView('composer')).toBe(false)
    expect(modules.canOpenView('custom-tracks')).toBe(false)
    expect(modules.canOpenView('tags')).toBe(false)
    expect(modules.canOpenView('playlists')).toBe(true)
    expect(fixtureValue.values.get('app-shell:v1')).toEqual({
      theme: 'system',
      destinationOrder: ['playlists', 'catalog'],
      hiddenDestinationIds: ['history'],
    })
    expect(fixtureValue.values.get('local-library:v1')).toEqual({ tracks: ['kept'] })
    expect(restoreTheme).toHaveBeenCalledTimes(1)
    modules.openRecovery()
    expect(modules.needsRecovery.value).toBe(true)
    await modules.retry()
    expect(modules.canOpenView('tags')).toBe(true)
    expect(modules.needsRecovery.value).toBe(false)
    scope.stop()
  })
  it('persists structured startup failures, retries repaired build descriptors and does not replay business operations', async () => {
    const fixtureValue = fixture()
    fixtureValue.runtime.modules!.directory = []
    const scope = effectScope()
    const modules = scope.run(() => useWorkbenchModules(fixtureValue.runtime, fixtureValue.ports))!
    await modules.ready
    expect(modules.failure.value?.code).toBe('invariant-violation')
    expect((await modules.prepareTheme('default')).slots['theme.root']).toEqual([
      'theme.default/root',
    ])
    expect(fixtureValue.values.get('module-recovery:v1')).toMatchObject({
      lastFailure: { error: { code: 'invariant-violation' } },
    })
    fixtureValue.runtime.modules!.directory = createWorkbenchModuleDirectory('tauri', [
      createTagManagementModule('tauri'),
      createMusicCreationModule('tauri'),
    ])
    await modules.retry()
    expect(modules.failure.value).toBeUndefined()
    expect(fixtureValue.ports.playback.stop).not.toHaveBeenCalled()
    expect(fixtureValue.ports.downloads.cancelActiveBatch).not.toHaveBeenCalled()
    scope.stop()
  })
})
