import { describe, expect, it, vi } from 'vitest'

import { createDomGridReorderGeometry } from '../../src/composables/dom-grid-reorder-geometry'
import type { GridReorderGeometryInput } from '../../src/composables/grid-reorder-geometry'

function rect(left: number, top: number, width = 100, height = 100): DOMRect {
  return { left, top, width, height } as DOMRect
}

function createTest(
  ids: readonly string[],
  eligibleIds: readonly string[] = ids,
  positions = ids.map((_, index) => rect(20 + (index % 2) * 110, 30 + Math.floor(index / 2) * 110)),
) {
  const elements = ids.map((id, index) => ({
    dataset: { queueDropId: id },
    getBoundingClientRect: vi.fn(() => positions[index]!),
  }))
  const container = {
    scrollTop: 90,
    getBoundingClientRect: vi.fn(() => rect(20, 30, 300, 400)),
    querySelectorAll: vi.fn(() => elements),
  }
  const input: GridReorderGeometryInput<'track' | 'platform'> = {
    kind: 'track',
    sourceId: ids[0]!,
    ids,
    eligibleIds: new Set(eligibleIds),
    container: container as unknown as HTMLElement,
    bounds: rect(20, 30, 300, 400),
    initialScrollTop: 90,
  }
  return { input, container, elements }
}

