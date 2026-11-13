import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import type { GridReorderGeometryInput } from '../../../src/composables/grid-reorder-geometry'
import {
  findQueueReorderSlot,
  getQueueReorderOffsets,
  type QueueReorderSlot,
} from '../../../src/composables/music-sources/queue-reorder-geometry'
import { useMeasuredVirtualGrid } from '../../../src/composables/virtual-scroll/use-measured-virtual-grid'
import {
  createVirtualGridReorderGeometry,
  type VirtualGridReorderOptions,
} from '../../../src/composables/virtual-scroll/virtual-grid-reorder-geometry'
import { createVirtualRowGeometry } from '../../../src/composables/virtual-scroll/virtual-row-geometry'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settleMeasurements() {
  await nextTick()
  await nextTick()
  await nextTick()
}

function fixture({
  count = 10,
  columns = 3,
  direction = 'ltr',
  eligible = (_index: number) => true,
  includeOtherGroups = true,
  getRowSize = (index: number) => 30 + (index % 3) * 15,
  columnGap = 12,
  listWidth = 324,
  origin = { left: 27, top: -113 },
}: {
  count?: number
  columns?: number
  direction?: 'ltr' | 'rtl'
  eligible?: (index: number) => boolean
  includeOtherGroups?: boolean
  getRowSize?: (index: number) => number
  columnGap?: number
  listWidth?: number
  origin?: { left: number; top: number }
} = {}) {
  const ids = Array.from({ length: count }, (_, index) => `occurrence-${index}`)
  const rows = createVirtualRowGeometry({
    count,
    columns,
    rowGap: 9,
    paddingStart: 17,
    paddingEnd: 13,
    getRowSize,
  })
  const inlineSize = Math.max(0, (listWidth - (columns - 1) * columnGap) / columns)
  const geometry = {
    count,
    getItem: vi.fn((index: number) => {
      const position = rows.getItemPosition(index)
      if (!position) return
      const row = rows.getRow(position.rowIndex)!
      return {
        key: ids[index]!,
        index,
        ...position,
        start: row.start,
        size: row.size,
        inlineStart: position.columnIndex * (inlineSize + columnGap),
        inlineSize,
      }
    }),
  }
  const sourceElement = { isConnected: true } as HTMLElement
  const input: GridReorderGeometryInput<'track'> = {
    kind: 'track',
    sourceId: ids.find((_id, index) => eligible(index)) ?? 'absent',
    ids,
    eligibleIds: new Set(ids.filter((_id, index) => eligible(index))),
    container: {
      querySelectorAll: vi.fn(() => {
        throw new Error('Virtual destination lookup must not enumerate DOM')
      }),
    } as unknown as HTMLElement,
    bounds: { left: 80, top: 140 } as DOMRect,
    initialScrollTop: 500,
  }
  let mountedIds = ids.slice(0, 6)
  const options: VirtualGridReorderOptions = {
    geometry,
    columns,
    direction,
    listWidth,
    origin,
    sourceElement,
    mountedIds: () => mountedIds,
    includeOtherGroups,
  }
  const slots: QueueReorderSlot[] = ids.map((id, index) => {
    const item = geometry.getItem(index)!
    return {
      id,
      left:
        origin.left +
        (direction === 'rtl' ? listWidth - item.inlineStart - item.inlineSize : item.inlineStart),
      top: origin.top + item.start,
      width: item.inlineSize,
      height: item.size,
    }
  })
  return {
    ids,
    input,
    options,
    geometry,
    slots,
    setMountedIds: (next: readonly string[]) => {
      mountedIds = [...next]
    },
    create: () => createVirtualGridReorderGeometry(input, options),
  }
}

