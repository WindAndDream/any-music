import { describe, expect, it } from 'vitest'

import {
  builtInWorkbenchModules,
  builtInUiThemes,
  loadTagManagement,
  loadMusicCreation,
} from '../../../src/features/plugins/built-in-workbench-modules'

describe('Userscript build module directory', () => {
  it('loads creation through its separate Vue entry without GM or private repositories', async () => {
    const implementation = await loadMusicCreation()
    expect(implementation.Composer).toBeDefined()
    const session = implementation.createSession({
      read: () => ({
        materialCollections: [],
        pendingMaterialTrackIds: ['legacy:leaf'],
        materialCollectionByTrackId: {},
      }),
      write() {
        throw new Error('No replay during load')
      },
      changed() {},
      isCurrent: () => true,
      rememberTracks() {},
      readPublishedRecipe: () => undefined,
      publishCustomTrack() {
        throw new Error('No publication during load')
      },
      deleteCreationMaterials: () => [],
    })
    expect(session.snapshot().pendingMaterialTrackIds).toEqual(['legacy:leaf'])
    expect(
      builtInWorkbenchModules.filter((module) => module.id === 'feature.composer'),
    ).toHaveLength(1)
    session.dispose()
    expect(() => session.clearData()).toThrow('停用')
  }, 20_000)
  it('loads the reviewed tag implementation through its separate Vue entry', async () => {
    expect(
      builtInWorkbenchModules
        .find((entry) => entry.id === 'feature.tags')
        ?.contributions.map((entry) => entry.pointId),
    ).toContain('trackList.filters')
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
  it('ships immutable built-ins with stable core business identities and no external loader', () => {
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
      builtInWorkbenchModules.every((module) => module.installationId.startsWith('userscript:')),
    ).toBe(true)
    expect(Object.isFrozen(builtInWorkbenchModules)).toBe(true)
    expect(builtInUiThemes.map((theme) => theme.id)).toEqual(['default', 'studio'])
    expect(Object.isFrozen(builtInUiThemes)).toBe(true)
    expect(JSON.stringify(builtInUiThemes)).not.toMatch(/\.vue|loader|externalPlugins|grants/)
    expect(builtInWorkbenchModules.some((module) => module.id.includes('playlists'))).toBe(false)
  })
})
