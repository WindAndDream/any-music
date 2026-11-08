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
  vi.stubGlobal('ShadowRoot', class extends EventTarget {})
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
  await nextTick()
}

function runFrame() {
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback(16)
}

function pointer(y = 10, currentTarget?: HTMLElement): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: 20,
    clientY: y,
    currentTarget,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent
}

/** Injected focus/events and natural boxes exercise contracts, not native focus or layout. */
function setup(
  options: {
    limit?: number
    reducedMotion?: boolean
    grouped?: boolean
    focusPort?: boolean
    naturalSize?: (key: string) => number
  } = {},
) {
  const env = createResizeEnvironment()
  const documentEvents = new EventTarget()
  Object.assign(env.document, {
    activeElement: null,
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  })
  Object.assign(env.view, {
    innerHeight: 600,
    matchMedia: () => ({ matches: Boolean(options.reducedMotion) }),
  })
  vi.stubGlobal('window', env.view)
  vi.stubGlobal('document', env.document)
  const root = new VirtualElement(env.document)
  const list = new VirtualElement(env.document)
  root.scrollTop = 0
  root.clientHeight = 100
  root.clientTop = root.clientLeft = 0
  root.rect = { left: 0, top: 0, width: 300, height: 100 }
  list.rect = { left: 0, top: 0, width: 300, height: 20_000 }
  const items = shallowRef(Array.from({ length: 1_000 }, (_, index) => ({ id: String(index) })))
  const enabled = shallowRef(true)
  const scrollElement = shallowRef(root.asElement())
  const listElement = shallowRef(list.asElement())
  let hidden = false
  let blurOnCommit = true
  let deferCommit = false
  let pendingCommit: (() => void) | undefined
  let grid: ReturnType<typeof useMeasuredVirtualGrid<{ id: string }>>
  let retention: ReturnType<typeof useVirtualItemRetention>
  const retained = shallowRef<ReturnType<typeof useVirtualItemRetention>>()
  const mounted = new Map<string, ItemElement>()
  const attributes = new Set<string>()
  const captured = new Set<number>()
  const holds: string[] = []
  const beforeScroll = vi.fn()
  let maximumMounted = 0
  let maximumHolds = 0

  function setFocus(target: ItemElement | null) {
    const previous = env.document.activeElement as unknown as ItemElement | null
    if (previous === target) return
    Object.assign(env.document, { activeElement: target })
    const focusOut = new Event('focusout')
    Object.defineProperty(focusOut, 'relatedTarget', { value: target })
    ;(previous?.parent ?? previous)?.dispatchEvent(focusOut)
    ;(target?.parent ?? target)?.dispatchEvent(new Event('focusin'))
    if (target) {
      const focusIn = new Event('focusin')
      Object.defineProperty(focusIn, 'composedPath', { value: () => [target] })
      env.view.dispatchEvent(focusIn)
    }
  }

  class ItemElement extends EventTarget {
    readonly nodeType = 1
    isConnected = true
    readonly dataset: { testDropId: string }
    readonly attributes = new Set<string>()
    readonly handle?: ItemElement
    readonly natural?: VirtualElement
    readonly key: string
    readonly parent?: ItemElement
    unavailable = false
    presentationRoot: { host: HTMLElement } | undefined
    release: (() => void) | undefined
    readonly ownerDocument = env.document
    focus = vi.fn((_options?: FocusOptions) => setFocus(this))

    constructor(key: string, parent?: ItemElement) {
      super()
      this.key = key
      this.parent = parent
      this.dataset = { testDropId: key }
      if (!parent) {
        this.handle = new ItemElement(key, this)
        this.natural = new VirtualElement(env.document)
        this.natural.rect = {
          left: 0,
          top: 0,
          width: 300,
          height: options.naturalSize?.(key) ?? 20,
        }
      }
    }
    contains(node: Node): boolean {
      return node === this.asElement() || node === this.handle?.asElement()
    }
    getRootNode() {
      return this.presentationRoot ?? env.document
    }
    hasAttribute(name: string) {
      return this.parent ? name === 'data-test-handle' : this.attributes.has(name)
    }
    setAttribute(name: string) {
      this.attributes.add(name)
    }
    removeAttribute(name: string) {
      this.attributes.delete(name)
    }
    closest(selector: string) {
      if (selector.includes('inert')) return hidden || this.unavailable ? this.asElement() : null
      if (selector.includes('drop-kind')) return (this.parent ?? this).asElement()
      return null
    }
    querySelector(selector: string) {
      return selector.includes('handle') ? (this.handle?.asElement() ?? null) : null
    }
    getBoundingClientRect() {
      const index = grid.geometry.value.indexOf(this.key)
      const row = index === undefined ? undefined : grid.geometry.value.getItem(index)
      return {
        left: 0,
        top: (row?.start ?? 0) - root.scrollTop,
        width: 300,
        height: row?.size ?? 20,
      } as DOMRect
    }
    asElement() {
      return this as unknown as HTMLElement
    }
  }

  Object.assign(list, {
    getRootNode: () => env.document,
    closest: () => (hidden ? list.asElement() : null),
    contains: (node: Node) => [...mounted.values()].some((row) => row.contains(node)),
    setAttribute: (name: string) => attributes.add(name),
    removeAttribute: (name: string) => attributes.delete(name),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    querySelectorAll: () => [...mounted.values()],
  })
  Object.assign(root, {
    getRootNode: () => env.document,
    closest: () => (hidden ? root.asElement() : null),
  })
  list.getBoundingClientRect.mockImplementation(
    () =>
      ({
        left: 0,
        top: -root.scrollTop,
        width: 300,
        height: grid?.totalSize.value ?? 20_000,
      }) as DOMRect,
  )
  Object.defineProperty(root, 'scrollHeight', { get: () => grid?.totalSize.value ?? 20_000 })
  Object.defineProperty(list, 'scrollHeight', { get: () => grid?.totalSize.value ?? 20_000 })
  const group = (id: string) =>
    options.grouped === false || id === '0' || id === '900' ? 'primary' : 'other'
  const scope = effectScope()
  scopes.push(scope)
  const result = scope.run(() => {
    grid = useMeasuredVirtualGrid({
      items,
      enabled,
      getItemKey: (item) => item.id,
      getContentGeneration: () => 0,
      estimatedItemSize: 20,
      columns: 1,
      gap: 0,
      columnGap: 0,
      cacheLimit: 32,
      retainedIndexes: () => retained.value?.retainedIndexes.value ?? [],
      scrollElement,
      listElement,
    })
    retention = useVirtualItemRetention({
      context: grid.context,
      geometry: grid.geometry,
      limit: options.limit ?? 3,
      beforeScroll,
    })
    retained.value = retention
    watch(
      grid.virtualItems,
      (rows) => {
        const next = new Set(rows.map((row) => String(row.key)))
        for (const [key, row] of mounted) {
          if (next.has(key)) continue
          if (env.document.activeElement === row.handle?.asElement()) setFocus(null)
          row.isConnected = false
          row.handle!.isConnected = false
          row.release?.()
          mounted.delete(key)
        }
        for (const key of next) {
          if (mounted.has(key)) continue
          const row = new ItemElement(key)
          const releaseMeasurement = grid.measurements.observeItem(key, row.natural!.asElement())
          const releaseRegistration = retention.registerItem(key, row.asElement())
          row.release = () => {
            releaseRegistration()
            releaseMeasurement()
          }
          mounted.set(key, row)
        }
        maximumMounted = Math.max(maximumMounted, mounted.size)
      },
      { immediate: true, flush: 'post' },
    )
    const move = vi.fn(
      (_kind: string, source: string, target: string, visible: readonly string[]) => {
        const commit = () => {
          const order = items.value.map((item) => ({ ...item }))
          const eligible = order.filter((item) => visible.includes(item.id))
          const [moved] = eligible.splice(
            eligible.findIndex((item) => item.id === source),
            1,
          )
          eligible.splice(visible.indexOf(target), 0, moved!)
          let index = 0
          if (blurOnCommit) setFocus(null)
          items.value = order.map((item) => (visible.includes(item.id) ? eligible[index++]! : item))
        }
        if (deferCommit) pendingCommit = commit
        else commit()
      },
    )
    const focusItem = vi.fn((_kind: string, id: string, signal: AbortSignal) =>
      retention.focusItem(id, {
        signal,
        target: (element) => element.querySelector<HTMLElement>('[data-test-handle]'),
      }),
    )
    const reorder = useGridReorder({
      idsByKind: () => ({ track: items.value.map((item) => item.id) }),
      scrollElement: listElement,
      autoScrollElement: scrollElement,
      attributePrefix: 'test',
      getGroupId: (_kind, id) => group(id),
      focusItem: options.focusPort === false ? undefined : focusItem,
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
          columns: 1,
          listWidth: grid.context.metrics.value.listWidth,
          origin: { left: 0, top: 0 },
          sourceElement: source.asElement(),
          mountedIds: () => grid.virtualItems.value.map((item) => String(item.key)),
          getRevision: () => grid.virtualItems.value,
          isValid: () => grid.context.metrics.value.ready && grid.layoutRevision.value === revision,
        })
      },
      move,
    })
    return { grid, retention, reorder, move, focusItem }
  })!

  return {
    ...env,
    ...result,
    root,
    list,
    items,
    enabled,
    scrollElement,
    listElement,
    mounted,
    holds,
    beforeScroll,
    attributes,
    captured,
    setFocus,
    newControl: () => new ItemElement('unrelated').handle!,
    hideListHost: () => {
      const host = new ItemElement('list-host')
      host.unavailable = true
      Object.assign(list, { getRootNode: () => ({ host: host.asElement() }) })
    },
    setHidden: () => {
      hidden = true
    },
    keepNativeFocus: () => {
      blurOnCommit = false
    },
    deferCommit: () => {
      deferCommit = true
    },
    commit: () => pendingCommit?.(),
    get maximumMounted() {
      return maximumMounted
    },
    get maximumHolds() {
      return maximumHolds
    },
    stop: () => scope.stop(),
  }
}

