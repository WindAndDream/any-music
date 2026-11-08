import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, shallowRef, watch } from 'vue'

import { useMeasuredVirtualGrid } from '../../../src/composables/virtual-scroll/use-measured-virtual-grid'
import * as rowGeometry from '../../../src/composables/virtual-scroll/virtual-row-geometry'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

function setup(count = 80, initialColumns = 3) {
  const env = createResizeEnvironment()
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.clientHeight = 100
  root.scrollTop = 0
  list.rect.top = 12
  list.rect.width = 1000
  const items = ref(Array.from({ length: count }, (_, key) => ({ key, revision: 0 })))
  const columns = shallowRef(initialColumns),
    gap = shallowRef(12),
    retainedIndexes = shallowRef<readonly number[]>([])
  const enabled = shallowRef(true),
    layoutGeneration = shallowRef('standard')
  const estimatedItemSize = shallowRef(20)
  const getItemKey = vi.fn((item: { key: number }) => item.key)
  const scope = effectScope()
  const result = scope.run(() =>
    useMeasuredVirtualGrid({
      items,
      columns,
      gap,
      columnGap: gap,
      retainedIndexes,
      enabled,
      layoutGeneration,
      getItemKey,
      getContentGeneration: (item) => item.revision,
      estimatedItemSize,
      cacheLimit: 32,
      scrollElement: root.asElement(),
      listElement: list.asElement(),
    }),
  )!
  function mount(key: number, height: number) {
    const element = new VirtualElement(env.document)
    element.rect.height = height
    return { element, release: result.measurements.observeItem(key, element.asElement()) }
  }
  return {
    ...env,
    root,
    list,
    items,
    columns,
    gap,
    retainedIndexes,
    enabled,
    layoutGeneration,
    estimatedItemSize,
    getItemKey,
    result,
    mount,
    stop: () => scope.stop(),
  }
}

