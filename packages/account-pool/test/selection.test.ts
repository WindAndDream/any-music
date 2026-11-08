import { describe, expect, it } from 'vitest'

import { AccountSelector } from '../src/index'
import type { AccountProfile } from '../src/index'

const candidates: AccountProfile[] = ['a', 'b', 'c'].map((id) => ({
  id,
  name: id,
  platformId: 'source',
  authentication: 'anonymous',
  enabled: true,
  status: 'ready',
}))

describe('random account selection', () => {
  it('selects each primary once per cycle in independent platform/operation bags', () => {
    const selector = new AccountSelector(() => 0)
    const primary = () => selector.order('source', 'search', candidates, 'shuffle')[0]!.id
    expect(new Set([primary(), primary(), primary()]).size).toBe(3)
    const next = primary()
    expect(selector.order('source', 'import', candidates, 'shuffle')[0]!.id).toBe(next)
    expect(selector.order('another', 'search', candidates, 'shuffle')[0]!.id).toBe(next)
  })
  it('allows repetition in random mode but never duplicates an operation fallback candidate', () => {
    const selector = new AccountSelector(() => 0)
    expect(selector.order('source', 'search', candidates, 'random')[0]!.id).toBe('a')
    expect(selector.order('source', 'search', candidates, 'random')[0]!.id).toBe('a')
    expect(
      new Set(selector.order('source', 'search', candidates, 'random').map((entry) => entry.id))
        .size,
    ).toBe(3)
  })
  it('single-account operation needs no randomness and empty ranges do no work', () => {
    const selector = new AccountSelector(() => {
      throw new Error('must not use randomness')
    })
    expect(selector.order('source', 'search', candidates.slice(0, 1), 'shuffle')).toEqual(
      candidates.slice(0, 1),
    )
    expect(selector.order('source', 'search', [], 'random')).toEqual([])
  })
  it('refreshes eligibility changes and clears policies explicitly', () => {
    const selector = new AccountSelector(() => 0)
    selector.order('source', 'search', candidates, 'shuffle')
    expect(
      selector.order('source', 'search', candidates.slice(1), 'shuffle').map((entry) => entry.id),
    ).not.toContain('a')
    selector.clear('source', 'search')
    expect(selector.order('source', 'search', candidates.slice(0, 1), 'shuffle')[0]!.id).toBe('a')
  })
  it('rejects invalid random sources before transport invocation', () => {
    for (const random of [() => 1, () => -1, () => NaN])
      expect(() =>
        new AccountSelector(random).order('source', 'search', candidates, 'random'),
      ).toThrow(RangeError)
  })
})
