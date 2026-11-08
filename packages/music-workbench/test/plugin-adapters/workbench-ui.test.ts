import { createMusicCreationModule } from '@any-music/plugin-music-creation'
import { createTagManagementModule } from '@any-music/plugin-tag-management'
import { THEME_ROOT_POINT } from '@any-music/plugin-ui-vue/directory'
import { DEFAULT_DESTINATION_IDS } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'

import { createWorkbenchModuleDirectory } from '../../src/plugin-adapters/workbench-module-directory'
import { createWorkbenchModuleHost } from '../../src/plugin-adapters/workbench-modules'
import {
  getAllocatedNavigation,
  getWorkbenchViewKey,
  resolveWorkbenchViews,
} from '../../src/plugin-adapters/workbench-ui'

describe('dynamic workbench view adapter', () => {
  it.each(['userscript', 'tauri'] as const)(
    'preserves all old preference identities/order/hiding and retires optional contributions on %s',
    async (runtime) => {
      // This fixture admits creation so its full contribution lifecycle remains covered.
      const features = [
        createTagManagementModule(runtime),
        {
          ...createMusicCreationModule(runtime),
          unavailableReason: undefined,
        },
      ]
      const host = createWorkbenchModuleHost({
        runtime,
        features,
        form: 'desktop',
        directory: createWorkbenchModuleDirectory(runtime, features),
        ports: {
          navigation: { selectView: vi.fn(), currentView: () => 'catalog', revision: () => 1 },
          interaction: { hasUserGesture: () => true },
          library: { getSummary: () => ({ trackCount: 0, playlistCount: 0 }) },
          playback: { stop: vi.fn() },
          downloads: { cancelActiveBatch: vi.fn() },
        },
        onRequiredFailure: vi.fn(),
      })
      const input = {
        context: {
          runtime,
          form: 'desktop' as const,
          area: 'catalog',
          hasTrack: true,
          selectionCount: 3,
        },
      }
      const resolve = () => {
        const allocation = host.controller.preview(input)
        return resolveWorkbenchViews(
          host.controller.definitions.contributions.filter((entry) =>
            allocation.slots['workspace.views']?.includes(entry.id),
          ),
        )
      }
      await host.start()
      const themeMappings = Object.fromEntries([[THEME_ROOT_POINT, 'theme.studio/root']])
      const theme = await host.controller.activate(['theme.studio'], { ...input, themeMappings })
      expect(theme.slots[THEME_ROOT_POINT]).toEqual(['theme.studio/root'])
      expect(host.controller.states.get('feature.tags')?.activation).toBe('inactive')
      expect(host.controller.states.get('feature.composer')?.activation).toBe('inactive')
      expect(resolve()).toHaveLength(10)
      const order = DEFAULT_DESTINATION_IDS.toReversed()
      expect(
        getAllocatedNavigation(order, ['tags', 'history'], resolve()).map((entry) => entry.id),
      ).toEqual(order.filter((id) => id !== 'tags' && id !== 'history'))
      expect(new Set(order.map(getWorkbenchViewKey)).size).toBe(10)
      expect(getWorkbenchViewKey('custom-tracks')).toBe('feature.composer/view-custom-tracks')
      expect(resolve().filter((entry) => entry.id.startsWith('feature.composer/'))).toEqual([
        expect.objectContaining({ reference: 'composer' }),
        expect.objectContaining({ reference: 'custom-tracks' }),
      ])
      for (const area of ['catalog', 'queue', 'favorites', 'playlists', 'history']) {
        const allocation = host.controller.preview({ context: { ...input.context, area } })
        expect(allocation.slots['track.actions.secondary']).toEqual([
          'feature.composer/compose',
          'feature.tags/manage-tags',
        ])
        expect(allocation.slots['trackList.operator.actions']).toEqual(['feature.tags/batch-tags'])
        expect(allocation.slots['track.details']).toEqual(['feature.tags/tag-details'])
        expect(allocation.slots['trackList.filters']).toEqual(['feature.tags/tag-filter'])
      }
      await host.controller.setEnabled('feature.tags', false)
      await host.controller.setEnabled('feature.composer', false)
      expect(resolve().map((entry) => entry.reference)).not.toContain('tags')
      expect(resolve().map((entry) => entry.reference)).toContain('playlists')
      expect(resolve().map((entry) => entry.reference)).not.toContain('custom-tracks')
      expect(resolve().map((entry) => entry.reference)).not.toContain('composer')
      expect(
        getAllocatedNavigation(order, ['tags', 'history'], resolve()).map((entry) => entry.id),
      ).toEqual(
        order.filter((id) => !['tags', 'history', 'custom-tracks', 'composer'].includes(id)),
      )
      for (const area of ['catalog', 'queue', 'favorites', 'playlists', 'history']) {
        const allocation = host.controller.preview({ context: { ...input.context, area } })
        expect(allocation.slots['track.actions.secondary']).toEqual([])
        expect(allocation.slots['trackList.operator.actions']).toEqual([])
      }
      await host.controller.setEnabled('feature.composer', true)
      expect(
        getAllocatedNavigation(order, ['tags', 'history'], resolve()).map((entry) => entry.id),
      ).toEqual(order.filter((id) => id !== 'tags' && id !== 'history'))
      await host.dispose()
    },
  )
  it('keeps plugin references separate and rejects malformed references', () => {
    expect(
      resolveWorkbenchViews([{ id: 'internal.example/summary', implementationId: 'summary' }])[0]
        ?.reference,
    ).toEqual({ kind: 'plugin-view', ownerId: 'internal.example', localId: 'summary' })
    expect(() =>
      resolveWorkbenchViews([{ id: '../catalog', implementationId: 'catalog' }]),
    ).toThrow()
  })
})
