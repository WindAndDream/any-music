import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import {
  createVirtualTableLayout,
  createVirtualTableRowIndex,
} from '../../../src/composables/virtual-scroll/virtual-table-layout'
import { useMeasuredVirtualTable } from '../../../src/virtual-scroll'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

describe('native virtual table geometry (injected boxes; no browser layout)', () => {
  it('counts physical header, group, main/detail and footer rows independently of occurrences', () => {
    const result = createVirtualTableRowIndex([1, 3, 1, 2], (count) => count, 2, 1)
    expect(result).toEqual({
      positions: [
        { firstRowIndex: 3, rowCount: 1 },
        { firstRowIndex: 4, rowCount: 3 },
        { firstRowIndex: 7, rowCount: 1 },
        { firstRowIndex: 8, rowCount: 2 },
      ],
      rowCount: 10,
    })
    expect(createVirtualTableRowIndex([], () => 1, 2, 1)).toEqual({
      positions: [],
      rowCount: 3,
    })
  })

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects an invalid physical item row count: %s',
    (count) => {
      expect(() => createVirtualTableRowIndex([1], () => count)).toThrow(RangeError)
    },
  )

  it('covers every sparse interval around distant retained occurrences exactly once', () => {
    const rows = [0, 20, 21, 90].map((index) => ({
      key: index,
      index,
      item: index,
      start: index * 20,
      end: index * 20 + 20,
      size: 20,
    }))
    const layout = createVirtualTableLayout(rows, 2000)
    expect(layout.rows.map((row) => row.gapBefore)).toEqual([0, 380, 0, 1360])
    expect(layout.trailingGap).toBe(180)
    expect(
      layout.rows.reduce((size, entry) => size + entry.gapBefore + entry.row.size, 0) +
        layout.trailingGap,
    ).toBe(2000)
    expect(createVirtualTableLayout([], 2000)).toEqual({ rows: [], trailingGap: 2000 })
  })

  it('measures the complete natural row group, invalidates detail-row counts and accepts shrinking', async () => {
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document)
    const origin = new VirtualElement(env.document)
    root.scrollTop = 0
    root.clientHeight = 100
    origin.rect.top = 70
    const items = ref(
      Array.from({ length: 1000 }, (_, index) => ({ key: index, details: 0, revision: 0 })),
    )
    const scope = effectScope()
    const result = scope.run(() =>
      useMeasuredVirtualTable({
        items,
        getItemKey: (item) => item.key,
        getContentGeneration: (item) => item.revision,
        getItemRowCount: (item) => item.details + 1,
        estimatedItemSize: 20,
        listElement: origin.asElement(),
        scrollElement: root.asElement(),
        headerRowCount: 2,
        footerRowCount: 1,
        retainedIndexes: [900],
      }),
    )!
    const group = new VirtualElement(env.document)
    group.rect.height = 20
    const release = result.measurements.observeItem(0, group.asElement())
    try {
      await settle()
      expect(result.context.metrics.value.listOffset).toBe(58)
      expect(result.totalSize.value).toBe(20_000)
      expect(result.rowIndex.value.rowCount).toBe(1003)
      expect(result.virtualItems.value.some((row) => row.index === 900)).toBe(true)
      const first = result.virtualItems.value[0]!
      expect(first.start).toBe(0)
      items.value[0]!.details = 2
      group.rect.height = 70
      await settle()
      expect(result.measurements.getHeight(0)).toBe(70)
      expect(result.totalSize.value).toBe(20_050)
      expect(result.rowIndex.value.positions[1]!.firstRowIndex).toBe(6)
      expect(result.rowIndex.value.rowCount).toBe(1005)
      items.value[0]!.details = 0
      group.rect.height = 12
      await settle()
      expect(result.measurements.getHeight(0)).toBe(12)
      expect(result.totalSize.value).toBe(19_992)
      expect(result.virtualItems.value[1]!.start).toBe(12)
      const rendered = result.renderLayout.value
      expect(
        rendered.rows.reduce((size, entry) => size + entry.gapBefore + entry.row.size, 0) +
          rendered.trailingGap,
      ).toBe(19_992)
    } finally {
      release()
      scope.stop()
    }
    expect(env.observers[0]!.disconnect).toHaveBeenCalledTimes(1)
  })
})
