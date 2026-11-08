import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, shallowRef } from 'vue'

import { useVirtualGridMoveTransition } from '../../../src/composables/virtual-scroll/use-virtual-grid-move-transition'
import type { VirtualItemKey } from '../../../src/composables/virtual-scroll/virtual-row-geometry'
import { mountCatalogComponent } from '../../components/music-sources/catalog-test-renderer'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function mountGrid(count = 10_000) {
  const keys = shallowRef<readonly VirtualItemKey[]>(
    Array.from({ length: count }, (_, index) => `occurrence:${index}`),
  )
  const revision = shallowRef<unknown>({})
  const columns = shallowRef(3)
  const start = shallowRef(0)
  const enabled = shallowRef(true)
  const metadata = shallowRef(0)
  const active = shallowRef(true)
  const origin = shallowRef(0)
  const scale = shallowRef(1)
  const media = Object.assign(new EventTarget(), { matches: false })
  const style = {
    getPropertyValue: (name: string) => (name === '--am-motion-normal' ? '0.24s' : 'ease-in-out'),
  }
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    defaultView: { matchMedia: () => media, getComputedStyle: () => style },
  })
  const markers = new Map<string, string>()
  const visualOffsets = new Map<VirtualItemKey, { x: number; y: number }>()
  let renderedKeys = keys.value
  let renderedColumns = columns.value
  let renderedOrigin = 0
  let renderedScale = 1
  const records = new Map<
    VirtualItemKey,
    { surface: HTMLElement; slot: HTMLElement; release: () => void; markers: Map<string, string> }
  >()
  const events: { key: VirtualItemKey; animation: Animation; cancel: ReturnType<typeof vi.fn> }[] =
    []
  const reads = vi.fn((key: VirtualItemKey) => {
    const index = renderedKeys.indexOf(key)
    const offset = visualOffsets.get(key) ?? { x: 0, y: 0 }
    return {
      left: ((index % renderedColumns) * 100 + offset.x) * renderedScale,
      top: renderedOrigin + (Math.floor(index / renderedColumns) * 20 + offset.y) * renderedScale,
    }
  })
  const animate = vi.fn(function (
    this: { key: VirtualItemKey },
    _frames: Keyframe[],
    _options: KeyframeAnimationOptions,
  ) {
    const cancel = vi.fn(() => visualOffsets.delete(this.key))
    const animation = Object.assign(new EventTarget(), { cancel }) as unknown as Animation
    events.push({ key: this.key, animation, cancel })
    return animation
  })
  const element = {
    ownerDocument: document,
    isConnected: true,
    offsetWidth: 500,
    offsetHeight: count * 20,
    getAttribute: (name: string) => markers.get(name) ?? null,
    getBoundingClientRect: vi.fn(() => ({
      left: 0,
      top: renderedOrigin,
      width: 500 * renderedScale,
      height: count * 20 * renderedScale,
    })),
  } as unknown as HTMLElement
  let motion!: ReturnType<typeof useVirtualGridMoveTransition>
  const grid = defineComponent({
    setup() {
      motion = useVirtualGridMoveTransition({ element, revision, enabled })
      return () => {
        const mounted = new Set(keys.value.slice(start.value, start.value + 12))
        for (const [key, registration] of records)
          if (!mounted.has(key)) {
            registration.release()
            records.delete(key)
          }
        for (const key of mounted) {
          if (records.has(key)) continue
          const slotMarkers = new Map<string, string>()
          const slot = {
            isConnected: true,
            getAttribute: (name: string) => slotMarkers.get(name) ?? null,
            setAttribute: (name: string, value: string) => slotMarkers.set(name, value),
            removeAttribute: (name: string) => slotMarkers.delete(name),
          } as unknown as HTMLElement
          const surface = {
            key,
            isConnected: true,
            animate,
            getBoundingClientRect: () => reads(key),
          } as unknown as HTMLElement
          records.set(key, {
            slot,
            surface,
            markers: slotMarkers,
            release: motion.registerItem(key, slot, surface),
          })
        }
        renderedKeys = keys.value
        renderedColumns = columns.value
        renderedOrigin = origin.value
        renderedScale = scale.value
        return h('div', `${metadata.value}:${enabled.value}`)
      }
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (active.value ? h(grid) : null) }),
    }),
    {},
  )
  cleanups.push(view.unmount)
  function commit() {
    revision.value = {}
  }
  return {
    keys,
    columns,
    start,
    enabled,
    metadata,
    active,
    origin,
    scale,
    media,
    document,
    markers,
    records,
    visualOffsets,
    events,
    reads,
    animate,
    element,
    view,
    commit,
    register: (...args: Parameters<typeof motion.registerItem>) => motion.registerItem(...args),
  }
}

