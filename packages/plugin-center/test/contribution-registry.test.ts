import { describe, expect, it } from 'vitest'

import { ContributionRegistry, matchesModuleWhen } from '../src/index'
import { context, contribution, moduleFixture, points } from './module-fixtures'

describe('static contribution registry', () => {
  it('copies and freezes descriptors without loading implementations', () => {
    const registry = new ContributionRegistry(points)
    const descriptor = moduleFixture('one').descriptor
    const snapshot = registry.replace([descriptor], new Set(['one']))
    expect(Object.isFrozen(snapshot.contributions[0])).toBe(true)
    expect(snapshot.contributions[0]?.id).toBe('one/view')
    expect(snapshot.contributions[0]).not.toBe(descriptor.contributions[0])
  })
  it.each([
    [contribution('view', { contractVersion: 2 }), 'incompatible-contract'],
    [contribution('view', { inputSchema: 'wrong' }), 'incompatible-contract'],
    [contribution('view', { implementationId: '../../component.vue' }), 'invalid-contribution'],
    [contribution('view', { group: 'security' }), 'invalid-contribution'],
  ])('rejects invalid batches atomically: %j', (definition, reason) => {
    const registry = new ContributionRegistry(points)
    const snapshot = registry.replace([moduleFixture('valid').descriptor], new Set(['valid']))
    expect(() =>
      registry.replace(
        [moduleFixture('bad', { contributions: [definition] }).descriptor],
        new Set(['bad']),
      ),
    ).toThrow(reason)
    expect(registry.current).toBe(snapshot)
  })
  it('rejects duplicate IDs and forged built-in global slots', () => {
    const registry = new ContributionRegistry(points)
    expect(() =>
      registry.replace(
        [
          moduleFixture('duplicate', { contributions: [contribution(), contribution()] })
            .descriptor,
        ],
        new Set(['duplicate']),
      ),
    ).toThrow('contribution-conflict')
    const layout = contribution('layout', {
      ...points[1],
      pointId: 'theme.layout',
      contractVersion: 1,
      implementation: 'host-component',
    })
    expect(() =>
      registry.replace(
        [moduleFixture('forged', { contributions: [layout] }).descriptor],
        new Set(),
      ),
    ).toThrow('untrusted-contribution')
    expect(() =>
      registry.replace(
        [
          moduleFixture('public', {
            contributions: [contribution('view', { implementation: 'declarative' })],
          }).descriptor,
        ],
        new Set(),
      ),
    ).not.toThrow()
  })
  it('bounds condition trees and rejects unknown fields even under negation', () => {
    const registry = new ContributionRegistry(points)
    const when = { not: { field: 'constructor', equals: 'x' } } as never
    expect(matchesModuleWhen(when, context)).toBe(false)
    expect(() =>
      registry.replace(
        [moduleFixture('bad', { contributions: [contribution('view', { when })] }).descriptor],
        new Set(['bad']),
      ),
    ).toThrow('invalid-condition')
    expect(
      matchesModuleWhen(
        {
          all: [{ field: 'area', equals: 'catalog' }, { not: { field: 'hasTrack', equals: true } }],
        },
        context,
      ),
    ).toBe(true)
    let deep = { field: 'area', equals: 'catalog' } as import('../src/index').WhenExpression
    for (let i = 0; i < 12; i++) deep = { not: deep }
    expect(matchesModuleWhen(deep, context)).toBe(false)
  })
  it('binds idempotent batch cleanup to the owner generation and rejects non-host scope vocabulary', () => {
    const registry = new ContributionRegistry(points)
    const first = registry.registerBatch(moduleFixture('one').descriptor, true, 1)
    const second = registry.registerBatch(moduleFixture('one').descriptor, true, 2)
    first.dispose()
    expect(registry.current.contributions).toHaveLength(1)
    second.dispose()
    const after = registry.current
    second.dispose()
    expect(registry.current).toBe(after)
    expect(after.contributions).toEqual([])
    expect(() =>
      registry.registerBatch(
        moduleFixture('bad', {
          contributions: [contribution('view', { scope: { areas: ['#dom-selector'] } })],
        }).descriptor,
        true,
        1,
      ),
    ).toThrow('invalid-scope')
    expect(registry.current).toBe(after)
  })

  it.each(['renamed', 'two'])(
    'cleans the registered owner after its caller-owned descriptor ID changes to %s',
    (changedId) => {
      const registry = new ContributionRegistry(points)
      const descriptor = moduleFixture('one').descriptor
      const first = registry.registerBatch(descriptor, true, 1)
      const second = registry.registerBatch(moduleFixture('two').descriptor, true, 1)
      const registered = registry.current

      descriptor.id = changedId
      first.dispose()

      expect(registered.contributions.map((entry) => entry.id)).toEqual(['one/view', 'two/view'])
      expect(registry.current.contributions.map((entry) => entry.id)).toEqual(['two/view'])
      const removed = registry.current
      first.dispose()
      expect(registry.current).toBe(removed)
      second.dispose()
      expect(registry.current.contributions).toEqual([])
    },
  )

  it('preserves replacement-generation protection when caller descriptors change identity', () => {
    const registry = new ContributionRegistry(points)
    const firstDescriptor = moduleFixture('one').descriptor
    const first = registry.registerBatch(firstDescriptor, true, 1)
    const secondDescriptor = moduleFixture('one').descriptor
    const second = registry.registerBatch(secondDescriptor, true, 2)
    const replacement = registry.current

    expect(() => registry.registerBatch(moduleFixture('one').descriptor, true, 2)).toThrow(
      'stale-registration',
    )
    firstDescriptor.id = 'old-owner'
    first.dispose()
    expect(registry.current).toBe(replacement)
    secondDescriptor.id = 'new-owner'
    second.dispose()
    expect(registry.current.contributions).toEqual([])
  })

  it('does not let an old cleanup remove a reinstalled owner with the same generation', () => {
    const registry = new ContributionRegistry(points)
    const descriptor = moduleFixture('one').descriptor
    const first = registry.registerBatch(descriptor, true, 1)
    descriptor.id = 'renamed'
    first.dispose()
    expect(registry.current.contributions).toEqual([])

    const reinstalled = registry.registerBatch(moduleFixture('one').descriptor, true, 1)
    const current = registry.current
    descriptor.id = 'one'
    first.dispose()
    expect(registry.current).toBe(current)
    reinstalled.dispose()
    expect(registry.current.contributions).toEqual([])
  })

  it('retains the original cleanup after a replacement registration fails validation', () => {
    const registry = new ContributionRegistry(points)
    const descriptor = moduleFixture('one').descriptor
    const first = registry.registerBatch(descriptor, true, 1)
    const registered = registry.current

    expect(() =>
      registry.registerBatch(
        moduleFixture('one', {
          contributions: [contribution('view', { contractVersion: 2 })],
        }).descriptor,
        true,
        2,
      ),
    ).toThrow('incompatible-contract')
    expect(registry.current).toBe(registered)
    descriptor.id = 'renamed'
    first.dispose()
    expect(registry.current.contributions).toEqual([])
  })
})
