import { describe, expect, it } from 'vitest'

import {
  getDestinationReorderIndex,
  moveItemToIndex,
} from '../../src/composables/destination-reorder'

describe('destination reorder', () => {
  it('moves an item without mutating the controlled source order', () => {
    const source = ['catalog', 'queue', 'favorites', 'playlists'] as const

    expect(moveItemToIndex(source, 1, 3)).toEqual(['catalog', 'favorites', 'playlists', 'queue'])
    expect(source).toEqual(['catalog', 'queue', 'favorites', 'playlists'])
  })

  it('changes the preview target only after crossing another row center', () => {
    const slots = [
      { top: 0, bottom: 48 },
      { top: 56, bottom: 104 },
      { top: 112, bottom: 160 },
    ]

    expect(getDestinationReorderIndex(slots, 1, 30)).toBe(1)
    expect(getDestinationReorderIndex(slots, 1, 20)).toBe(0)
    expect(getDestinationReorderIndex(slots, 1, 128)).toBe(1)
    expect(getDestinationReorderIndex(slots, 1, 140)).toBe(2)
  })

  it('clamps pointer movement outside the measured list to the first or last slot', () => {
    const slots = [
      { top: 0, bottom: 48 },
      { top: 56, bottom: 104 },
      { top: 112, bottom: 160 },
    ]

    expect(getDestinationReorderIndex(slots, 1, -120)).toBe(0)
    expect(getDestinationReorderIndex(slots, 1, 480)).toBe(2)
  })
})
