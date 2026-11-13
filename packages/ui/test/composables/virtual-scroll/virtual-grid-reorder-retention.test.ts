import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef, watch } from 'vue'
import type { EffectScope } from 'vue'

import { useGridReorder } from '../../../src/composables/use-grid-reorder'
import { useMeasuredVirtualGrid } from '../../../src/composables/virtual-scroll/use-measured-virtual-grid'
import { useVirtualItemRetention } from '../../../src/composables/virtual-scroll/use-virtual-item-retention'
import { createVirtualGridReorderGeometry } from '../../../src/composables/virtual-scroll/virtual-grid-reorder-geometry'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

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

function pointer(y = 10): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: 20,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

/** Real virtual/retention controllers, with injected boxes rather than browser layout. */
function setup(limit = 4, measureMounted = false, liveMeasurements = false) {
  const env = createResizeEnvironment()
  Object.assign(env.view, { innerHeight: 600 })
  vi.stubGlobal('window', env.view)
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.scrollTop = 0
  root.clientHeight = 100
  root.rect = { left: 0, top: 0, width: 300, height: 100 }
  root.clientTop = 0
  list.rect = { left: 0, top: 0, width: 300, height: 20_000 }
  const items = shallowRef(Array.from({ length: 1000 }, (_, index) => String(index)))
  const columns = shallowRef(1)
  let grid: ReturnType<typeof useMeasuredVirtualGrid<string>>
  let retention: ReturnType<typeof useVirtualItemRetention> | undefined
  const retentionCell = shallowRef<ReturnType<typeof useVirtualItemRetention>>()
  const mounted = new Map<string, ReturnType<typeof createRow>>()
  const captured = new Set<number>()
  const attributes = new Set<string>()
  const setPointerCapture = vi.fn((id: number) => captured.add(id))
  const releasePointerCapture = vi.fn((id: number) => captured.delete(id))
  Object.assign(list, {
    setAttribute: (name: string) => attributes.add(name),
    removeAttribute: (name: string) => attributes.delete(name),
    setPointerCapture,
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture,
    querySelectorAll: () => [...mounted.values()],
  })
  list.getBoundingClientRect.mockImplementation(
    () =>
      ({
        left: 0,
        top: -root.scrollTop,
        width: list.rect.width,
        height: grid?.totalSize.value ?? 20_000,
      }) as DOMRect,
  )
  Object.defineProperty(root, 'scrollHeight', { get: () => grid?.totalSize.value ?? 20_000 })
  Object.defineProperty(list, 'scrollHeight', { get: () => grid?.totalSize.value ?? 20_000 })

  function createRow(key: string) {
    const rowAttributes = new Set<string>()
    const natural = new VirtualElement(env.document)
    natural.rect.height = liveMeasurements && key === '500' ? 80 : 20
    natural.rect.width = 300
    const releaseMeasurement = measureMounted
      ? grid.measurements.observeItem(key, natural.asElement())
      : undefined
    return {
      natural,
      releaseMeasurement,
      isConnected: true,
      dataset: { testDropId: key },
      attributes: rowAttributes,
      setAttribute: (name: string) => rowAttributes.add(name),
      removeAttribute: (name: string) => rowAttributes.delete(name),
      querySelector: () => null,
      getBoundingClientRect: () => {
        const slot = grid.geometry.value.getItem(items.value.indexOf(key))!
        return {
          left: 0,
          top:
            (liveMeasurements
              ? slot.start
              : Math.floor(items.value.indexOf(key) / columns.value) * 20) - root.scrollTop,
          width: 300 / columns.value,
          height: liveMeasurements ? slot.size : 20,
        } as DOMRect
      },
    }
  }

  const scope = effectScope()
  scopes.push(scope)
  const result = scope.run(() => {
    grid = useMeasuredVirtualGrid({
      items,
      getItemKey: (key) => key,
      getContentGeneration: () => 0,
      estimatedItemSize: 20,
      columns,
      gap: 0,
      columnGap: 0,
      cacheLimit: 32,
      retainedIndexes: () => retentionCell.value?.retainedIndexes.value ?? [],
      scrollElement: root.asElement(),
      listElement: list.asElement(),
    })
    retention = useVirtualItemRetention({
      context: grid.context,
      geometry: grid.geometry,
      limit,
    })
    retentionCell.value = retention
    watch(
      grid.virtualItems,
      (rows) => {
        const next = new Set(rows.map((row) => String(row.key)))
        for (const [key, element] of mounted) {
          if (next.has(key)) continue
          element.isConnected = false
          element.natural.isConnected = false
          element.releaseMeasurement?.()
          mounted.delete(key)
        }
        for (const key of next) if (!mounted.has(key)) mounted.set(key, createRow(key))
      },
      { immediate: true, flush: 'post' },
    )
    const move = vi.fn((_kind: string, source: string, target: string) => {
      const order = [...items.value]
      const from = order.indexOf(source),
        to = order.indexOf(target)
      order.splice(from, 1)
      order.splice(to, 0, source)
      items.value = order
    })
    const reorder = useGridReorder({
      idsByKind: () => ({ track: items.value }),
      scrollElement: list.asElement(),
      autoScrollElement: root.asElement(),
      attributePrefix: 'test',
      retainItem: (_kind, id) => retention!.retain(id, 'reorder'),
      createGeometry(input) {
        const snapshot = grid.geometry.value
        const revision = grid.layoutRevision.value
        const width = grid.context.metrics.value.listWidth
        const count = columns.value
        const source = mounted.get(input.sourceId)
        if (!source) return
        return createVirtualGridReorderGeometry(input, {
          geometry: snapshot,
          ...(liveMeasurements
            ? {
                getGeometry: () => grid.geometry.value,
                getGeometryRevision: () => grid.layoutRevision.value,
              }
            : {}),
          columns: columns.value,
          listWidth: grid.context.metrics.value.listWidth,
          origin: { left: 0, top: 0 },
          sourceElement: source as unknown as HTMLElement,
          mountedIds: () => grid.virtualItems.value.map((row) => String(row.key)),
          getRevision: () => grid.virtualItems.value,
          isValid: () =>
            grid.context.metrics.value.ready &&
            (liveMeasurements
              ? columns.value === count && grid.context.metrics.value.listWidth === width
              : grid.layoutRevision.value === revision),
        })
      },
      move,
    })
    return { grid, retention, reorder, move }
  })!
  return {
    ...env,
    ...result,
    root,
    list,
    items,
    columns,
    mounted,
    captured,
    attributes,
    setPointerCapture,
    releasePointerCapture,
    stop: () => scope.stop(),
  }
}