describe('DOM grid reorder geometry', () => {
  it.each([0, 50])(
    'refreshes heights after ancestor and own scrolling (%s), preserving the capture coordinates',
    (ownScroll) => {
      const positions = [rect(20, 30), rect(130, 30), rect(20, 140)]
      const test = createTest(['a', 'b', 'c'], undefined, positions)
      test.input.sourceId = 'c'
      const geometry = createDomGridReorderGeometry(test.input, { attributePrefix: 'queue' })!
      const original = geometry.sourceSlot
      test.container.scrollTop += ownScroll
      test.container.getBoundingClientRect.mockReturnValue(rect(20, -170, 300, 430))
      positions[0] = rect(20, -170 - ownScroll, 100, 130)
      positions[1] = rect(130, -170 - ownScroll, 100, 130)
      positions[2] = rect(20, -30 - ownScroll)
      expect(geometry.refreshHeight?.()).toBe(true)
      expect(original.top).toBe(110)
      expect(geometry.sourceSlot).not.toBe(original)
      expect(geometry.sourceSlot.top).toBe(140)
      expect(geometry.findSlot(50, 180)?.id).toBe('c')
      expect([...geometry.getOffsets('a')]).toEqual([
        ['b', { x: -110, y: 140 }],
        ['a', { x: 110, y: 0 }],
      ])
      // No repeated selector query or per-pointer measurements after the accepted refresh.
      geometry.getOffsets('b')
      geometry.findSlot(50, 180)
      expect(test.container.querySelectorAll).toHaveBeenCalledOnce()
      for (const element of test.elements)
        expect(element.getBoundingClientRect).toHaveBeenCalledTimes(2)
    },
  )

  it('rejects inline topology changes atomically during a height refresh', () => {
    const positions = [rect(20, 30), rect(130, 30), rect(20, 140)]
    const test = createTest(['a', 'b', 'c'], undefined, positions)
    const geometry = createDomGridReorderGeometry(test.input, { attributePrefix: 'queue' })!
    const original = geometry.sourceSlot
    positions[0] = rect(20, 30, 100, 130)
    positions[1] = rect(150, 30)
    expect(geometry.refreshHeight?.()).toBe(false)
    expect(geometry.sourceSlot).toBe(original)
    expect(geometry.sourceSlot.height).toBe(100)
  })

  it('uses caller ID order, skips absent slots and excludes unrelated DOM children', () => {
    const test = createTest(['a', 'b', 'c'])
    test.input.ids = ['c', 'missing', 'a']
    test.input.sourceId = 'c'
    const geometry = createDomGridReorderGeometry(test.input, { attributePrefix: 'queue' })!

    expect(test.container.querySelectorAll).toHaveBeenCalledExactlyOnceWith(
      '[data-queue-drop-kind="track"]',
    )
    expect(geometry.sourceElement).toBe(test.elements[2])
    expect(geometry.sourceSlot).toEqual({ id: 'c', left: 0, top: 110, width: 100, height: 100 })
    expect(geometry.findSlot(50, 105)?.id).toBe('c')
    expect([...geometry.getOffsets('a')]).toEqual([['a', { x: 0, y: 110 }]])
    expect(test.elements[1]!.getBoundingClientRect).not.toHaveBeenCalled()
  })

  it('keeps source-relative two-dimensional offsets and reuses the initial measurements', () => {
    const test = createTest(['a', 'b', 'c', 'd'])
    const geometry = createDomGridReorderGeometry(test.input, { attributePrefix: 'queue' })!
    expect(geometry.findSlot(160, 160)?.id).toBe('d')
    expect([...geometry.getOffsets('d')]).toEqual([
      ['b', { x: -110, y: 0 }],
      ['c', { x: 110, y: -110 }],
      ['d', { x: -110, y: 0 }],
    ])
    expect(geometry.getOffsets(undefined).size).toBe(0)
    expect(geometry.getOffsets('a').size).toBe(0)
    geometry.findSlot(50, 50)
    geometry.getOffsets('c')
    for (const element of test.elements)
      expect(element.getBoundingClientRect).toHaveBeenCalledOnce()
    expect(geometry.domain).toBeUndefined()
  })

  it('preserves the original ID order when slot centers are equidistant', () => {
    const test = createTest(['a', 'b'])
    test.input.ids = ['b', 'a']
    const geometry = createDomGridReorderGeometry(test.input, { attributePrefix: 'queue' })!
    expect(geometry.findSlot(105, 50)?.id).toBe('b')
  })

  it('filters group candidates unless mismatch reporting requires them', () => {
    const test = createTest(['a', 'b', 'c'], ['a', 'c'])
    const sameGroup = createDomGridReorderGeometry(test.input, { attributePrefix: 'queue' })!
    expect(sameGroup.findSlot(160, 50)?.id).toBe('a')
    expect(test.elements[1]!.getBoundingClientRect).not.toHaveBeenCalled()
    expect([...sameGroup.getOffsets('c')]).toEqual([['c', { x: 0, y: -110 }]])

    const allGroups = createDomGridReorderGeometry(test.input, {
      attributePrefix: 'queue',
      includeOtherGroups: true,
    })!
    expect(allGroups.findSlot(160, 50)?.id).toBe('b')
    expect([...allGroups.getOffsets('c')]).toEqual([['c', { x: 0, y: -110 }]])
    expect(allGroups.getOffsets('b').size).toBe(0)
    expect(allGroups.getOffsets('missing').size).toBe(0)
  })

  it('measures the source group domain in capture-root coordinates', () => {
    const test = createTest(['a', 'b'])
    const group = { getBoundingClientRect: vi.fn(() => rect(25, 40, 270, 320)) }
    const getGroupElement = vi.fn(() => group as unknown as HTMLElement)
    const geometry = createDomGridReorderGeometry(test.input, {
      attributePrefix: 'queue',
      getGroupElement,
    })!
    expect(getGroupElement).toHaveBeenCalledExactlyOnceWith('track', test.elements[0])
    expect(geometry.domain).toEqual({ id: '', left: 5, top: 10, width: 270, height: 320 })
    expect(group.getBoundingClientRect).toHaveBeenCalledOnce()
  })

  it('uses vertical block offsets only when explicitly requested, in both directions', () => {
    const test = createTest(
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      [rect(20, 30, 300, 100), rect(20, 140, 300, 200), rect(20, 350, 300, 300)],
    )
    test.input.kind = 'platform'
    const forward = createDomGridReorderGeometry(test.input, {
      attributePrefix: 'queue',
      vertical: true,
    })!
    expect([...forward.getOffsets('c')]).toEqual([
      ['b', { x: 0, y: -110 }],
      ['c', { x: 0, y: -110 }],
    ])
    test.input.sourceId = 'c'
    const backward = createDomGridReorderGeometry(test.input, {
      attributePrefix: 'queue',
      vertical: true,
    })!
    expect([...backward.getOffsets('a')]).toEqual([
      ['b', { x: 0, y: 310 }],
      ['a', { x: 0, y: 310 }],
    ])

    const gridTest = createTest(['a', 'b', 'c'])
    gridTest.input.kind = 'platform'
    const grid = createDomGridReorderGeometry(gridTest.input, { attributePrefix: 'queue' })!
    expect([...grid.getOffsets('b')]).toEqual([['b', { x: -110, y: 0 }]])
  })

  it('does not start without a mounted eligible source slot', () => {
    const missing = createTest(['a', 'b'])
    missing.input.sourceId = 'missing'
    expect(
      createDomGridReorderGeometry(missing.input, { attributePrefix: 'queue' }),
    ).toBeUndefined()
    const excluded = createTest(['a', 'b'], ['b'])
    expect(
      createDomGridReorderGeometry(excluded.input, {
        attributePrefix: 'queue',
        includeOtherGroups: true,
      }),
    ).toBeUndefined()
  })
})