describe('row-major measured virtual grid (injected geometry, no CSS layout)', () => {
  it('keeps unrelated cached row heights through a reorder in a newly visited region', async () => {
    const test = setup(80)
    const earlier = [0, 1, 2].map((key) => test.mount(key, 80))
    const current = [24, 25, 26].map((key) => test.mount(key, 60))
    await settle()
    for (const item of earlier) item.release()
    const before = test.result.geometry.value
    try {
      const next = [...test.items.value]
      ;[next[24], next[25]] = [next[25]!, next[24]!]
      test.items.value = next
      expect(test.result.measurements.getHeight(0)).toBe(80)
      expect(test.result.measurements.getHeight(24)).toBe(60)
      await settle()
      expect(test.result.totalSize.value).toBe(before.totalSize)
      expect(test.result.geometry.value.getItem(24)?.start).toBe(before.getItem(24)?.start)
      // Moving a cell across a row boundary invalidates only the affected cohorts.
      const crossRow = [...test.items.value]
      ;[crossRow[26], crossRow[27]] = [crossRow[27]!, crossRow[26]!]
      test.items.value = crossRow
      expect(test.result.measurements.getHeight(0)).toBe(80)
      expect(test.result.measurements.getHeight(24)).toBeUndefined()
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(80)
    } finally {
      for (const item of current) item.release()
      test.stop()
    }
  })

  it.each([80, 10_000])(
    'does not rebuild complete rows for estimate-equivalent ingress and eviction in %i cells',
    async (count) => {
      const build = vi.spyOn(rowGeometry, 'createVirtualRowGeometry')
      const test = setup(count, 1)
      const mounted: ReturnType<typeof test.mount>[] = []
      await settle()
      const initial = test.result.geometry.value
      const motion = test.result.motionRevision.value
      build.mockClear()
      test.root.getBoundingClientRect.mockClear()
      test.list.getBoundingClientRect.mockClear()
      try {
        for (let key = 0; key < 40; key++) mounted.push(test.mount(key, 20))
        await settle()
        expect(test.result.measurements.cacheSize.value).toBe(32)
        expect(test.result.measurements.getHeight(0)).toBeUndefined()
        expect(test.result.geometry.value).toBe(initial)
        expect(test.result.motionRevision.value).toBe(motion)
        expect(build).not.toHaveBeenCalled()
        expect(test.root.getBoundingClientRect).not.toHaveBeenCalled()
        expect(test.list.getBoundingClientRect).not.toHaveBeenCalled()
        for (const item of mounted)
          expect(item.element.getBoundingClientRect).toHaveBeenCalledTimes(1)
        // Invalidation drops only estimate-equivalent heights too; no old snapshot is mutated.
        test.items.value[39]!.revision++
        await settle()
        expect(build).not.toHaveBeenCalled()
        expect(test.result.geometry.value).toBe(initial)
      } finally {
        for (const item of mounted) item.release()
        test.stop()
        build.mockRestore()
      }
    },
  )

  it('reuses a measured row maximum but rebuilds when its tallest cell or row membership changes', async () => {
    const build = vi.spyOn(rowGeometry, 'createVirtualRowGeometry')
    const test = setup(8)
    const first = test.mount(0, 60),
      second = test.mount(1, 30),
      third = test.mount(2, 10)
    const last = test.mount(6, 8),
      final = test.mount(7, 9)
    await settle()
    const original = test.result.geometry.value
    build.mockClear()
    try {
      second.element.rect.height = 40
      test.observers[0]!.notify([second.element.asElement()])
      await settle()
      expect(build).not.toHaveBeenCalled()
      expect(test.result.geometry.value).toBe(original)
      expect(original.getItem(7)).toMatchObject({ start: 104, size: 9 })
      first.element.rect.height = 5
      test.observers[0]!.notify([first.element.asElement()])
      await settle()
      expect(build).toHaveBeenCalled()
      expect(test.result.geometry.value.getItem(7)).toMatchObject({ start: 84, size: 9 })
      expect(original.getItem(7)).toMatchObject({ start: 104, size: 9 })
      test.items.value = test.items.value.slice(0, 7)
      await settle()
      expect(test.result.geometry.value.count).toBe(7)
      expect(test.result.geometry.value.getItem(6)).toMatchObject({ start: 84, size: 8 })
      expect(test.result.geometry.value.getItem(7)).toBeUndefined()
    } finally {
      for (const item of [first, second, third, last, final]) item.release()
      test.stop()
      build.mockRestore()
    }
  })

  it('only shrinks a row when every cell is measured below the estimate', async () => {
    const test = setup(3)
    const first = test.mount(0, 20),
      second = test.mount(1, 10),
      third = test.mount(2, 10)
    await settle()
    try {
      expect(test.result.geometry.value.getItem(0)?.size).toBe(20)
      first.element.rect.height = 8
      test.observers[0]!.notify([first.element.asElement()])
      await settle()
      expect(test.result.geometry.value.getItem(0)?.size).toBe(10)
      // Replacing one measured cell with an unknown one restores the estimate floor.
      third.release()
      test.items.value[2]!.revision++
      await settle()
      expect(test.result.geometry.value.getItem(0)?.size).toBe(20)
    } finally {
      first.release()
      second.release()
      third.release()
      test.stop()
    }
  })

  it('keeps estimate changes and equal-total row redistribution visible to geometry and motion', async () => {
    const test = setup(3, 1)
    const first = test.mount(0, 60),
      second = test.mount(1, 40)
    await settle()
    try {
      const original = test.result.geometry.value
      const motion = test.result.motionRevision.value
      first.element.rect.height = 40
      second.element.rect.height = 60
      test.observers[0]!.notify([first.element.asElement(), second.element.asElement()])
      await settle()
      expect(test.result.totalSize.value).toBe(original.totalSize)
      expect(test.result.geometry.value.getItem(1)?.start).toBe(52)
      expect(original.getItem(1)?.start).toBe(72)
      expect(test.result.motionRevision.value).not.toBe(motion)
      test.estimatedItemSize.value = 30
      await settle()
      expect(test.result.geometry.value.getItem(2)).toMatchObject({ start: 124, size: 30 })
      expect(test.result.totalSize.value).toBe(original.totalSize + 10)
      expect(test.result.geometry.value.getItem(0)?.size).toBe(40)
    } finally {
      first.release()
      second.release()
      test.stop()
    }
  })

  it('updates complete geometry for new windows and cache eviction without treating ingress as motion', async () => {
    const test = setup(10_000, 1)
    await settle()
    const originalMotion = test.result.motionRevision.value
    const originalSpatial = test.result.layoutRevision.value
    const first = test.mount(0, 60)
    await settle()
    try {
      expect(test.result.geometry.value.getItem(1)?.start).toBe(72)
      expect(test.result.layoutRevision.value).not.toBe(originalSpatial)
      expect(test.result.motionRevision.value).toBe(originalMotion)
      first.release()
      const distant = Array.from({ length: 33 }, (_, index) => test.mount(9000 + index, 40))
      await settle()
      expect(test.result.measurements.getHeight(0)).toBeUndefined()
      expect(test.result.measurements.cacheSize.value).toBe(32)
      expect(test.result.geometry.value.getItem(1)?.start).toBe(32)
      expect(test.result.geometry.value.getItem(9032)?.size).toBe(40)
      expect(test.result.motionRevision.value).toBe(originalMotion)
      for (const item of distant) item.release()
      const remounted = test.mount(0, 90)
      await settle()
      expect(test.result.geometry.value.getItem(1)?.start).toBe(102)
      expect(test.result.motionRevision.value).toBe(originalMotion)
      // The current baseline includes ingress. A real mounted resize can still move it.
      remounted.element.rect.height = 100
      test.observers[0]!.notify([remounted.element.asElement()])
      await settle()
      expect(test.result.motionRevision.value).not.toBe(originalMotion)
      expect(test.result.motionRevision.value.rows.getRow(0)?.size).toBe(100)
      remounted.release()
    } finally {
      first.release()
      test.stop()
    }
  })

  it('recognizes mounted load reflow even after that mounted height was evicted', async () => {
    const test = setup(80, 1)
    const first = test.mount(0, 60)
    await settle()
    const originalMotion = test.result.motionRevision.value
    const others = Array.from({ length: 33 }, (_, index) => test.mount(index + 1, 40))
    await settle()
    try {
      expect(test.result.measurements.getHeight(0)).toBeUndefined()
      expect(test.result.motionRevision.value).toBe(originalMotion)
      first.element.rect.height = 90
      first.element.dispatchEvent(new Event('load'))
      await settle()
      expect(test.result.geometry.value.getItem(0)?.size).toBe(90)
      expect(test.result.motionRevision.value).not.toBe(originalMotion)
      first.element.rect.height = 30
      test.observers[0]!.notify([first.element.asElement()])
      await settle()
      expect(test.result.motionRevision.value.rows.getRow(0)?.size).toBe(30)
    } finally {
      first.release()
      for (const item of others) item.release()
      test.stop()
    }
  })

  it('keeps genuine retained-card and content reflow when the same batch includes ingress', async () => {
    const test = setup(10_000, 1)
    test.retainedIndexes.value = [9000]
    const retained = test.mount(9000, 60)
    await settle()
    const before = test.result.motionRevision.value
    const ingress = test.mount(0, 40)
    retained.element.rect.height = 90
    test.observers[0]!.notify([retained.element.asElement()])
    await settle()
    try {
      expect(test.result.geometry.value.getItem(1)?.start).toBe(52)
      expect(test.result.geometry.value.getItem(9000)?.size).toBe(90)
      const mixed = test.result.motionRevision.value
      expect(mixed).not.toBe(before)
      expect(mixed.rows.getRow(9000)?.size).toBe(90)
      // Content invalidation still remeasures the current mounted unit after ingress.
      test.items.value[9000]!.revision++
      retained.element.rect.height = 120
      await settle()
      expect(test.result.geometry.value.getItem(9000)?.size).toBe(120)
      expect(test.result.motionRevision.value).not.toBe(mixed)
      expect(test.result.motionRevision.value.rows.getRow(9000)?.size).toBe(120)
    } finally {
      retained.release()
      ingress.release()
      test.stop()
    }
  })

  it('never hands temporary width estimates to motion when natural heights differ from estimates', async () => {
    const test = setup(3)
    const measured = [test.mount(0, 60), test.mount(1, 60), test.mount(2, 60)]
    await settle()
    const original = test.result.motionRevision.value
    const motions: number[] = []
    const stop = watch(
      test.result.motionRevision,
      (revision) => motions.push(revision.rows.getRow(0)!.size),
      { flush: 'sync' },
    )
    try {
      for (const width of [980, 940, 900, 960, 1000]) {
        test.list.rect.width = width
        test.observers[0]!.notify([test.list.asElement()])
        // Old heights are discarded and mounted units re-read at this width before patch.
        expect(test.result.measurements.getHeight(0)).toBe(60)
        expect(test.result.measurements.heights.value.size).toBe(3)
        expect(test.result.motionRevision.value).toBe(original)
        // eslint-disable-next-line no-await-in-loop -- Inspect each complete resize batch.
        await settle()
        expect(test.result.measurements.isWidthMeasurementPending.value).toBe(false)
        expect(test.result.measurements.getHeight(0)).toBe(60)
        expect(test.result.motionRevision.value).toBe(original)
      }
      expect(motions).toEqual([])
      // A previously scheduled refresh may flush before the width's post watchers.
      // Its stale jobs cannot finish the newer motion batch or expose estimates.
      test.result.measurements.refresh()
      test.list.rect.width = 970
      test.observers[0]!.notify([test.list.asElement()])
      test.list.rect.width = 950
      test.observers[0]!.notify([test.list.asElement()])
      await settle()
      expect(motions).toEqual([])
      expect(test.result.measurements.isWidthMeasurementPending.value).toBe(false)
      for (const item of measured) item.element.rect.height = 90
      test.list.rect.width = 850
      test.observers[0]!.notify([test.list.asElement()])
      await settle()
      expect(motions).toEqual([])
      expect(test.result.geometry.value.getItem(0)?.size).toBe(90)
      // A later load at the same width remains independent spatial motion.
      measured[0]!.element.rect.height = 110
      test.observers[0]!.notify([measured[0]!.element.asElement()])
      await settle()
      expect(motions).toEqual([110])
    } finally {
      stop()
      for (const item of measured) item.release()
      test.stop()
    }
  })

  it('finishes empty width batches and does not hide regrouping, root replacement or disposal', async () => {
    const test = setup(3)
    const measured = [test.mount(0, 60), test.mount(1, 60), test.mount(2, 60)]
    await settle()
    try {
      const before = test.result.motionRevision.value
      test.list.rect.width = 900
      test.observers[0]!.notify([test.list.asElement()])
      test.columns.value = 1
      expect(test.result.motionRevision.value).not.toBe(before)
      await settle()
      for (const item of measured) item.release()
      test.list.rect.width = 850
      test.observers[0]!.notify([test.list.asElement()])
      await settle()
      expect(test.result.measurements.isWidthMeasurementPending.value).toBe(false)
      test.enabled.value = false
      await settle()
      test.enabled.value = true
      await settle()
      expect(test.result.measurements.cacheSize.value).toBe(0)
      test.list.rect.width = 800
      test.observers[0]!.notify([test.list.asElement()])
      test.stop()
      await settle()
      expect(test.result.measurements.cacheSize.value).toBe(0)
    } finally {
      test.stop()
    }
  })

  it('keeps CSS-only inline resizing out of FLIP while revising drag geometry and natural row changes', async () => {
    const test = setup(80)
    const measured = test.mount(0, 20)
    await settle()
    try {
      const motion = test.result.motionRevision.value
      let spatial = test.result.layoutRevision.value
      for (const width of [980, 940, 900, 960, 1000]) {
        test.list.rect.width = width
        test.observers[0]!.notify([test.list.asElement()])
        // eslint-disable-next-line no-await-in-loop -- A settled resize frame models continuous CSS width motion.
        await settle()
        expect(test.result.motionRevision.value).toBe(motion)
        expect(test.result.layoutRevision.value).not.toBe(spatial)
        expect(test.result.geometry.value.getItem(1)?.inlineStart).toBe((width - 24) / 3 + 12)
        spatial = test.result.layoutRevision.value
      }
      // Width can change the tallest natural height without changing the column count.
      measured.element.rect.height = 60
      test.list.rect.width = 850
      test.observers[0]!.notify([test.list.asElement(), measured.element.asElement()])
      await settle()
      const taller = test.result.motionRevision.value
      expect(taller).toBe(motion)
      expect(test.result.geometry.value.getItem(3)).toMatchObject({ start: 72, size: 20 })
      test.columns.value = 2
      await settle()
      const regrouped = test.result.motionRevision.value
      expect(regrouped).not.toBe(taller)
      test.gap.value = 18
      await settle()
      expect(test.result.motionRevision.value).not.toBe(regrouped)
    } finally {
      measured.release()
      test.stop()
    }
  })

  it('revises spatial layout only for changed geometry or ordered occurrences', async () => {
    const test = setup(80)
    await settle()
    try {
      const initial = test.result.layoutRevision.value
      const originalGeometry = test.result.geometry.value
      const measured = test.mount(0, 20)
      await settle()
      expect(test.result.layoutRevision.value).toBe(initial)
      test.items.value = test.items.value.map((item) => ({ ...item }))
      await settle()
      expect(test.result.layoutRevision.value).toBe(initial)
      expect(test.result.geometry.value).not.toBe(originalGeometry)
      expect(test.result.geometry.value.getItem(0)?.item).toBe(test.items.value[0])
      measured.element.rect.height = 50
      test.observers[0]!.notify([measured.element.asElement()])
      await settle()
      const taller = test.result.layoutRevision.value
      expect(taller).not.toBe(initial)
      test.list.rect.width = 600
      test.observers[0]!.notify([test.list.asElement()])
      await settle()
      const narrower = test.result.layoutRevision.value
      expect(narrower).not.toBe(taller)
      const [first, second, ...rest] = test.items.value
      test.items.value = [second!, first!, ...rest]
      await settle()
      expect(test.result.layoutRevision.value).not.toBe(narrower)
      measured.release()
    } finally {
      test.stop()
    }
  })

  it.each([
    { columns: 1, height: 180, size: 96 },
    { columns: 2, height: 800, size: 400 },
    { columns: 4, height: 1080, size: 144 },
    { columns: 8, height: 2160, size: 96 },
  ])(
    'derives the window from viewport and density: $columns columns, $height px',
    async ({ columns, height, size }) => {
      const test = setup(10_000, columns)
      test.root.clientHeight = height
      test.estimatedItemSize.value = size
      test.observers[0]!.notify([test.root.asElement()])
      await settle()
      const budget = columns * (Math.ceil(height / (size + 12)) + 1 + 4)
      try {
        const counts: number[] = []
        for (const offset of [0, 20_000, test.result.totalSize.value - height, 0]) {
          test.root.scrollTop = offset
          test.root.dispatchEvent(new Event('scroll'))
          // eslint-disable-next-line no-await-in-loop -- Assert each viewport independently.
          await settle()
          const mounted = test.result.virtualItems.value
          counts.push(mounted.length)
          expect(mounted.length).toBeLessThanOrEqual(budget)
          const keys = new Set(mounted.map((item) => item.key))
          const geometry = test.result.geometry.value
          const origin = test.result.context.metrics.value.listOffset
          const first = geometry.findItemAtOffset(Math.max(0, offset - origin))
          for (let index = first?.index ?? 0; index < geometry.count; index++) {
            const item = geometry.getItem(index)!
            if (item.start + origin >= offset + height) break
            if (item.end + origin > offset)
              expect(
                keys.has(item.key),
                JSON.stringify({ offset, index, origin, mounted: mounted.map((row) => row.index) }),
              ).toBe(true)
          }
        }
        expect(counts[3]).toBe(counts[0])
        if (columns === 8) expect(counts[1]).toBeGreaterThan(50)
        const before = test.result.virtualItems.value.length
        test.root.clientHeight = height * 2
        test.observers[0]!.notify([test.root.asElement()])
        await settle()
        expect(test.result.virtualItems.value.length).toBeGreaterThan(before)
      } finally {
        test.stop()
      }
    },
  )

  it.each([0, 1, 80, 1000, 10000])(
    'bounds the rendered window and compressed CSS rows for %i cells',
    async (count) => {
      const test = setup(count)
      await settle()
      try {
        expect(test.result.count.value).toBe(count)
        expect(test.result.virtualItems.value).toHaveLength(Math.min(count, 18))
        expect(test.result.totalSize.value).toBe(
          Math.ceil(count / 3) * 20 + Math.max(0, Math.ceil(count / 3) - 1) * 12,
        )
        expect(test.result.renderLayout.value.templateRows.split(' ').length).toBeLessThanOrEqual(7)
        expect(test.observers).toHaveLength(1)
        expect(test.observers[0]!.observe).toHaveBeenCalledTimes(2)
      } finally {
        test.stop()
      }
      expect(test.observers[0]!.disconnect).toHaveBeenCalledTimes(1)
    },
  )

  it('uses the natural tallest cell per row, including shrink and a partial final row', async () => {
    const test = setup(8)
    const first = test.mount(0, 30),
      second = test.mount(1, 50),
      third = test.mount(2, 10)
    const last = test.mount(6, 8),
      final = test.mount(7, 9)
    await settle()
    try {
      expect(test.result.totalSize.value).toBe(103)
      expect(test.result.geometry.value.getItem(3)).toMatchObject({
        start: 62,
        size: 20,
        rowIndex: 1,
        columnIndex: 0,
      })
      expect(test.result.geometry.value.getItem(7)).toMatchObject({
        start: 94,
        size: 9,
        rowIndex: 2,
        columnIndex: 1,
      })
      second.element.rect.height = 8
      test.observers[0]!.notify([second.element.asElement()])
      await settle()
      expect(test.result.totalSize.value).toBe(83)
      first.element.rect.height = 5
      test.observers[0]!.notify([first.element.asElement()])
      await settle()
      expect(test.result.totalSize.value).toBe(63)
      expect(test.root.scrollTop).toBe(0)
      expect(test.result.virtualItems.value.map((item) => item.key)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7,
      ])
    } finally {
      first.release()
      second.release()
      third.release()
      last.release()
      final.release()
      test.stop()
    }
  })

  it('updates column widths and invalidates heights on regrouping, density and measured width', async () => {
    const test = setup(8)
    const cell = test.mount(0, 50)
    await settle()
    try {
      expect(test.result.geometry.value.getItem(1)).toMatchObject({
        inlineStart: (1000 - 24) / 3 + 12,
        inlineSize: (1000 - 24) / 3,
      })
      const old = test.result.geometry.value
      test.columns.value = 2
      cell.element.rect.height = 18
      await settle()
      expect(old.getItem(2)).toMatchObject({ rowIndex: 0, columnIndex: 2, start: 0, size: 50 })
      expect(test.result.geometry.value.getItem(2)).toMatchObject({
        rowIndex: 1,
        columnIndex: 0,
        start: 32,
      })
      expect(test.result.geometry.value.getItem(1)).toMatchObject({
        inlineStart: 506,
        inlineSize: 494,
      })
      test.layoutGeneration.value = 'comfortable'
      cell.element.rect.height = 12
      await settle()
      expect(test.result.measurements.getHeight(0)).toBe(12)
      test.list.rect.width = 400
      cell.element.rect.height = 30
      test.observers[0]!.notify([test.list.asElement()])
      await settle()
      expect(test.result.geometry.value.getItem(1)).toMatchObject({
        inlineStart: 206,
        inlineSize: 194,
      })
      expect(test.result.measurements.getHeight(0)).toBe(30)
    } finally {
      cell.release()
      test.stop()
    }
  })

  it('has indexed semantic geometry and does not scan keys or read elements when scrolling', async () => {
    const test = setup(10000)
    await settle()
    try {
      const initial = test.result.geometry.value
      test.getItemKey.mockClear()
      test.root.getBoundingClientRect.mockClear()
      test.list.getBoundingClientRect.mockClear()
      test.root.scrollTop = 50000
      test.root.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.result.geometry.value).toBe(initial)
      expect(initial.indexOf(9999)).toBe(9999)
      expect(initial.findItemAtOffset(320)).toMatchObject({ key: 30, rowIndex: 10 })
      expect(initial.getItem(-1)).toBeUndefined()
      expect(initial.getItem(10000)).toBeUndefined()
      expect(test.result.virtualItems.value.length).toBeLessThanOrEqual(24)
      expect(test.result.virtualItems.value[0]!.index).toBeGreaterThan(4000)
      expect(test.getItemKey).not.toHaveBeenCalled()
      expect(test.root.getBoundingClientRect).not.toHaveBeenCalled()
      expect(test.list.getBoundingClientRect).not.toHaveBeenCalled()
    } finally {
      test.stop()
    }
  })

  it('represents each remote retained row and every missing interval without N CSS tracks', async () => {
    const test = setup(10000)
    test.root.scrollTop = 32000
    test.root.dispatchEvent(new Event('scroll'))
    test.retainedIndexes.value = [0, 9999, -1, 10000, 9999]
    await settle()
    try {
      const rendered = test.result.virtualItems.value
      expect(rendered.some((item) => item.key === 0)).toBe(true)
      expect(rendered.some((item) => item.key === 9999)).toBe(true)
      const logicalRows = [...new Set(rendered.map((item) => item.rowIndex))]
      const layout = test.result.renderLayout.value
      expect(layout.templateRows.split(' ').length).toBeLessThanOrEqual(logicalRows.length * 2 + 1)
      expect(layout.gridRows.size).toBe(logicalRows.length)
      expect(layout.gridRows.get(0)).toBe(1)
      expect(rendered.every((item) => layout.gridRows.has(item.rowIndex))).toBe(true)
      // Auto tracks use the injected natural 20px row height; omitted intervals include all
      // internal gaps, and the real CSS gap supplies exactly one gap between emitted tracks.
      const tracks = layout.templateRows.split(' ')
      const extent =
        tracks.reduce(
          (size, track) => size + (track === 'auto' ? 20 : Number.parseFloat(track)),
          0,
        ) +
        (tracks.length - 1) * 12
      expect(extent).toBe(test.result.totalSize.value)
      test.retainedIndexes.value = []
      await settle()
      expect(
        test.result.virtualItems.value.some((item) => item.key === 0 || item.key === 9999),
      ).toBe(false)
    } finally {
      test.stop()
    }
  })

  it('rebuilds semantic geometry for reorder/content edits without losing occurrence identity', async () => {
    const test = setup(8)
    const cell = test.mount(0, 50)
    await settle()
    try {
      const previous = test.items.value
      test.items.value = [previous[7]!, ...previous.slice(0, 7)]
      cell.element.rect.height = 10
      test.items.value[1]!.revision++
      await settle()
      expect(test.result.geometry.value.indexOf(0)).toBe(1)
      expect(test.result.geometry.value.getItem(0)?.key).toBe(7)
      expect(test.result.measurements.getHeight(0)).toBe(10)
      test.enabled.value = false
      await settle()
      expect(test.result.virtualItems.value).toEqual([])
      expect(test.result.totalSize.value).toBeGreaterThan(0)
      test.enabled.value = true
      await settle()
      expect(test.result.virtualItems.value.length).toBeGreaterThan(0)
    } finally {
      cell.release()
      test.stop()
    }
  })

  it('discards offscreen stretched heights when a key moves to different row siblings', async () => {
    const test = setup(80)
    const first = test.mount(0, 100),
      sibling = test.mount(1, 100)
    await settle()
    first.release()
    sibling.release()
    expect(test.result.measurements.getHeight(1)).toBe(100)
    try {
      const previous = test.items.value
      test.items.value = [
        previous[0]!,
        previous[3]!,
        previous[4]!,
        previous[1]!,
        previous[2]!,
        previous[5]!,
        ...previous.slice(6),
      ]
      await settle()
      expect(test.result.measurements.cacheSize.value).toBe(0)
      expect(test.result.geometry.value.getItem(3)).toMatchObject({ key: 1, start: 32, size: 20 })
      const moved = test.mount(1, 10),
        smallSibling = test.mount(2, 12),
        otherSibling = test.mount(5, 11)
      await settle()
      expect(test.result.geometry.value.getItem(3)).toMatchObject({ key: 1, size: 12 })
      moved.release()
      smallSibling.release()
      otherSibling.release()
    } finally {
      test.stop()
    }
  })
})
