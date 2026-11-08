import { describe, expect, it } from 'vitest'

import {
  getPlaylistCoverCrop,
  getPlaylistCoverCropPosition,
} from '../../../src/composables/library/playlist-cover-crop'

describe('playlist cover framing', () => {
  it.each([
    [1600, 1000, 8 / 5],
    [600, 1800, 8 / 5],
    [1800, 600, 1],
    [1, 1, 1],
  ])('keeps every crop inside a %s × %s image at ratio %s', (width, height, ratio) => {
    for (const zoom of [1, 1.5, 3])
      for (const x of [0, 0.5, 1])
        for (const y of [0, 0.5, 1]) {
          const crop = getPlaylistCoverCrop(width, height, ratio, zoom, x, y)
          expect(crop.x).toBeGreaterThanOrEqual(0)
          expect(crop.y).toBeGreaterThanOrEqual(0)
          expect(crop.x + crop.width).toBeLessThanOrEqual(width + 0.001)
          expect(crop.y + crop.height).toBeLessThanOrEqual(height + 0.001)
          expect(crop.width / crop.height).toBeCloseTo(ratio)
        }
  })
  it('retains the selected focal point across zoom and clamps movement at the edge', () => {
    const previous = getPlaylistCoverCrop(1600, 1000, 1, 2, 0.7, 0.4)
    const next = getPlaylistCoverCrop(1600, 1000, 8 / 5, 3)
    const center = { x: previous.x + previous.width / 2, y: previous.y + previous.height / 2 }
    const position = getPlaylistCoverCropPosition(1600, 1000, next, center.x, center.y)
    const actual = getPlaylistCoverCrop(1600, 1000, 8 / 5, 3, position.x, position.y)
    expect(actual.x + actual.width / 2).toBeCloseTo(center.x)
    expect(actual.y + actual.height / 2).toBeCloseTo(center.y)
    expect(getPlaylistCoverCropPosition(1600, 1000, next, -200, 100000)).toEqual({ x: 0, y: 1 })
  })
})
