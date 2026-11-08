import { describe, expect, it } from 'vitest'

import {
  createVirtualCollectionFixture,
  resizeFixtureContent,
  virtualCollectionSizes,
} from './collection-data'

describe('virtual collection inputs', () => {
  it.each(virtualCollectionSizes)(
    'reproduces %i records and distinct occurrences without external resources',
    (count) => {
      const data = createVirtualCollectionFixture(count)
      expect(data).toEqual(createVirtualCollectionFixture(count))
      expect(new Set(data.records.map(({ track }) => track.id)).size).toBe(count)
      expect(new Set(data.occurrences.map(({ occurrenceKey }) => occurrenceKey)).size).toBe(count)
      for (const { track } of data.records) {
        if (track.artworkUrl) expect(track.artworkUrl).toMatch(/^data:image\/svg\+xml,/)
      }
      if (count > 1) expect(data.occurrences[0]!.track).toBe(data.occurrences[1]!.track)
    },
  )

  it('supports long/short edits, missing and different artwork, and multiple tag counts', () => {
    const { records } = createVirtualCollectionFixture(80)
    expect(new Set(records.map(({ customTags }) => customTags.length)).size).toBe(6)
    expect(new Set(records.map(({ track }) => track.artworkUrl)).size).toBe(3)
    const original = records[0]!
    const expanded = resizeFixtureContent(original, true)
    const shortened = resizeFixtureContent(expanded, false)
    expect(expanded.track.id).toBe(original.track.id)
    expect(shortened.track.id).toBe(original.track.id)
    expect(expanded.track.title.length).toBeGreaterThan(original.track.title.length)
    expect(shortened.track.title.length).toBeLessThan(expanded.track.title.length)
    expect(shortened.customTags).toEqual([])
    expect(original.customTags).toEqual([])
    expect(original.track.artworkUrl).toBeUndefined()
  })
})