describe('virtual grid keyboard reorder (real geometry/retention; injected focus)', () => {
  it.each([
    { source: '0', target: '900', direction: 1 as const },
    { source: '900', target: '0', direction: -1 as const },
  ])(
    'restores the same handle after $source → $target across unmounted group gaps',
    async ({ source, target, direction }) => {
      const test = setup()
      await settle()
      test.retention.scrollToKey(source)
      await settle()
      const sourceRow = test.mounted.get(source)!
      const handle = sourceRow.handle!
      expect(test.mounted.has(target)).toBe(false)
      handle.focus()
      test.reorder.shift('track', source, direction)
      expect(test.move).toHaveBeenCalledExactlyOnceWith('track', source, target, ['0', '900'])
      expect(test.retention.retainedKeys.value).toContain(source)
      expect(test.focusItem).not.toHaveBeenCalled()
      await settle()
      expect(test.focusItem).toHaveBeenCalledExactlyOnceWith(
        'track',
        source,
        expect.any(AbortSignal),
      )
      expect(test.mounted.get(source)).toBe(sourceRow)
      expect(test.document.activeElement).toBe(handle.asElement())
      expect(handle.focus).toHaveBeenLastCalledWith({ preventScroll: true })
      const item = test.grid.geometry.value.getItem(test.grid.geometry.value.indexOf(source)!)!
      expect(item.start).toBeGreaterThanOrEqual(test.root.scrollTop)
      expect(item.end).toBeLessThanOrEqual(test.root.scrollTop + test.root.clientHeight)
      expect(test.items.value[Number(target)]!.id).toBe(source)
      expect(test.items.value[1]!.id).toBe('1')
      expect(test.items.value[899]!.id).toBe('899')
      expect(test.maximumMounted).toBeLessThan(20)
      expect(test.maximumHolds).toBeLessThanOrEqual(2)
      expect(test.retention.retainedKeys.value).toEqual([source])
      expect(test.holds).toEqual([`retain:${source}`, `release:${source}`])
      test.setFocus(null)
      expect(test.retention.retainedKeys.value).toEqual([])
    },
  )

  it('realigns before focusing when newly mounted natural heights move the source beyond its estimate', async () => {
    const test = setup({ naturalSize: (key) => (key === '899' ? 180 : 20) })
    await settle()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    expect(test.grid.measurements.getHeight('899')).toBeUndefined()
    const visibleAtFocus: boolean[] = []
    handle.focus.mockImplementation(() => {
      const item = test.grid.geometry.value.getItem(test.grid.geometry.value.indexOf('0')!)!
      visibleAtFocus.push(
        item.start >= test.root.scrollTop &&
          item.end <= test.root.scrollTop + test.root.clientHeight,
      )
      test.setFocus(handle)
    })
    test.reorder.shift('track', '0', 1)
    await settle()
    expect(test.grid.measurements.getHeight('899')).toBe(180)
    expect(visibleAtFocus).toEqual([true])
    expect(test.root.scrollTop).toBe(18_080)
    expect(test.beforeScroll).toHaveBeenCalledOnce()
    expect(test.document.activeElement).toBe(handle.asElement())
    expect(test.maximumMounted).toBeLessThan(20)
    test.setFocus(null)
    expect(test.retention.retainedKeys.value).toEqual([])
  })

  it('accepts the expected eligible-subset commit in the next parent render', async () => {
    const test = setup()
    await settle()
    test.deferCommit()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    void nextTick(() => test.commit())
    await settle()
    expect(test.items.value[900]!.id).toBe('0')
    expect(test.document.activeElement).toBe(handle.asElement())
    expect(test.root.scrollTop).toBeGreaterThan(17_000)
    test.setFocus(null)
    expect(test.retention.retainedKeys.value).toEqual([])
  })

  it('does not cancel restoration when the initiating key event subsequently bubbles to its viewport', async () => {
    const test = setup()
    await settle()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    test.root.dispatchEvent(new Event('keydown'))
    await settle()
    expect(test.document.activeElement).toBe(handle.asElement())
    expect(test.focusItem).toHaveBeenCalledOnce()
  })

  it('leaves dialog-button focus and background scroll unchanged for a non-handle action', async () => {
    const test = setup()
    await settle()
    test.keepNativeFocus()
    const control = test.newControl()
    control.focus()
    test.reorder.shift('track', '0', 1)
    await settle()
    expect(test.move).toHaveBeenCalledOnce()
    expect(test.focusItem).not.toHaveBeenCalled()
    expect(test.document.activeElement).toBe(control.asElement())
    expect(test.root.scrollTop).toBe(0)
    expect(test.holds).toEqual([])
  })

  it('rejects a focused move when retaining its source would evict a live editor', async () => {
    const test = setup({ limit: 1 })
    await settle()
    const releaseEditor = test.retention.retain('500', 'editor')!
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    await settle()
    expect(test.move).not.toHaveBeenCalled()
    expect(test.focusItem).not.toHaveBeenCalled()
    expect(test.document.activeElement).toBe(handle.asElement())
    expect(test.retention.retainedKeys.value).toEqual(['500'])
    releaseEditor()
    expect(test.retention.retainedKeys.value).toEqual([])
  })

  it.each(['before-port', 'during-port'] as const)(
    'does not steal focus from an unrelated control %s',
    async (phase) => {
      const test = setup()
      await settle()
      const handle = test.mounted.get('0')!.handle!
      handle.focus()
      test.reorder.shift('track', '0', 1)
      if (phase === 'during-port') {
        await nextTick()
        await nextTick()
        expect(test.focusItem).toHaveBeenCalledOnce()
      }
      const control = test.newControl()
      control.focus()
      await settle()
      expect(test.document.activeElement).toBe(control.asElement())
      expect(handle.focus).toHaveBeenCalledOnce()
      expect(test.retention.retainedKeys.value).toEqual([])
    },
  )

  it.each([
    'clear',
    'dispose',
    'list-root',
    'viewport-root',
    'remove',
    'hidden',
    'new-order',
  ] as const)('cancels stale offscreen restoration after %s', async (cause) => {
    const test = setup()
    await settle()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    if (cause === 'clear') test.reorder.clearDrag()
    if (cause === 'dispose') test.stop()
    if (cause === 'list-root')
      test.listElement.value = new VirtualElement(test.document).asElement()
    if (cause === 'viewport-root')
      test.scrollElement.value = new VirtualElement(test.document).asElement()
    if (cause === 'remove') test.items.value = test.items.value.filter((item) => item.id !== '0')
    if (cause === 'hidden') test.setHidden()
    if (cause === 'new-order') test.items.value = test.items.value.toReversed()
    await settle()
    expect(handle.focus).toHaveBeenCalledOnce()
    expect(test.document.activeElement).not.toBe(handle.asElement())
    expect(test.retention.retainedKeys.value).toEqual([])
    expect(frames.size).toBe(0)
  })

  it.each(['root', 'target-shadow-host'] as const)(
    'does not focus a hidden %s after navigation has started',
    async (surface) => {
      const test = setup()
      await settle()
      const handle = test.mounted.get('0')!.handle!
      handle.focus()
      test.reorder.shift('track', '0', 1)
      await nextTick()
      await nextTick()
      expect(test.focusItem).toHaveBeenCalledOnce()
      if (surface === 'root') test.setHidden()
      else {
        const host = test.newControl()
        host.unavailable = true
        handle.presentationRoot = { host: host.asElement() }
      }
      await settle()
      expect(handle.focus).toHaveBeenCalledOnce()
      expect(test.document.activeElement).not.toBe(handle.asElement())
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.holds).toEqual(['retain:0', 'release:0'])
    },
  )

  it('keeps a new explicit navigation from being overwritten by an older keyboard move', async () => {
    const test = setup()
    await settle()
    test.mounted.get('0')!.handle!.focus()
    test.reorder.shift('track', '0', 1)
    await nextTick()
    await nextTick()
    expect(test.focusItem).toHaveBeenCalledOnce()
    const navigation = test.retention.focusItem('500', {
      target: (element) => element.querySelector('[data-test-handle]'),
    })
    await settle()
    expect(await navigation).toBe(true)
    expect(test.document.activeElement).toBe(test.mounted.get('500')!.handle!.asElement())
    expect(test.retention.retainedKeys.value).toEqual(['500'])
  })

  it.each(['keydown', 'pointerdown', 'wheel', 'touchstart'] as const)(
    'aborts in-flight focus before new %s input',
    async (type) => {
      const test = setup()
      await settle()
      const handle = test.mounted.get('0')!.handle!
      handle.focus()
      test.reorder.shift('track', '0', 1)
      await nextTick()
      await nextTick()
      expect(test.focusItem).toHaveBeenCalledOnce()
      test.view.dispatchEvent(new Event(type))
      await settle()
      expect(test.focusItem.mock.calls[0]![2].aborted).toBe(true)
      expect(handle.focus).toHaveBeenCalledOnce()
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.holds).toEqual(['retain:0', 'release:0'])
    },
  )

  it('cancels the previous keyboard restoration when another move is submitted', async () => {
    const test = setup()
    await settle()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    test.reorder.shift('track', '0', -1)
    await settle()
    expect(test.move).toHaveBeenCalledTimes(2)
    expect(test.focusItem).not.toHaveBeenCalled()
    expect(handle.focus).toHaveBeenCalledOnce()
    expect(test.items.value[0]!.id).toBe('0')
    expect(test.retention.retainedKeys.value).toEqual([])
    expect(test.holds).toEqual(['retain:0', 'release:0'])
  })

  it('cancels keyboard restoration before a new pointer gesture acquires its source', async () => {
    const test = setup()
    await settle()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    test.reorder.startDrag(pointer(), 'track', '1')
    await settle()
    expect(test.focusItem).not.toHaveBeenCalled()
    expect(handle.focus).toHaveBeenCalledOnce()
    expect(test.reorder.draggedId.value).toBe('1')
    expect(test.retention.retainedKeys.value).toEqual(['1'])
    test.reorder.clearDrag()
    expect(test.retention.retainedKeys.value).toEqual([])
    expect(test.holds).toEqual(['retain:0', 'release:0', 'retain:1', 'release:1'])
  })

  it('keeps the legacy mounted-handle restore path when no focus port is supplied', async () => {
    const test = setup({ focusPort: false, grouped: false })
    await settle()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    await settle()
    expect(test.items.value[1]!.id).toBe('0')
    expect(test.document.activeElement).toBe(handle.asElement())
    expect(handle.focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(test.focusItem).not.toHaveBeenCalled()
    expect(test.root.scrollTop).toBe(0)
    expect(test.holds).toEqual([])
    test.setFocus(null)
    expect(test.retention.retainedKeys.value).toEqual([])
  })

  it.each(['container', 'handle'] as const)(
    'guards the legacy %s against a hidden composed host',
    async (surface) => {
      const test = setup({ focusPort: false, grouped: false })
      await settle()
      const handle = test.mounted.get('0')!.handle!
      handle.focus()
      test.reorder.shift('track', '0', 1)
      if (surface === 'container') test.hideListHost()
      else {
        const host = test.newControl()
        host.unavailable = true
        handle.presentationRoot = { host: host.asElement() }
      }
      await settle()
      expect(handle.focus).toHaveBeenCalledOnce()
      expect(test.retention.retainedKeys.value).toEqual([])
    },
  )

  it.each(['input', 'root'] as const)(
    'guards the legacy restore against a newer %s',
    async (cause) => {
      const test = setup({ focusPort: false, grouped: false })
      await settle()
      const handle = test.mounted.get('0')!.handle!
      handle.focus()
      test.reorder.shift('track', '0', 1)
      if (cause === 'input') test.view.dispatchEvent(new Event('pointerdown'))
      else test.listElement.value = new VirtualElement(test.document).asElement()
      await settle()
      expect(handle.focus).toHaveBeenCalledOnce()
      expect(test.retention.retainedKeys.value).toEqual([])
    },
  )

  it('preserves reduced-motion order/focus without adding animation frames or timers', async () => {
    const test = setup({ reducedMotion: true })
    await settle()
    const handle = test.mounted.get('0')!.handle!
    handle.focus()
    test.reorder.shift('track', '0', 1)
    await settle()
    expect(test.items.value[900]!.id).toBe('0')
    expect(test.document.activeElement).toBe(handle.asElement())
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(test.holds).toEqual(['retain:0', 'release:0'])
  })

  it('finishes a reduced-motion pointer commit without a landing frame, timer or retained source', async () => {
    const test = setup({ reducedMotion: true, grouped: false })
    await settle()
    const row = test.mounted.get('0')!
    test.reorder.startDrag(pointer(10), 'track', '0')
    test.reorder.continueDrag(pointer(50))
    runFrame()
    test.reorder.finishDrag(pointer(50))
    await settle()
    expect(test.move).toHaveBeenCalledOnce()
    expect(test.items.value[0]!.id).not.toBe('0')
    expect(test.captured.size).toBe(0)
    expect(test.retention.retainedKeys.value).toEqual([])
    expect(row.attributes.has('data-am-grid-landing')).toBe(false)
    expect(test.reorder.getItemStyle('track', '0')).toBeUndefined()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