describe('virtual grid reorder and bounded interaction retention composition', () => {
  it.each(['columns', 'width', 'identity', 'detached', 'hidden'] as const)(
    'still cancels a live measured session on structural %s changes',
    async (change) => {
      const test = setup(2, true, true)
      await settle()
      test.reorder.startDrag(pointer(), 'track', '0')
      test.reorder.continueDrag(pointer(50))
      runFrame()
      if (change === 'columns') test.columns.value = 2
      if (change === 'width') {
        test.list.rect.width = 400
        test.grid.context.refresh()
      }
      if (change === 'identity') test.items.value = test.items.value.toReversed()
      if (change === 'detached') test.mounted.get('0')!.isConnected = false
      if (change === 'hidden') {
        test.root.clientHeight = 0
        test.root.rect.height = 0
        test.grid.context.refresh()
      }
      await settle()
      test.reorder.finishDrag(pointer(50))
      expect(test.reorder.draggedId.value).toBeUndefined()
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.captured.size).toBe(0)
      expect(test.move).not.toHaveBeenCalled()
      expect(frames.size).toBe(0)
    },
  )

  it.each(['forward', 'reverse'] as const)(
    'refreshes newly measured rows during a %s remote drag without moving the grabbed point',
    async (direction) => {
      const test = setup(2, true, true)
      vi.stubGlobal('ResizeObserver', test.view.ResizeObserver)
      await settle()
      const id = direction === 'forward' ? '0' : '900'
      if (direction === 'reverse') {
        test.root.scrollTop = 18_000
        test.root.dispatchEvent(new Event('scroll'))
        await settle()
      }
      const source = test.mounted.get(id)!
      test.reorder.startDrag(pointer(), 'track', id)
      const revision = test.grid.layoutRevision.value
      test.root.scrollTop = 10_000
      test.root.dispatchEvent(new Event('scroll'))
      test.reorder.continueDrag(pointer(50))
      await settle()
      runFrame()
      await settle()
      expect(test.grid.layoutRevision.value).not.toBe(revision)
      expect(test.grid.measurements.getHeight('500')).toBe(80)
      expect(test.reorder.draggedId.value).toBe(id)
      expect(test.mounted.get(id)).toBe(source)
      expect(test.retention.retainedKeys.value).toHaveLength(2)
      expect(test.grid.virtualItems.value.length).toBeLessThan(24)
      const style = String(test.reorder.getItemStyle('track', id)?.transform)
      const offset = Number(style.match(/, ([-\d.]+)px, 0\)/)?.[1])
      expect(source.getBoundingClientRect().top + offset).toBe(40)
      const target = test.reorder.dropTargetId.value!
      expect(Math.abs(Number(target) - 500)).toBeLessThan(8)

      // A mounted row grows while the pointer is stationary; the spatial revision
      // alone refreshes hit testing, neighbor offsets and source compensation.
      const row = test.mounted.get('500')!
      row.natural.rect.height = 120
      test.grid.measurements.refresh()
      await settle()
      test.observers.at(-1)!.notify([test.list.asElement()])
      expect(frames.size).toBeGreaterThan(0)
      runFrame()
      expect(test.reorder.draggedId.value).toBe(id)
      const currentStyle = String(test.reorder.getItemStyle('track', id)?.transform)
      const currentOffset = Number(currentStyle.match(/, ([-\d.]+)px, 0\)/)?.[1])
      expect(source.getBoundingClientRect().top + currentOffset).toBe(40)
      source.natural.rect.height = 60
      test.grid.measurements.refresh()
      await settle()
      runFrame()
      const grownStyle = String(test.reorder.getItemStyle('track', id)?.transform)
      const grownOffset = Number(grownStyle.match(/, ([-\d.]+)px, 0\)/)?.[1])
      expect(source.getBoundingClientRect().height).toBe(60)
      expect(source.getBoundingClientRect().top + grownOffset).toBe(40)
      test.reorder.finishDrag(pointer(50))
      expect(test.move).toHaveBeenCalledOnce()
      expect(test.captured.size).toBe(0)
      for (let phase = 0; phase < 4; phase++) {
        // eslint-disable-next-line no-await-in-loop -- Assert every committed measurement handoff.
        await nextTick()
        test.observers.at(-1)!.notify([test.list.asElement()])
        const handoffStyle = String(test.reorder.getItemStyle('track', id)?.transform)
        const handoffOffset = Number(handoffStyle.match(/, ([-\d.]+)px, 0\)/)?.[1])
        expect(
          source.getBoundingClientRect().top + handoffOffset,
          `measurement phase ${phase}`,
        ).toBe(40)
      }
      expect(test.mounted.get(id)).toBe(source)
      expect(source.attributes.has('data-am-grid-landing')).toBe(true)
      const landingStyle = String(test.reorder.getItemStyle('track', id)?.transform)
      const landingOffset = Number(landingStyle.match(/, ([-\d.]+)px, 0\)/)?.[1])
      expect(source.getBoundingClientRect().top + landingOffset).toBe(40)
      runFrame()
      vi.advanceTimersByTime(340)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(source.attributes.has('data-am-grid-landing')).toBe(false)
      test.stop()
      expect(frames.size).toBe(0)
    },
  )

  it('keeps the same remote source through a controlled commit and releases both holds after landing', async () => {
    const test = setup(2, true)
    await settle()
    const source = test.mounted.get('0')!
    test.reorder.startDrag(pointer(), 'track', '0')
    expect(test.retention.retainedKeys.value).toEqual(['0'])
    expect(test.captured.size).toBe(1)
    const layoutRevision = test.grid.layoutRevision.value
    test.items.value = [...test.items.value]
    await settle()
    expect(test.grid.layoutRevision.value).toBe(layoutRevision)
    expect(test.reorder.draggedId.value).toBe('0')
    expect(test.captured.size).toBe(1)

    test.root.scrollTop = 10_000
    test.root.dispatchEvent(new Event('scroll'))
    await settle()
    expect(test.mounted.get('0')).toBe(source)
    expect(test.reorder.draggedId.value).toBe('0')
    expect(test.captured.size).toBe(1)
    expect(test.grid.layoutRevision.value).toBe(layoutRevision)
    expect(test.grid.measurements.getHeight('500')).toBe(20)
    expect(test.grid.virtualItems.value.length).toBeLessThan(20)
    test.reorder.continueDrag(pointer(50))
    runFrame()
    await settle()
    const target = test.reorder.dropTargetId.value!
    expect(Number(target)).toBeGreaterThan(490)
    expect(test.retention.retainedKeys.value).toEqual(['0', target])

    test.reorder.finishDrag(pointer(50))
    expect(test.move).toHaveBeenCalledOnce()
    expect(test.retention.retainedKeys.value).toEqual(['0', target])
    expect(test.captured.size).toBe(0)
    await settle()
    expect(test.items.value.indexOf('0')).toBeGreaterThan(490)
    expect(test.mounted.get('0')).toBe(source)
    expect(source.attributes.has('data-am-grid-landing')).toBe(true)
    expect(test.reorder.getItemStyle('track', '0')).toMatchObject({ transition: 'none' })
    expect(test.grid.virtualItems.value.length).toBeLessThan(20)
    runFrame()
    expect(test.retention.retainedKeys.value).toEqual(['0', target])
    vi.advanceTimersByTime(340)
    expect(test.retention.retainedKeys.value).toEqual([])
    expect(source.attributes.has('data-am-grid-landing')).toBe(false)
    test.stop()
    expect(frames.size).toBe(0)
    expect(test.observers[0]!.disconnect).toHaveBeenCalledOnce()
  })

  it('rejects an additional destination without evicting an existing editor lease', async () => {
    const test = setup(2)
    await settle()
    const editorRelease = test.retention.retain('900', 'editor')!
    test.reorder.startDrag(pointer(), 'track', '0')
    expect(test.retention.retainedKeys.value).toEqual(['900', '0'])
    test.reorder.continueDrag(pointer(50))
    runFrame()
    expect(test.move).not.toHaveBeenCalled()
    expect(test.reorder.draggedId.value).toBeUndefined()
    expect(test.retention.retainedKeys.value).toEqual(['900'])
    expect(test.captured.size).toBe(0)
    expect(frames.size).toBe(0)
    editorRelease()
    expect(test.retention.retainedKeys.value).toEqual([])
  })

  it.each(['columns', 'natural-height'] as const)(
    'cancels a stale measured snapshot after %s changes instead of committing an old move',
    async (change) => {
      const test = setup()
      await settle()
      test.reorder.startDrag(pointer(), 'track', '0')
      test.reorder.continueDrag(pointer(50))
      runFrame()
      if (change === 'columns') test.columns.value = 2
      else {
        const natural = new VirtualElement(test.document)
        natural.rect.height = 40
        test.grid.measurements.observeItem('0', natural.asElement())
      }
      await settle()
      expect(test.reorder.draggedId.value).toBeUndefined()
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.captured.size).toBe(0)
      test.reorder.finishDrag(pointer(50))
      expect(test.move).not.toHaveBeenCalled()
      expect(frames.size).toBe(0)
    },
  )
})