describe('virtual grid reorder geometry', () => {
  it('refreshes its derived index once per spatial generation and rejects horizontal or identity replacement', () => {
    const test = fixture({ count: 80 })
    const next = fixture({ count: 80, getRowSize: () => 90 })
    let geometry = test.geometry
    let revision = 0
    test.options.getGeometry = () => geometry
    test.options.getGeometryRevision = () => revision
    const session = test.create()!
    test.geometry.getItem.mockClear()
    geometry = { ...test.geometry }
    expect(session.isValid?.()).toBe(true)
    expect(test.geometry.getItem).not.toHaveBeenCalled()
    geometry = next.geometry
    revision++
    expect(session.isValid?.()).toBe(true)
    expect(session.sourceSlot.height).toBe(90)
    const remote = next.slots[79]!
    next.geometry.getItem.mockClear()
    for (let count = 0; count < 4; count++)
      expect(
        session.findSlot(remote.left + remote.width / 2, remote.top + remote.height / 2)?.id,
      ).toBe(remote.id)
    expect(next.geometry.getItem).toHaveBeenCalledTimes(4)
    geometry = fixture({ count: 80, listWidth: 600 }).geometry
    revision++
    expect(session.isValid?.()).toBe(false)
    geometry = test.geometry
    revision++
    expect(session.isValid?.()).toBe(false)

    const replacement = fixture({ count: 80 })
    let replace = replacement.geometry
    replacement.options.getGeometry = () => replace
    const stale = replacement.create()!
    replace = {
      count: 80,
      getItem: vi.fn((index: number) => ({
        ...replacement.geometry.getItem(index)!,
        key: 'replacement',
      })),
    }
    expect(stale.isValid?.()).toBe(false)
    expect(stale.findSlot(10, 10)).toBeUndefined()
    expect(stale.getOffsets(replacement.ids[79]).size).toBe(0)
  })

  it('consumes actual immutable measured-grid snapshots after shrink, controlled reorder and regrouping', async () => {
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document),
      list = new VirtualElement(env.document)
    root.clientHeight = 100
    root.scrollTop = 0
    list.rect.top = 12
    list.rect.width = 1000
    const ids = shallowRef(Array.from({ length: 80 }, (_, index) => `occurrence-${index}`))
    const columns = shallowRef(3)
    const scope = effectScope()
    const grid = scope.run(() =>
      useMeasuredVirtualGrid({
        items: ids,
        columns,
        gap: 12,
        columnGap: 12,
        getItemKey: (id) => id,
        getContentGeneration: () => 0,
        estimatedItemSize: 20,
        scrollElement: root.asElement(),
        listElement: list.asElement(),
      }),
    )!
    const measured = [30, 50, 10].map((height, index) => {
      const element = new VirtualElement(env.document)
      element.rect.height = height
      return {
        element,
        release: grid.measurements.observeItem(ids.value[index]!, element.asElement()),
      }
    })
    const input: GridReorderGeometryInput<'track'> = {
      kind: 'track',
      sourceId: ids.value[0]!,
      ids: [...ids.value],
      eligibleIds: new Set(ids.value),
      container: list.asElement(),
      bounds: list.getBoundingClientRect(),
      initialScrollTop: 0,
    }
    function options(): VirtualGridReorderOptions {
      return {
        geometry: grid.geometry.value,
        columns: columns.value,
        listWidth: grid.context.metrics.value.listWidth,
        origin: { left: 0, top: 0 },
        sourceElement: measured[0]!.element.asElement(),
        mountedIds: () => grid.virtualItems.value.map((item) => item.key as string),
      }
    }
    try {
      await settleMeasurements()
      const first = createVirtualGridReorderGeometry(input, options())!
      expect(first.sourceSlot.height).toBe(50)
      const remote = grid.geometry.value.getItem(79)!
      expect(grid.virtualItems.value.some((item) => item.index === 79)).toBe(false)
      expect(
        first.findSlot(remote.inlineStart + remote.inlineSize / 2, remote.start + remote.size / 2)
          ?.id,
      ).toBe(ids.value[79])
      measured[1]!.element.rect.height = 8
      env.observers[0]!.notify([measured[1]!.element.asElement()])
      await settleMeasurements()
      const shrunk = createVirtualGridReorderGeometry(input, options())!
      expect(first.sourceSlot.height).toBe(50)
      expect(shrunk.sourceSlot.height).toBe(30)
      ids.value = ids.value.toReversed()
      await settleMeasurements()
      expect(createVirtualGridReorderGeometry(input, options())).toBeUndefined()
      input.ids = [...ids.value]
      const reordered = createVirtualGridReorderGeometry(input, options())!
      expect(reordered.sourceSlot.id).toBe(input.sourceId)
      expect(reordered.sourceSlot.top).toBeGreaterThan(0)
      columns.value = 2
      await settleMeasurements()
      expect(createVirtualGridReorderGeometry(input, { ...options(), columns: 3 })).toBeUndefined()
      const regrouped = createVirtualGridReorderGeometry(input, options())!
      expect(regrouped.sourceSlot.width).toBe(494)
      expect(first.sourceSlot.width).toBe((1000 - 24) / 3)
      expect(env.observers).toHaveLength(1)
    } finally {
      measured.forEach((cell) => cell.release())
      scope.stop()
    }
    expect(env.observers[0]!.disconnect).toHaveBeenCalledOnce()
  })

  it.each(['ltr', 'rtl'] as const)(
    'matches nearest-center DOM geometry across variable rows, gaps and final partial rows (%s)',
    (direction) => {
      const test = fixture({ count: 80, direction })
      const session = test.create()!
      for (let y = -180; y <= 1500; y += 23) {
        for (let x = -120; x <= 500; x += 29)
          expect(session.findSlot(x, y)).toEqual(findQueueReorderSlot(test.slots, x, y))
      }
      expect(session.sourceElement).toBe(test.options.sourceElement)
      expect(test.input.container.querySelectorAll).not.toHaveBeenCalled()
    },
  )

  it('compares the previous full row when the closest vertical row has a missing column', () => {
    const test = fixture({ count: 4, getRowSize: () => 20 })
    const session = test.create()!
    const last = test.slots[3]!,
      third = test.slots[2]!
    expect(session.findSlot(third.left + third.width / 2, last.top + last.height / 2)?.id).toBe(
      third.id,
    )
  })

  it.each(['ltr', 'rtl'] as const)(
    'breaks horizontal and vertical equal-distance ties in original ID order (%s)',
    (direction) => {
      const test = fixture({ count: 6, direction, getRowSize: () => 20 })
      const session = test.create()!
      const [a, b, , d] = test.slots
      expect(session.findSlot((a!.left + b!.left + a!.width) / 2, a!.top + 10)?.id).toBe(a!.id)
      expect(session.findSlot(a!.left + a!.width / 2, (a!.top + d!.top) / 2 + 10)?.id).toBe(a!.id)
    },
  )

  it('preserves the first occurrence when zero-size columns or rows overlap', () => {
    const test = fixture({ count: 9, listWidth: 0, columnGap: 0, getRowSize: () => 0 })
    const session = test.create()!
    for (let y = -180; y < 20; y += 3)
      expect(session.findSlot(50, y)).toEqual(findQueueReorderSlot(test.slots, 50, y))
  })

  it.each([true, false])(
    'preserves eligible holes and reports raw cross-group candidates only when requested (%s)',
    (includeOtherGroups) => {
      const test = fixture({
        count: 80,
        eligible: (index) => index % 4 === 0 || index % 7 === 0,
        includeOtherGroups,
      })
      const session = test.create()!
      const candidates = test.slots.filter(
        (slot) => includeOtherGroups || test.input.eligibleIds.has(slot.id),
      )
      for (let y = -200; y < 1400; y += 41) {
        for (let x = -100; x < 500; x += 47)
          expect(session.findSlot(x, y)).toEqual(findQueueReorderSlot(candidates, x, y))
      }
      const other = test.slots[1]!
      if (includeOtherGroups)
        expect(
          session.findSlot(other.left + other.width / 2, other.top + other.height / 2)?.id,
        ).toBe(other.id)
      expect(session.getOffsets(other.id).size).toBe(0)
    },
  )

  it.each([false, true])(
    'computes complete same-group ordering but styles only mounted neighbors in both directions (vertical %s)',
    (vertical) => {
      const test = fixture({ count: 80, columns: vertical ? 1 : 3, eligible: (i) => i % 3 !== 1 })
      test.options.vertical = vertical
      const eligibleSlots = test.slots.filter((slot) => test.input.eligibleIds.has(slot.id))
      for (const [sourceRank, targetRank] of [
        [1, eligibleSlots.length - 2],
        [eligibleSlots.length - 2, 1],
      ]) {
        test.input.sourceId = eligibleSlots[sourceRank!]!.id
        const targetId = eligibleSlots[targetRank!]!.id
        const mounted = [eligibleSlots[2]!.id, eligibleSlots[17]!.id, targetId, 'stale', targetId]
        test.setMountedIds(mounted)
        const session = test.create()!
        const expected = getQueueReorderOffsets(
          eligibleSlots,
          sourceRank!,
          targetRank!,
          vertical ? 'platform' : 'track',
        )
        expect(session.getOffsets(targetId)).toEqual(
          new Map([...expected].filter(([id]) => mounted.includes(id))),
        )
        expect(session.getOffsets(undefined).size).toBe(0)
        expect(session.getOffsets(test.input.sourceId).size).toBe(0)
        expect(session.getOffsets('stale').size).toBe(0)
      }
    },
  )

  it('queries 10,000 identities beyond the original window without full DOM or geometry reads per query', () => {
    const test = fixture({ count: 10_000 })
    const session = test.create()!
    test.geometry.getItem.mockClear()
    for (const index of [0, 400, 1234, 5000, 9500, 9999]) {
      const slot = test.slots[index]!
      expect(session.findSlot(slot.left + slot.width / 2, slot.top + slot.height / 2)?.id).toBe(
        slot.id,
      )
    }
    expect(test.geometry.getItem).toHaveBeenCalledTimes(6)
    expect(test.input.container.querySelectorAll).not.toHaveBeenCalled()
    test.geometry.getItem.mockClear()
    test.setMountedIds(test.ids.slice(9990, 10_000))
    expect(session.getOffsets(test.ids[9999]).size).toBe(10)
    expect(test.geometry.getItem.mock.calls.length).toBeLessThanOrEqual(21)
  })

  it('uses an explicit list-local origin once for headers, ancestor scrolling and capture-root self scrolling', () => {
    const test = fixture({ count: 1, origin: { left: 19, top: -325 } })
    const session = test.create()!
    expect(session.sourceSlot).toEqual(test.slots[0])
    expect(session.sourceSlot.left).toBe(19)
    expect(session.sourceSlot.top).toBe(-325 + 17)
    expect(session.findSlot(19, -325 + 17)?.id).toBe(test.ids[0])
    expect(test.input.bounds.top).toBe(140)
    expect(test.input.initialScrollTop).toBe(500)
  })

  it('carries the supplied domain and keeps immutable source geometry separate from mounted-window changes', () => {
    const test = fixture({ count: 80 })
    test.options.domain = { left: 0, top: 0, width: 320, height: 5000 }
    const session = test.create()!
    expect(session.domain).toBe(test.options.domain)
    const before = { ...session.sourceSlot }
    test.setMountedIds([test.ids[79]!])
    expect([...session.getOffsets(test.ids[79]).keys()]).toEqual([test.ids[79]])
    test.setMountedIds([])
    expect(session.getOffsets(test.ids[79]).size).toBe(0)
    expect(session.sourceSlot).toEqual(before)
  })

  it.each([
    'empty',
    'missing-source',
    'ineligible-source',
    'count',
    'key',
    'index',
    'duplicate',
    'detached',
  ])('does not create a session for a stale or unavailable snapshot (%s)', (condition) => {
    const test = fixture({ count: condition === 'empty' ? 0 : 6 })
    if (condition === 'missing-source') test.input.sourceId = 'missing'
    if (condition === 'ineligible-source') test.input.eligibleIds = new Set()
    if (condition === 'count') test.options.geometry = { ...test.geometry, count: 5 }
    if (condition === 'key' || condition === 'index') {
      const getItem = test.geometry.getItem
      test.options.geometry = {
        count: 6,
        getItem: (index) => ({
          ...getItem(index)!,
          ...(condition === 'key' ? { key: 'stale' } : { index: index + 1 }),
        }),
      }
    }
    if (condition === 'duplicate') test.input.ids = Array(6).fill(test.ids[0]!)
    if (condition === 'detached') test.options.sourceElement = { isConnected: false } as HTMLElement
    expect(test.create()).toBeUndefined()
  })

  it('ignores nonfinite pointer positions and rejects invalid layout configuration', () => {
    const test = fixture()
    const session = test.create()!
    expect(session.findSlot(NaN, 10)).toBeUndefined()
    expect(session.findSlot(10, Infinity)).toBeUndefined()
    expect(session.findSlot(1e308, 1e308)).toBeUndefined()
    for (const patch of [
      { columns: 0 },
      { columns: 1.5 },
      { listWidth: -1 },
      { listWidth: Infinity },
      { origin: { left: NaN, top: 0 } },
    ])
      expect(() =>
        createVirtualGridReorderGeometry(test.input, { ...test.options, ...patch }),
      ).toThrow(RangeError)
  })
})
