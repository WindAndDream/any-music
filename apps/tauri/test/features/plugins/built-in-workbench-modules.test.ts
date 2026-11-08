import { describe, expect, it } from 'vitest'

import {
  createBuiltInWorkbenchModules,
  builtInUiThemes,
  loadTagManagement,
  loadMusicCreation,
} from '../../../src/features/plugins/built-in-workbench-modules'

const { directory: builtInWorkbenchModules } = createBuiltInWorkbenchModules('desktop')

describe('Tauri build module directory', () => {
  it.each(['desktop', 'mobile'] as const)(
    'registers external sources as an optional built-in (%s)',
    (form) => {
      const { directory, features } = createBuiltInWorkbenchModules(form)
      const module = directory.find((entry) => entry.id === 'feature.external-sources')
      expect(module).toMatchObject({ name: '外置音乐源', required: false })
      expect(features).toContainEqual(module)
      expect(module?.contributions).toEqual([])
    },
  )
  it('loads creation state through named ports without native, GM or account capabilities', async () => {
    const implementation = await loadMusicCreation()
    expect(implementation.Composer).toBeDefined()
    const original = {
      materialCollections: [],
      pendingMaterialTrackIds: ['legacy:leaf'],
      materialCollectionByTrackId: {},
    }
    const session = implementation.createSession({
      read: () => original,
      write() {
        throw new Error('No replay during load')
      },
      changed() {},
      isCurrent: () => true,
      rememberTracks() {},
      publishCustomTrack() {
        throw new Error('No publication during load')
      },
      readPublishedRecipe: () => undefined,
      deleteCreationMaterials: () => [],
    })
    expect(session.snapshot().pendingMaterialTrackIds).toEqual(['legacy:leaf'])
    expect(
      builtInWorkbenchModules.filter((module) => module.id === 'feature.composer'),
    ).toHaveLength(1)
    session.dispose()
    expect(() => session.clearData()).toThrow('停用')
  }, 20_000)
  it('loads tag state independently of account and native capabilities', async () => {
    const implementation = await loadTagManagement()
    expect(implementation.Panel).toBeDefined()
    const session = implementation.createSession({
      read: () => ({ associations: [{ trackId: 'legacy', tags: ['保留'] }] }),
      write() {
        throw new Error('No replay during load')
      },
      changed() {},
      isCurrent: () => true,
      rememberTracks() {},
    })
    expect(session.tagsByTrackId().get('legacy')).toEqual(['保留'])
    session.dispose()
  }, 20_000)
  it('contains renderer business identities without native authorization or executable paths', () => {
    expect(
      builtInWorkbenchModules.filter((module) => module.required).map((module) => module.id),
    ).toEqual([
      'system.library',
      'system.playback',
      'system.downloads',
      'system.sources',
      'system.plugins',
      'theme.default',
    ])
    expect(
      builtInWorkbenchModules.every((module) => module.installationId.startsWith('tauri:')),
    ).toBe(true)
    expect(Object.isFrozen(builtInWorkbenchModules)).toBe(true)
    expect(builtInUiThemes.map((theme) => theme.id)).toEqual(['default', 'studio'])
    expect(Object.isFrozen(builtInUiThemes)).toBe(true)
    expect(JSON.stringify(builtInUiThemes)).not.toMatch(/\.vue|loader|externalPlugins|grants/)
    expect(JSON.stringify(builtInWorkbenchModules)).not.toMatch(/grants|cookie|secret|invoke|\.vue/)
  })
})
