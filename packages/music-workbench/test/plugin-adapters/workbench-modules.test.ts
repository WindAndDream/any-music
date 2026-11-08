import { createMusicCreationModule } from '@any-music/plugin-music-creation'
import { createTagManagementModule } from '@any-music/plugin-tag-management'
import { BUILT_IN_UI_THEMES, THEME_ROOT_POINT } from '@any-music/plugin-ui-vue/directory'
import { descriptor as studioDescriptor } from '@any-music/theme-studio'
import { describe, expect, it, vi } from 'vitest'

import { createWorkbenchModuleDirectory } from '../../src/plugin-adapters/workbench-module-directory'
import { createWorkbenchModuleHost } from '../../src/plugin-adapters/workbench-modules'
import type { WorkbenchModulePorts } from '../../src/plugin-adapters/workbench-modules'

function ports() {
  return {
    navigation: { selectView: vi.fn(), currentView: () => 'catalog' as const, revision: () => 1 },
    interaction: { hasUserGesture: () => true },
    library: { getSummary: vi.fn(() => ({ trackCount: 3, playlistCount: 2 })) },
    playback: { stop: vi.fn() },
    downloads: { cancelActiveBatch: vi.fn() },
  } satisfies WorkbenchModulePorts
}

describe('built-in workbench business adapter', () => {
  it.each(['userscript', 'tauri'] as const)(
    'blocks developing plugin and theme activation at the module boundary on %s',
    async (runtime) => {
      const features = [createMusicCreationModule(runtime)]
      const themes = [BUILT_IN_UI_THEMES[0]!, studioDescriptor]
      const business = ports()
      const host = createWorkbenchModuleHost({
        runtime,
        form: 'desktop',
        features,
        themes,
        directory: createWorkbenchModuleDirectory(runtime, features, themes),
        ports: business,
        onRequiredFailure: vi.fn(),
      })
      await host.start()
      for (const id of ['feature.composer', 'theme.studio']) {
        expect(host.controller.states.get(id)).toMatchObject({
          enabled: false,
          activation: 'inactive',
        })
        expect(() => host.controller.setEnabled(id, true)).toThrow('module-unavailable')
      }
      await Promise.all(
        ['feature.composer', 'theme.studio'].map((id) =>
          expect(host.controller.activate([id])).rejects.toThrow(),
        ),
      )
      expect(business.navigation.selectView).not.toHaveBeenCalled()
      await host.dispose()
    },
  )
  it('allocates an app-injected third theme as one root while preserving semantic contributions', async () => {
    const themes = [
      ...BUILT_IN_UI_THEMES,
      { ...BUILT_IN_UI_THEMES[0]!, id: 'paper', title: '纸页' },
    ]
    const host = createWorkbenchModuleHost({
      runtime: 'tauri',
      form: 'mobile',
      themes,
      directory: createWorkbenchModuleDirectory('tauri', [], themes),
      ports: ports(),
      onRequiredFailure: vi.fn(),
    })
    await host.start()
    const input = {
      context: {
        runtime: 'tauri' as const,
        form: 'mobile' as const,
        area: 'catalog',
        hasTrack: false,
        selectionCount: 0,
      },
      themeMappings: { [THEME_ROOT_POINT]: 'theme.paper/root' },
    }
    const allocation = await host.controller.activate(['theme.paper'], input)
    expect(allocation.slots[THEME_ROOT_POINT]).toEqual(['theme.paper/root'])
    expect(allocation.slots['workspace.views']).toContain('system.library/view-favorites')
    expect(Object.keys(allocation.slots)).not.toEqual(
      expect.arrayContaining(['trackRow.renderer', 'trackList.renderer', 'navigation.renderer']),
    )
    await host.controller.setEnabled('theme.paper', false)
    await expect(host.controller.activate(['theme.paper'], input)).rejects.toThrow()
    await host.dispose()
  })
  it.each(['userscript', 'tauri'] as const)(
    'adapts existing named ports on %s without reconstructing controllers',
    async (runtime) => {
      const business = ports()
      const directory = createWorkbenchModuleDirectory(runtime, [
        createTagManagementModule(runtime),
        createMusicCreationModule(runtime),
      ])
      const host = createWorkbenchModuleHost({
        runtime,
        features: [createTagManagementModule(runtime), createMusicCreationModule(runtime)],
        form: 'desktop',
        directory: directory.toReversed(),
        ports: business,
        onRequiredFailure: vi.fn(),
      })
      await host.start()
      expect(business.playback.stop).not.toHaveBeenCalled()
      const expected = { objectRevision: 1, viewRevision: 1 }
      await host.controller.executeCommand('system.playback/stop-playback', expected)
      await host.controller.executeCommand('system.downloads/cancel-downloads', expected)
      await host.controller.executeCommand('system.library/open-playlists', expected)
      expect(
        await host.controller.executeCommand('system.library/library-summary', expected),
      ).toEqual({ trackCount: 3, playlistCount: 2 })
      expect(business.playback.stop).toHaveBeenCalledTimes(1)
      expect(business.downloads.cancelActiveBatch).toHaveBeenCalledTimes(1)
      expect(business.navigation.selectView).toHaveBeenCalledWith('playlists')
      await host.controller.setEnabled('feature.tags', false)
      await host.controller.setEnabled('feature.composer', false)
      await host.controller.executeCommand('system.library/open-playlists', expected)
      expect(business.navigation.selectView).toHaveBeenCalledTimes(2)
      await expect(
        host.controller.replaceBuiltIn({
          descriptor: directory[0]!,
          activate: () => ({ contributionIds: [] }),
        }),
      ).rejects.toThrow('required-module')
      await host.dispose()
      // Presentation/module cleanup does not destroy shared playback or cancel downloads.
      expect(business.playback.stop).toHaveBeenCalledTimes(1)
    },
  )
  it.each(['userscript', 'tauri'] as const)(
    'owns both creation navigation commands in one optional module on %s',
    async (runtime) => {
      const business = ports()
      // Keep command ownership coverage independent of the current build's development gate.
      const features = [{ ...createMusicCreationModule(runtime), unavailableReason: undefined }]
      const host = createWorkbenchModuleHost({
        runtime,
        features,
        form: 'desktop',
        directory: createWorkbenchModuleDirectory(runtime, features),
        ports: business,
        onRequiredFailure: vi.fn(),
      })
      await host.start()
      const expected = { objectRevision: 1, viewRevision: 1 }
      await host.controller.executeCommand('feature.composer/open-works', expected)
      expect(business.navigation.selectView).toHaveBeenLastCalledWith('custom-tracks')
      await host.controller.executeCommand('feature.composer/open-composer', expected)
      expect(business.navigation.selectView).toHaveBeenLastCalledWith('composer')
      const contributions = host.controller.definitions.contributions
      expect(contributions.some((entry) => entry.id === 'system.library/open-works')).toBe(false)
      await host.controller.setEnabled('feature.composer', false)
      business.navigation.selectView.mockClear()
      await Promise.all(
        ['open-works', 'open-composer'].map((command) =>
          expect(
            host.controller.executeCommand(`feature.composer/${command}`, expected),
          ).rejects.toThrow(),
        ),
      )
      expect(business.navigation.selectView).not.toHaveBeenCalled()
      await host.controller.setEnabled('feature.composer', true)
      await host.controller.executeCommand('feature.composer/open-works', expected)
      expect(business.navigation.selectView).toHaveBeenCalledExactlyOnceWith('custom-tracks')
      await host.dispose()
    },
  )
  it('rejects missing/replaced core providers and unrecognized build module identities before activation', () => {
    const directory = createWorkbenchModuleDirectory('tauri', [
      createTagManagementModule('tauri'),
      createMusicCreationModule('tauri'),
    ])
    const options = {
      runtime: 'tauri' as const,
      form: 'desktop' as const,
      ports: ports(),
      onRequiredFailure: vi.fn(),
    }
    expect(() => createWorkbenchModuleHost({ ...options, directory: directory.slice(1) })).toThrow(
      'core-provider-contract',
    )
    expect(() =>
      createWorkbenchModuleHost({
        ...options,
        directory: directory.map((module) => ({ ...module, required: false })),
      }),
    ).toThrow('core-provider-contract')
    expect(() =>
      createWorkbenchModuleHost({
        ...options,
        directory: [...directory, { ...directory[0]!, id: 'external.official' }],
      }),
    ).toThrow('unknown-build-module')
  })
})