describe('virtual keyed movement (Node lifecycle with injected boxes)', () => {
  it('releases document-hidden motion without replaying it on a metadata update', async () => {
    const grid = mountGrid(80)
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    grid.document.visibilityState = 'hidden'
    grid.document.dispatchEvent(new Event('visibilitychange'))
    for (const event of grid.events) expect(event.cancel).toHaveBeenCalledOnce()
    expect([...grid.records.values()].every((x) => !x.markers.has('data-am-grid-moving'))).toBe(
      true,
    )
    grid.reads.mockClear()
    grid.metadata.value++
    await nextTick()
    expect(grid.reads).not.toHaveBeenCalled()
  })
  it('rejects a stale unregister after the same keyed slot is registered again', async () => {
    const grid = mountGrid(80)
    const original = grid.records.get('occurrence:3')!
    const release = grid.register('occurrence:3', original.slot, original.surface)
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    const current = grid.events.find((x) => x.key === 'occurrence:3')!
    original.release()
    expect(current.cancel).not.toHaveBeenCalled()
    expect(original.markers.has('data-am-grid-moving')).toBe(true)
    release()
    expect(current.cancel).toHaveBeenCalledOnce()
    expect(original.markers.has('data-am-grid-moving')).toBe(false)
  })
  it('keeps bounded render holds through rapid rebase and releases them after the latest finish', async () => {
    const grid = mountGrid(10_000)
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    const record = grid.records.get('occurrence:3')!
    expect(record.markers.has('data-am-grid-moving')).toBe(true)
    const previous = [...grid.events]
    grid.visualOffsets.set('occurrence:3', { x: -50, y: 10 })
    previous[0]!.cancel.mockImplementation(() => {
      expect(record.markers.has('data-am-grid-moving')).toBe(true)
    })
    grid.columns.value = 3
    grid.commit()
    await nextTick()
    for (const event of previous) event.animation.dispatchEvent(new Event('finish'))
    expect(record.markers.has('data-am-grid-moving')).toBe(true)
    expect(grid.records.size).toBe(12)
    for (const event of grid.events.slice(previous.length))
      event.animation.dispatchEvent(new Event('finish'))
    expect(record.markers.has('data-am-grid-moving')).toBe(false)
  })
  it('does no geometry reads or animation for window ingress, metadata or unchanged revision', async () => {
    const grid = mountGrid()
    grid.start.value = 3_000
    await nextTick()
    grid.metadata.value++
    grid.keys.value = [...grid.keys.value]
    await nextTick()
    expect(grid.records.size).toBe(12)
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.element.getBoundingClientRect).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
  })

  it.each([80, 1_000, 10_000])(
    'reads only the mounted intersection for %i occurrences, before any animation writes',
    async (count) => {
      const grid = mountGrid(count)
      const previous = grid.keys.value
      grid.keys.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
      grid.commit()
      await nextTick()
      expect(grid.reads).toHaveBeenCalledTimes(24)
      expect(grid.element.getBoundingClientRect).toHaveBeenCalledTimes(2)
      expect(grid.animate).toHaveBeenCalledTimes(2)
      expect(grid.animate).toHaveBeenCalledWith(
        [{ transform: 'translate(-100px, 0px)' }, { transform: 'translate(0, 0)' }],
        { duration: 240, easing: 'ease-in-out' },
      )
      expect(grid.animate.mock.invocationCallOrder[0]).toBeGreaterThan(
        grid.reads.mock.invocationCallOrder.at(-1)!,
      )
    },
  )

  it('animates stable occurrences across columns without indexing them by mounted child position', async () => {
    const grid = mountGrid()
    grid.start.value = 300
    await nextTick()
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    expect(grid.animate).toHaveBeenCalledTimes(12)
    const index = grid.animate.mock.contexts.findIndex(({ key }) => key === 'occurrence:300')
    expect(grid.animate.mock.calls[index]?.[0]).toEqual([
      { transform: 'translate(0px, -1000px)' },
      { transform: 'translate(0, 0)' },
    ])
  })

  it('animates only old/new mounted keys when an actual layout change also shifts the window', async () => {
    const grid = mountGrid(80)
    grid.start.value = 6
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    expect(grid.reads).toHaveBeenCalledTimes(18)
    expect(grid.animate).toHaveBeenCalledTimes(6)
    expect(grid.animate.mock.contexts.map(({ key }) => key)).toEqual(
      Array.from({ length: 6 }, (_, index) => `occurrence:${index + 6}`),
    )
  })

  it('starts a rapid reversal from the current visual frame before cancelling old animation', async () => {
    const grid = mountGrid(80)
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    const previous = [...grid.events]
    grid.visualOffsets.set('occurrence:3', { x: -50, y: 10 })
    grid.reads.mockClear()
    grid.animate.mockClear()
    grid.columns.value = 3
    grid.commit()
    await nextTick()
    for (const { cancel } of previous) {
      expect(cancel).toHaveBeenCalledOnce()
      expect(cancel.mock.invocationCallOrder[0]).toBeGreaterThan(
        grid.reads.mock.invocationCallOrder[11]!,
      )
    }
    const index = grid.animate.mock.contexts.findIndex(({ key }) => key === 'occurrence:3')
    expect(grid.animate.mock.calls[index]?.[0]).toEqual([
      { transform: 'translate(50px, 10px)' },
      { transform: 'translate(0, 0)' },
    ])
  })

  it.each(['data-am-grid-dragging', 'data-am-grid-landing'])(
    'cancels active FLIP and skips new layout motion for %s',
    async (marker) => {
      const grid = mountGrid(80)
      grid.columns.value = 2
      grid.commit()
      await nextTick()
      const previous = [...grid.events]
      grid.reads.mockClear()
      grid.animate.mockClear()
      if (marker === 'data-am-grid-dragging') grid.markers.set(marker, '')
      else grid.records.get('occurrence:0')!.markers.set(marker, '')
      grid.metadata.value++
      await nextTick()
      for (const { cancel } of previous) expect(cancel).toHaveBeenCalledOnce()
      grid.columns.value = 3
      grid.commit()
      await nextTick()
      expect(grid.reads).not.toHaveBeenCalled()
      expect(grid.animate).not.toHaveBeenCalled()
    },
  )

  it('cancels removed-window animation, without animating entering occurrences', async () => {
    const grid = mountGrid(80)
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    const previous = [...grid.events]
    grid.reads.mockClear()
    grid.animate.mockClear()
    grid.start.value = 30
    await nextTick()
    for (const { cancel } of previous) expect(cancel).toHaveBeenCalledOnce()
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
  })

  it('cancels active animation immediately when reduced motion changes and removes the listener', async () => {
    const grid = mountGrid(80)
    const remove = vi.spyOn(grid.media, 'removeEventListener')
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    const previous = [...grid.events]
    grid.media.matches = true
    grid.media.dispatchEvent(new Event('change'))
    for (const { cancel } of previous) expect(cancel).toHaveBeenCalledOnce()
    grid.reads.mockClear()
    grid.animate.mockClear()
    grid.columns.value = 3
    grid.commit()
    await nextTick()
    expect(grid.reads).not.toHaveBeenCalled()
    expect(grid.animate).not.toHaveBeenCalled()
    grid.view.unmount()
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('cleans up finished animation, deactivation, disabled state and disposal', async () => {
    const grid = mountGrid(80)
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    const first = grid.events[0]!
    first.animation.dispatchEvent(new Event('finish'))
    grid.enabled.value = false
    await nextTick()
    expect(first.cancel).not.toHaveBeenCalled()
    for (const { cancel } of grid.events.slice(1)) expect(cancel).toHaveBeenCalledOnce()
    grid.events.length = 0
    grid.enabled.value = true
    grid.columns.value = 3
    grid.commit()
    await nextTick()
    grid.active.value = false
    await nextTick()
    for (const { cancel } of grid.events) expect(cancel).toHaveBeenCalledOnce()
    grid.events.length = 0
    grid.active.value = true
    await nextTick()
    grid.columns.value = 2
    grid.commit()
    await nextTick()
    grid.view.unmount()
    for (const { cancel } of grid.events) expect(cancel).toHaveBeenCalledOnce()
  })

  it('normalizes scrolling origins and scaled ancestors into local transform coordinates', async () => {
    const grid = mountGrid(80)
    const previous = grid.keys.value
    grid.keys.value = [previous[1]!, previous[0]!, ...previous.slice(2)]
    grid.origin.value = 600
    grid.scale.value = 2
    grid.commit()
    await nextTick()
    expect(grid.animate).toHaveBeenCalledWith(
      [{ transform: 'translate(-100px, 0px)' }, { transform: 'translate(0, 0)' }],
      { duration: 240, easing: 'ease-in-out' },
    )
  })
})
