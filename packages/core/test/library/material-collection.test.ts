import { describe, expect, it } from 'vitest'

import {
  assertRecipeUsesMaterialCollection,
  MaterialCollectionError,
} from '../../src/library/material-collection'
import type { MaterialCollection } from '../../src/library/models'

const collection: MaterialCollection = {
  id: 'material-collection:test',
  name: '测试素材',
  trackIds: ['ordinary', 'custom'],
  createdAtMs: 1,
  updatedAtMs: 1,
}

describe('assertRecipeUsesMaterialCollection', () => {
  it('allows ordinary and custom tracks as direct materials in the same collection', () => {
    expect(() =>
      assertRecipeUsesMaterialCollection(collection, [
        { sourceTrackId: 'ordinary', startMs: 0, endMs: 500 },
        { sourceTrackId: 'custom', startMs: 100, endMs: 900 },
      ]),
    ).not.toThrow()
  })

  it('rejects a source from another collection and identifies that source', () => {
    expect(() =>
      assertRecipeUsesMaterialCollection(collection, [
        { sourceTrackId: 'outside', startMs: 0, endMs: 500 },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MaterialCollectionError>>({
        code: 'source-outside-collection',
        sourceTrackId: 'outside',
      }),
    )
  })
})
