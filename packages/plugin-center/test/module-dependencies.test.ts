import { describe, expect, it } from 'vitest'

import { resolveModuleDependencies } from '../src/index'
import { moduleFixture } from './module-fixtures'

describe('versioned module dependencies', () => {
  const core = moduleFixture('core', {
    required: true,
    provides: [{ id: 'library', version: 1 }],
  }).descriptor
  it('resolves providers before consumers independently of discovery order', () => {
    const consumer = moduleFixture('consumer', {
      requires: [{ id: 'library', version: 1 }],
      optional: [{ id: 'tags', version: 1 }],
    }).descriptor
    for (const modules of [
      [core, consumer],
      [consumer, core],
    ]) {
      const resolved = resolveModuleDependencies(modules, ['consumer'])
      expect(resolved.order).toEqual(['core', 'consumer'])
      expect(resolved.optionalMissing).toEqual([{ ownerId: 'consumer', serviceId: 'tags' }])
    }
  })
  it('reports missing tokens, incompatible versions and provider conflicts', () => {
    const wrong = moduleFixture('consumer', {
      requires: [{ id: 'library', version: 2 }],
    }).descriptor
    expect(() => resolveModuleDependencies([wrong], ['consumer'])).toThrow(
      'dependency-missing: consumer -> library',
    )
    expect(() => resolveModuleDependencies([core, wrong], ['consumer'])).toThrow(
      'dependency-version',
    )
    expect(() => resolveModuleDependencies([core, { ...core, id: 'other' }], ['core'])).toThrow(
      'provider-conflict',
    )
  })
  it('detects required and optional cycles with their path', () => {
    const a = moduleFixture('a', {
      provides: [{ id: 'a', version: 1 }],
      requires: [{ id: 'b', version: 1 }],
    }).descriptor
    const b = moduleFixture('b', {
      provides: [{ id: 'b', version: 1 }],
      optional: [{ id: 'a', version: 1 }],
    }).descriptor
    expect(() => resolveModuleDependencies([b, a], ['a'])).toThrow('dependency-cycle: a -> b -> a')
  })
})
