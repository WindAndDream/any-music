import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, watch } from 'vue'
import type { CSSProperties, EffectScope } from 'vue'

import { useGridReorder } from '../../../src/composables/use-grid-reorder'
import { useMeasuredVirtualGrid } from '../../../src/composables/virtual-scroll/use-measured-virtual-grid'
import { useVirtualItemRetention } from '../../../src/composables/virtual-scroll/use-virtual-item-retention'
import { createVirtualGridReorderGeometry } from '../../../src/composables/virtual-scroll/virtual-grid-reorder-geometry'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

interface Item {
  id: string
  title: string
}

const scopes: EffectScope[] = []
let frames: Map<number, FrameRequestCallback>

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  let frameId = 0
  vi.stubGlobal('ResizeObserver', undefined)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '340ms' }))
})

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

function runFrame() {
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback(16)
}

function pointer(x: number, y: number): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

function translation(style: CSSProperties | undefined) {
  const match = String(style?.transform).match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\)/)
  if (!match) throw new Error(`Expected an explicit translation, received ${style?.transform}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

/** Real measured geometry and leases; motion boxes explicitly represent interrupted CSS frames. */
function setup(grouped = false) {
  const env = createResizeEnvironment()
  Object.assign(env.view, { innerHeight: 600 })
  vi.stubGlobal('window', env.view)
  const root = new VirtualElement(env.document)
  const list = new VirtualElement(env.document)
  root.scrollTop = 0
  root.clientHeight = 400
  root.clientTop = root.clientLeft = 0
  root.rect = { left: 0, top: 0, width: 300, height: 400 }
  list.rect = { left: 0, top: 0, width: 300, height: 24_990 }
  const items = shallowRef<Item[]>(
    Array.from({ length: 1000 }, (_, index) => ({ id: String(index), title: `Track ${index}` })),
  )
  const retained = shallowRef<ReturnType<typeof useVirtualItemRetention>>()
  let grid: ReturnType<typeof useMeasuredVirtualGrid<Item>>
  const mounted = new Map<string, ReturnType<typeof createRow>>()
  const captured = new Set<number>()
  const attributes = new Set<string>()
  const holds: string[] = []
  let maximumHolds = 0

  function slot(key: string) {
    const index = grid.geometry.value.indexOf(key)
    const item = index === undefined ? undefined : grid.geometry.value.getItem(index)
    if (!item) throw new Error(`Missing logical occurrence ${key}`)
    return {
      left: item.inlineStart,
      top: item.start - root.scrollTop,
      width: item.inlineSize,
      height: item.size,
    } as DOMRect
  }

  function createRow(key: string) {
    const rowAttributes = new Set<string>()
    let partialOffset = { x: 0, y: 0 }
    const natural = new VirtualElement(env.document)
    natural.rect = { left: 0, top: 0, width: 150, height: 40 }
    const releaseMeasurement = grid.measurements.observeItem(key, natural.asElement())
    const surface = {
      getBoundingClientRect: () => {
        const current = slot(key)
        return {
          ...current,
          left: current.left + partialOffset.x,
          top: current.top + partialOffset.y,
        } as DOMRect
      },
    }
    return {
      isConnected: true,
      natural,
      releaseMeasurement,
      dataset: { testDropId: key },
      attributes: rowAttributes,
      setAttribute: (name: string) => rowAttributes.add(name),
      removeAttribute: (name: string) => rowAttributes.delete(name),
      getBoundingClientRect: () => slot(key),
      querySelector: () => surface,
      surface,
      setPartialOffset: (value: { x: number; y: number }) => {
        partialOffset = value
      },
    }
  }

  Object.assign(list, {
    setAttribute: (name: string) => attributes.add(name),
    removeAttribute: (name: string) => attributes.delete(name),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    querySelectorAll: () => [...mounted.values()],
  })
  list.getBoundingClientRect.mockImplementation(
    () =>
      ({
        left: 0,
        top: -root.scrollTop,
        width: 300,
        height: grid?.totalSize.value ?? 24_990,
      }) as DOMRect,
  )
  Object.defineProperty(root, 'scrollHeight', { get: () => grid?.totalSize.value ?? 24_990 })
  Object.defineProperty(list, 'scrollHeight', { get: () => grid?.totalSize.value ?? 24_990 })

  const scope = effectScope()
  scopes.push(scope)
  const result = scope.run(() => {
    grid = useMeasuredVirtualGrid({
      items,
      getItemKey: (item) => item.id,
      getContentGeneration: () => 0,
      estimatedItemSize: 40,
      columns: 2,
      gap: 10,
      columnGap: 0,
      cacheLimit: 64,
      retainedIndexes: () => retained.value?.retainedIndexes.value ?? [],
      scrollElement: root.asElement(),
      listElement: list.asElement(),
    })
    const retention = useVirtualItemRetention({
      context: grid.context,
      geometry: grid.geometry,
      limit: 2,
    })
    retained.value = retention
    watch(
      grid.virtualItems,
      (rows) => {
        const next = new Set(rows.map((row) => String(row.key)))
        for (const [key, row] of mounted) {
          if (next.has(key)) continue
          row.isConnected = false
          row.natural.isConnected = false
          row.releaseMeasurement()
          mounted.delete(key)
        }
        for (const key of next) if (!mounted.has(key)) mounted.set(key, createRow(key))
      },
      { immediate: true, flush: 'post' },
    )
    function commit(source: string, target: string) {
      const order = items.value.map((item) => ({ ...item }))
      const eligible = grouped
        ? order.filter((item) => Number(item.id) % 2 === Number(source) % 2)
        : order
      const from = eligible.findIndex((item) => item.id === source)
      const to = eligible.findIndex((item) => item.id === target)
      const [moved] = eligible.splice(from, 1)
      eligible.splice(to, 0, moved!)
      let index = 0
      items.value = grouped
        ? order.map((item) =>
            Number(item.id) % 2 === Number(source) % 2 ? eligible[index++]! : item,
          )
        : eligible
    }
    const move = vi.fn((_kind: string, source: string, target: string) => commit(source, target))
    const reorder = useGridReorder({
      idsByKind: () => ({ track: items.value.map((item) => item.id) }),
      scrollElement: list.asElement(),
      autoScrollElement: root.asElement(),
      attributePrefix: 'test',
      getGroupId: grouped ? (_kind, id) => String(Number(id) % 2) : undefined,
      retainItem: (_kind, id) => {
        const release = retention.retain(id, 'reorder')
        if (!release) return
        holds.push(`retain:${id}`)
        maximumHolds = Math.max(maximumHolds, retention.retainedKeys.value.length)
        return () => {
          holds.push(`release:${id}`)
          release()
        }
      },
      createGeometry(input) {
        const source = mounted.get(input.sourceId)
        if (!source) return
        const revision = grid.layoutRevision.value
        return createVirtualGridReorderGeometry(input, {
          geometry: grid.geometry.value,
          columns: 2,
          listWidth: grid.context.metrics.value.listWidth,
          origin: { left: 0, top: 0 },
          sourceElement: source as unknown as HTMLElement,
          mountedIds: () => grid.virtualItems.value.map((item) => String(item.key)),
          getRevision: () => grid.virtualItems.value,
          isValid: () => grid.context.metrics.value.ready && grid.layoutRevision.value === revision,
        })
      },
      move,
    })
    return { grid, retention, reorder, move, commit }
  })!
  function pointFor(key: string) {
    const current = slot(key)
    return pointer(current.left + current.width / 2, current.top + current.height / 2)
  }
  return {
    ...result,
    items,
    root,
    list,
    mounted,
    captured,
    attributes,
    holds,
    pointFor,
    slot,
    maximumHolds: () => maximumHolds,
    stop: () => scope.stop(),
  }
}

describe('virtual controlled-grid release handoff (injected Node boxes)', () => {
  it.each([
    ['forward', '0', '5'],
    ['backward', '5', '0'],
  ] as const)(
    'accepts the expected %s parent order on the next render turn and equal-ID object refreshes',
    async (_label, sourceId, targetId) => {
      const test = setup()
      await settle()
      const source = test.mounted.get(sourceId)!
      const down = test.pointFor(sourceId)
      const up = test.pointFor(targetId)
      const initial = test.slot(sourceId)
      const expectedVisual = {
        left: initial.left + up.clientX - down.clientX,
        top: initial.top + up.clientY - down.clientY,
      }
      test.move.mockImplementation((_kind, from, to) => {
        void nextTick(() => test.commit(from, to))
      })
      test.reorder.startDrag(down, 'track', sourceId)
      test.reorder.finishDrag(up)
      expect(test.items.value.findIndex((item) => item.id === sourceId)).toBe(Number(sourceId))
      expect(test.retention.retainedKeys.value).toEqual([sourceId, targetId])
      await settle()
      expect(test.items.value.findIndex((item) => item.id === sourceId)).toBe(Number(targetId))
      expect(test.mounted.get(sourceId)).toBe(source)
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      const offset = translation(test.reorder.getItemStyle('track', sourceId))
      expect(test.slot(sourceId).left + offset.x).toBeCloseTo(expectedVisual.left)
      expect(test.slot(sourceId).top + offset.y).toBeCloseTo(expectedVisual.top)

      const beforeRefresh = test.items.value.find((item) => item.id === sourceId)
      test.items.value = test.items.value.map((item) => ({
        ...item,
        title: `${item.title} updated`,
      }))
      await settle()
      expect(test.items.value.find((item) => item.id === sourceId)).not.toBe(beforeRefresh)
      expect(test.mounted.get(sourceId)).toBe(source)
      expect(test.retention.retainedKeys.value).toEqual([sourceId, targetId])
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      expect(test.reorder.getItemStyle('track', sourceId)).toMatchObject({ transition: 'none' })
      runFrame()
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      vi.advanceTimersByTime(340)
      expect(source.attributes.has('data-am-grid-landing')).toBe(false)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.move).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['forward', '0', '4', ['2', '1', '4', '3', '0', '5']],
    ['backward', '4', '0', ['4', '1', '0', '3', '2', '5']],
  ] as const)(
    'accepts a next-render-turn %s commit through eligible holes without moving other groups',
    async (_label, sourceId, targetId, expected) => {
      const test = setup(true)
      await settle()
      const source = test.mounted.get(sourceId)!
      test.move.mockImplementation((_kind, from, to) => {
        void nextTick(() => test.commit(from, to))
      })
      test.reorder.startDrag(test.pointFor(sourceId), 'track', sourceId)
      test.reorder.finishDrag(test.pointFor(targetId))
      await settle()
      expect(test.items.value.slice(0, 6).map((item) => item.id)).toEqual(expected)
      expect(test.retention.retainedKeys.value).toEqual([sourceId, targetId])
      expect(test.mounted.get(sourceId)).toBe(source)
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      expect(test.reorder.getItemStyle('track', sourceId)).toMatchObject({ transition: 'none' })
      test.items.value = test.items.value.map((item) => ({ ...item }))
      await settle()
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      runFrame()
      expect(test.retention.retainedKeys.value).toEqual([sourceId, targetId])
      vi.advanceTimersByTime(340)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.move).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['forward same row', '0', '1'],
    ['forward cross row', '0', '5'],
    ['backward same row', '5', '4'],
    ['backward cross row', '5', '0'],
  ] as const)(
    'rebases the actual source and interrupted neighbor positions after %s and a fresh parent snapshot',
    async (_label, sourceId, targetId) => {
      const test = setup()
      await settle()
      const source = test.mounted.get(sourceId)!
      const previousItem = test.items.value.find((item) => item.id === sourceId)
      const down = test.pointFor(sourceId)
      const up = test.pointFor(targetId)
      const initial = test.slot(sourceId)
      test.reorder.startDrag(down, 'track', sourceId)
      test.reorder.continueDrag(up)
      runFrame()
      await settle()
      expect(test.reorder.dropTargetId.value).toBe(targetId)
      const neighborPositions = new Map<string, { left: number; top: number }>()
      for (const [id, row] of test.mounted) {
        if (id === sourceId) continue
        const style = test.reorder.getItemStyle('track', id)
        if (!style) continue
        const intended = translation(style)
        row.setPartialOffset({ x: intended.x * 0.4, y: intended.y * 0.4 })
        const actual = row.surface.getBoundingClientRect()
        neighborPositions.set(id, { left: actual.left, top: actual.top })
      }
      expect(neighborPositions.size).toBeGreaterThan(0)
      const visualSource = {
        left: initial.left + up.clientX - down.clientX,
        top: initial.top + up.clientY - down.clientY,
      }
      test.move.mockImplementation((_kind, from, to) => {
        expect(test.retention.retainedKeys.value).toEqual([sourceId, targetId])
        expect(test.holds).toEqual([`retain:${sourceId}`, `retain:${targetId}`])
        test.commit(from, to)
      })
      test.reorder.finishDrag(up)
      expect(test.move).toHaveBeenCalledExactlyOnceWith(
        'track',
        sourceId,
        targetId,
        Array.from({ length: 1000 }, (_, index) => String(index)),
      )
      expect(test.captured.size).toBe(0)
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      await settle()
      expect(test.items.value.find((item) => item.id === sourceId)).not.toBe(previousItem)
      expect(test.items.value.findIndex((item) => item.id === sourceId)).toBe(Number(targetId))
      expect(test.mounted.get(sourceId)).toBe(source)
      const sourceStyle = test.reorder.getItemStyle('track', sourceId)
      const rebased = translation(sourceStyle)
      const destination = test.slot(sourceId)
      expect(sourceStyle).toMatchObject({ transition: 'none', contentVisibility: 'visible' })
      expect(destination.left + rebased.x).toBeCloseTo(visualSource.left)
      expect(destination.top + rebased.y).toBeCloseTo(visualSource.top)
      for (const [id, actual] of neighborPositions) {
        const row = test.mounted.get(id)!
        const offset = translation(test.reorder.getItemStyle('track', id))
        const current = test.slot(id)
        expect(current.left + offset.x).toBeCloseTo(actual.left)
        expect(current.top + offset.y).toBeCloseTo(actual.top)
        expect(row.attributes.has('data-am-grid-settling')).toBe(true)
      }
      expect(test.grid.virtualItems.value.length).toBeLessThan(30)
      expect(test.maximumHolds()).toBe(2)
      runFrame()
      expect(test.reorder.isSettling.value).toBe(false)
      expect(test.reorder.getItemStyle('track', sourceId)).toEqual({ contentVisibility: 'visible' })
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      expect(test.retention.retainedKeys.value).toEqual([sourceId, targetId])
      vi.advanceTimersByTime(339)
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      vi.advanceTimersByTime(1)
      expect(source.attributes.has('data-am-grid-landing')).toBe(false)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.holds).toEqual([
        `retain:${sourceId}`,
        `retain:${targetId}`,
        `release:${sourceId}`,
        `release:${targetId}`,
      ])
      for (const id of neighborPositions.keys())
        expect(test.mounted.get(id)!.attributes.has('data-am-grid-settling')).toBe(false)
      expect(test.reorder.getItemStyle('track', sourceId)).toBeUndefined()
    },
  )

  it.each([
    ['forward', '0', '500', 0, 12_300],
    ['backward', '500', '0', 12_300, 0],
  ] as const)(
    'keeps a single keyed source and two leases across a %s offscreen release',
    async (_label, sourceId, targetId, initialScroll, releaseScroll) => {
      const test = setup()
      await settle()
      test.root.scrollTop = initialScroll
      test.root.dispatchEvent(new Event('scroll'))
      await settle()
      const source = test.mounted.get(sourceId)!
      expect(source).toBeDefined()
      const down = test.pointFor(sourceId)
      test.reorder.startDrag(down, 'track', sourceId)
      test.root.scrollTop = releaseScroll
      test.root.dispatchEvent(new Event('scroll'))
      await settle()
      const up = test.pointFor(targetId)
      test.reorder.finishDrag(up)
      expect(test.move).toHaveBeenCalledOnce()
      expect(test.move.mock.calls[0]!.slice(1, 3)).toEqual([sourceId, targetId])
      expect(test.retention.retainedKeys.value).toEqual([sourceId, targetId])
      await settle()
      expect(test.mounted.get(sourceId)).toBe(source)
      expect(test.grid.virtualItems.value.length).toBeLessThan(32)
      expect(test.reorder.getItemStyle('track', sourceId)).toMatchObject({ transition: 'none' })
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      runFrame()
      vi.advanceTimersByTime(340)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.maximumHolds()).toBe(2)
    },
  )

  it.each(['new-drag', 'dispose'] as const)(
    'ignores an obsolete nextTick landing completion after %s',
    async (interruption) => {
      const test = setup()
      await settle()
      const down = test.pointFor('0')
      test.reorder.startDrag(down, 'track', '0')
      test.reorder.finishDrag(test.pointFor('5'))
      const source = test.mounted.get('0')!
      if (interruption === 'new-drag') test.reorder.startDrag(test.pointFor('0'), 'track', '0')
      else test.stop()
      await settle()
      runFrame()
      vi.advanceTimersByTime(1000)
      expect(source.attributes.has('data-am-grid-landing')).toBe(false)
      expect(test.move).toHaveBeenCalledOnce()
      if (interruption === 'new-drag') {
        expect(test.retention.retainedKeys.value).toEqual(['0'])
        expect(test.captured.size).toBe(1)
        expect(test.reorder.draggedId.value).toBe('0')
        test.reorder.clearDrag()
      }
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.captured.size).toBe(0)
      expect(frames.size).toBe(0)
    },
  )
})
