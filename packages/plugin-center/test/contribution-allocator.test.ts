import { describe, expect, it } from 'vitest'

import { ModuleController } from '../src/index'
import { context, contribution, moduleFixture, points } from './module-fixtures'

describe('deterministic contribution allocation', () => {
  it('rejects missing/versioned/cyclic dependencies before activating candidates and permits absent optional services', () => {
    const module = moduleFixture('needs-library', { requires: [{ id: 'library', version: 1 }] })
    const optional = moduleFixture('optional', { optional: [{ id: 'tags', version: 1 }] })
    const controller = new ModuleController({
      builtIns: [module, optional],
      points,
      readCommandContext: () => context,
    })
    const allocation = controller.preview({ context })
    expect(allocation.slots['workspace.views']).toEqual(['optional/view'])
    expect(allocation.diagnostics).toContainEqual({
      id: 'needs-library/view',
      reason: 'dependency-missing',
    })
    expect(controller.states.get('needs-library')?.activation).toBe('inactive')
  })
  const modules = ['default', 'alternate'].map((id) =>
    moduleFixture(id, {
      contributions: [
        contribution('layout', {
          pointId: 'theme.layout',
          inputSchema: 'layout.v1',
          eventSchema: 'layout-event.v1',
        }),
      ],
    }),
  )
  it('keeps the system default across discovery permutations and applies explicit scope/theme choices', () => {
    for (const builtIns of [modules, modules.toReversed()]) {
      const controller = new ModuleController({
        builtIns,
        points,
        readCommandContext: () => context,
      })
      expect(controller.preview({ context }).slots['theme.layout']).toEqual(['default/layout'])
      expect(
        controller.preview({ context, themeMappings: { 'theme.layout': 'alternate/layout' } })
          .slots['theme.layout'],
      ).toEqual(['alternate/layout'])
      expect(
        controller.preview({
          context,
          selections: { 'theme.layout': 'default/layout' },
          themeMappings: { 'theme.layout': 'alternate/layout' },
        }).slots['theme.layout'],
      ).toEqual(['default/layout'])
    }
  })
  it('retains dormant preferences, reports conflicts without a default and respects host groups', async () => {
    const controller = new ModuleController({
      builtIns: modules,
      points,
      readCommandContext: () => context,
    })
    await controller.setEnabled('alternate', false)
    const snapshot = controller.preview({
      context,
      selections: { 'theme.layout': 'alternate/layout' },
    })
    expect(snapshot.slots['theme.layout']).toEqual(['default/layout'])
    expect(snapshot.diagnostics).toContainEqual({
      id: 'alternate/layout',
      reason: 'selection-unavailable',
    })
    const conflict = new ModuleController({
      builtIns: modules,
      points: points.map((point) => ({ ...point, defaultContributionId: undefined })),
      readCommandContext: () => context,
    })
    expect(conflict.preview({ context }).slots['theme.layout']).toEqual([])
    const list = new ModuleController({
      builtIns: [
        moduleFixture('a'),
        moduleFixture('core', {
          contributions: [contribution('view', { group: 'core', order: 100 })],
        }),
        moduleFixture('z'),
      ],
      points,
      readCommandContext: () => context,
    })
    expect(
      list.preview({ context, userOrder: ['z/view', 'a/view'] }).slots['workspace.views'],
    ).toEqual(['core/view', 'z/view', 'a/view'])
  })
  it('filters by runtime, form, area, list type, availability and policy without activating', async () => {
    const module = moduleFixture('scoped', {
      contributions: [
        contribution('view', {
          scope: {
            runtimes: ['tauri'],
            forms: ['mobile'],
            areas: ['queue'],
            listTypes: ['tracks'],
          },
        }),
      ],
    })
    let allowed = true
    const controller = new ModuleController({
      builtIns: [module],
      points,
      readCommandContext: () => context,
      readPolicy: () => ({ permissionEpoch: 3, isAuthorized: () => allowed }),
    })
    expect(controller.preview({ context }).diagnostics).toContainEqual({
      id: 'scoped/view',
      reason: 'unsupported-runtime',
    })
    const matching = {
      ...context,
      runtime: 'tauri' as const,
      form: 'mobile' as const,
      area: 'queue',
      listType: 'tracks',
    }
    expect(controller.preview({ context: matching }).slots['workspace.views']).toEqual([
      'scoped/view',
    ])
    allowed = false
    expect(controller.preview({ context: matching }).slots['workspace.views']).toEqual([])
    expect(controller.states.get('scoped')?.activation).toBe('inactive')
  })
})
