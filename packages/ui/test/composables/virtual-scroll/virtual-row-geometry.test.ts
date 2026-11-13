import { describe, expect, it, vi } from 'vitest'

import { createVirtualItemIndex, createVirtualRowGeometry } from '../../../src/virtual-scroll'
import {
  createVirtualCollectionFixture,
  virtualCollectionSizes,
} from '../../fixtures/virtual-scroll/collection-data'

describe('virtual row geometry', () => {
  it.each(virtualCollectionSizes)(
    'indexes %i stable occurrence keys once, independently of repeated track identity',
    (count) => {
      const { occurrences } = createVirtualCollectionFixture(count)
      const getKey = vi.fn((item: (typeof occurrences)[number]) => item.occurrenceKey)
      const index = createVirtualItemIndex(occurrences, getKey)
      for (let position = 0; position < count; position++)
        expect(index.indexOf(occurrences[position]!.occurrenceKey)).toBe(position)
      expect(index.indexOf('absent')).toBeUndefined()
      expect(getKey).toHaveBeenCalledTimes(count)
      expect(index.keys).toHaveLength(count)
    },
  )

  it('rejects duplicate occurrence keys rather than aliasing two components', () => {
    expect(() => createVirtualItemIndex(['song', 'song'], (item) => item)).toThrow(
      'Duplicate virtual item key',
    )
    expect(() => createVirtualItemIndex([NaN], (item) => item)).toThrow('finite')
  })

  it.each([1, 2, 3, 7])(
    'keeps row-major order and final partial rows with %i columns',
    (columns) => {
      const measure = vi.fn((index: number) => 20 + (index % 3) * 5)
      const geometry = createVirtualRowGeometry({
        count: 80,
        columns,
        rowGap: 8,
        listOffset: 100,
        paddingStart: 12,
        paddingEnd: 16,
        getRowSize: measure,
      })
      expect(geometry.rowCount).toBe(Math.ceil(80 / columns))
      expect(geometry.getRow(0)?.start).toBe(112)
      const last = geometry.getRow(geometry.rowCount - 1)!
      expect(last.endIndex).toBe(80)
      expect(last.end + 16).toBe(100 + geometry.totalSize)
      for (let index = 0; index < 80; index++) {
        const position = geometry.getItemPosition(index)!
        const row = geometry.getRow(position.rowIndex)!
        expect(row.startIndex + position.columnIndex).toBe(index)
        expect(index).toBeLessThan(row.endIndex)
      }
      expect(geometry.getRow(-1)).toBeUndefined()
      expect(geometry.getItemPosition(80)).toBeUndefined()
      expect(measure).toHaveBeenCalledTimes(geometry.rowCount)
    },
  )

  it('locates variable rows and gaps by offset without measuring/scanning the collection again', () => {
    const measure = vi.fn((index: number) => (index % 2 === 0 ? 40 : 80))
    const geometry = createVirtualRowGeometry({
      count: 10_000,
      columns: 3,
      rowGap: 10,
      listOffset: 200,
      getRowSize: measure,
    })
    expect(geometry.findRowAtOffset(-100)?.index).toBe(0)
    expect(geometry.findRowAtOffset(240)?.index).toBe(0)
    expect(geometry.findRowAtOffset(249)?.index).toBe(0)
    expect(geometry.findRowAtOffset(250)?.index).toBe(1)
    for (let index = 0; index < geometry.rowCount; index += 7) {
      const row = geometry.getRow(index)!
      expect(geometry.findRowAtOffset(row.start + 1)?.index).toBe(index)
    }
    expect(geometry.findRowAtOffset(1e9)?.index).toBe(geometry.rowCount - 1)
    expect(measure).toHaveBeenCalledTimes(geometry.rowCount)
  })

  it('handles empty and zero-height rows without trailing gaps or invalid offset matches', () => {
    const empty = createVirtualRowGeometry({
      count: 0,
      columns: 2,
      paddingStart: 5,
      paddingEnd: 6,
      getRowSize: () => 20,
    })
    expect(empty.totalSize).toBe(11)
    expect(empty.findRowAtOffset(0)).toBeUndefined()
    const zero = createVirtualRowGeometry({ count: 3, columns: 2, rowGap: 4, getRowSize: () => 0 })
    expect(zero.totalSize).toBe(4)
    expect(zero.findRowAtOffset(4)?.index).toBe(1)
    expect(zero.findRowAtOffset(NaN)).toBeUndefined()
  })

  it.each([
    { count: -1, columns: 1 },
    { count: 1, columns: 0 },
    { count: 1.5, columns: 2 },
    { count: 2, columns: 1, rowGap: -1 },
    { count: 2, columns: 1, listOffset: Infinity },
  ])('rejects invalid geometry %j', (options) => {
    expect(() => createVirtualRowGeometry({ ...options, getRowSize: () => 40 })).toThrow(RangeError)
  })

  it('rejects invalid measured heights and accumulated overflow', () => {
    expect(() => createVirtualRowGeometry({ count: 1, columns: 1, getRowSize: () => -1 })).toThrow(
      RangeError,
    )
    expect(() =>
      createVirtualRowGeometry({ count: 2, columns: 1, getRowSize: () => 1e308 }),
    ).toThrow('overflow')
  })
})
