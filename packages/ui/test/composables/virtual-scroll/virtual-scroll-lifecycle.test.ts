import { describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, h, nextTick, onScopeDispose, shallowRef, watch } from 'vue'
import type { Component } from 'vue'

import VirtualTrackCardGrid from '../../../src/components/virtual-scroll/VirtualTrackCardGrid.vue'
import {
  useMeasuredVirtualGrid,
  useMeasuredVirtualList,
  useVirtualItemRetention,
  useVirtualScrollAnchor,
} from '../../../src/virtual-scroll'
import { findCatalogElement } from '../../components/music-sources/catalog-test-renderer'
import { mountVirtualGridComponent } from '../../fixtures/virtual-scroll/grid-test-renderer'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
  await nextTick()
}

/** Count live registrations, including local item listeners, rather than accumulated calls. */
function listenerIdentity(type: string, options?: boolean | AddEventListenerOptions) {
  return `${type}:${typeof options === 'boolean' ? options : (options?.capture ?? false)}`
}

function trackListeners(target: EventTarget) {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const add = target.addEventListener.bind(target)
  const remove = target.removeEventListener.bind(target)
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener) {
      const key = listenerIdentity(type, options)
      const registered = listeners.get(key) ?? new Set()
      registered.add(listener)
      listeners.set(key, registered)
    }
    add(type, listener, options)
  })
  vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
    if (listener) listeners.get(listenerIdentity(type, options))?.delete(listener)
    remove(type, listener, options)
  })
  return () => [...listeners.values()].reduce((count, registered) => count + registered.size, 0)
}

function setup(grid: boolean, nativeObservers = true) {
  const env = createResizeEnvironment()
  if (!nativeObservers) Object.assign(env.view, { ResizeObserver: undefined })
  Object.assign(env.document, { activeElement: null })
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  Object.assign(env.view, {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    }),
    cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
  })
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document)
  root.scrollTop = 0
  root.clientHeight = 100
  const declarations = new Map([['overflow-anchor', 'auto']])
  Object.assign(root, {
    style: {
      getPropertyValue: (name: string) => declarations.get(name) ?? '',
      getPropertyPriority: () => '',
      setProperty: (name: string, value: string) => declarations.set(name, value),
      removeProperty: (name: string) => declarations.delete(name),
    },
  })
  list.getBoundingClientRect.mockImplementation(
    () => ({ ...list.rect, top: root.rect.top + root.clientTop - root.scrollTop }) as DOMRect,
  )
  const listenerCounts = [trackListeners(root), trackListeners(list), trackListeners(env.view)]
  const items = shallowRef(Array.from({ length: 10_000 }, (_, key) => ({ key, revision: 0 })))
  const columns = shallowRef(grid ? 3 : 1),
    enabled = shallowRef(true),
    layoutGeneration = shallowRef(0),
    retainedIndexes = shallowRef<readonly number[]>([])
  const scope = effectScope()
  const options = {
    items,
    enabled,
    layoutGeneration,
    retainedIndexes,
    estimatedItemSize: 20,
    getItemKey: (item: { key: number }) => item.key,
    getContentGeneration: (item: { revision: number }) => item.revision,
    scrollElement: root.asElement(),
    listElement: list.asElement(),
    cacheLimit: 64,
    gap: 2,
  }
  const result = scope.run(() =>
    grid ? useMeasuredVirtualGrid({ ...options, columns }) : useMeasuredVirtualList(options),
  )!
  const anchor = scope.run(() =>
    useVirtualScrollAnchor({ context: result.context, geometry: result.geometry }),
  )!
  const retention = scope.run(() =>
    useVirtualItemRetention({
      context: result.context,
      geometry: result.geometry,
      beforeScroll: anchor.cancel,
      limit: 4,
    }),
  )!
  const mounted = new Map<number, { element: VirtualElement; release: () => void }>()
  let mountedCount = 0,
    releasedCount = 0
  scope.run(() => {
    watch(retention.retainedIndexes, (indexes) => (retainedIndexes.value = indexes), {
      immediate: true,
      flush: 'sync',
    })
    watch(
      result.virtualItems,
      (window) => {
        const keys = new Set(window.map((item) => item.key))
        for (const [key, row] of mounted)
          if (!keys.has(key)) {
            row.release()
            mounted.delete(key)
          }
        for (const item of window) {
          const key = Number(item.key)
          if (mounted.has(key)) continue
          const element = new VirtualElement(env.document)
          element.rect.height = 20
          Object.assign(element, {
            nodeType: 1,
            contains: (target: unknown) => target === element,
            getRootNode: () => env.document,
            focus: vi.fn(() => Object.assign(env.document, { activeElement: element })),
          })
          listenerCounts.push(trackListeners(element))
          const releaseHeight = result.measurements.observeItem(key, element.asElement())
          const releaseInteraction = retention.registerItem(key, element.asElement())
          mountedCount++
          mounted.set(key, {
            element,
            release() {
              releaseHeight()
              releaseInteraction()
              releasedCount++
            },
          })
        }
      },
      { immediate: true, flush: 'post' },
    )
    onScopeDispose(() => {
      for (const row of mounted.values()) row.release()
      mounted.clear()
    })
  })
  const observedTargets = () =>
    env.observers.reduce(
      (count, observer) =>
        count + observer.observe.mock.calls.length - observer.unobserve.mock.calls.length,
      0,
    )
  const notify = (targets: Element[]) =>
    env.observers
      .findLast(
        (observer) =>
          !observer.disconnect.mock.calls.length &&
          observer.observe.mock.calls.some(([target]) => target === root.asElement()),
      )!
      .notify(targets)
  return {
    ...env,
    root,
    list,
    items,
    columns,
    enabled,
    layoutGeneration,
    result,
    anchor,
    retention,
    mounted,
    frames,
    declarations,
    observedTargets,
    notify,
    listeners: () => listenerCounts.reduce((count, getCount) => count + getCount(), 0),
    scopes: () => mountedCount - releasedCount,
    stop: () => scope.stop(),
  }
}

describe('virtual foundation steady-state lifecycle (injected boxes/events, no runtime UI)', () => {
  it.each([false, true])(
    'bounds live resources through repeated windows/reflow/reorder/hide and drains on disposal (grid=%s)',
    async (grid) => {
      const test = setup(grid)
      try {
        await settle()
        const rootListeners = test.listeners() - test.mounted.size * 5
        expect(test.observers).toHaveLength(1)
        expect(test.declarations.get('overflow-anchor')).toBe('none')
        const releaseEditor = test.retention.retain(0, 'editor')!
        const releasePopover = test.retention.retain(9999, 'popover')!
        for (let pass = 0; pass < 18; pass++) {
          test.root.scrollTop = [0, 12_000, 48_000, 0, 20_000, 60_000][pass % 6]!
          test.root.dispatchEvent(new Event('scroll'))
          // eslint-disable-next-line no-await-in-loop -- Check each settled window's live resource budget.
          await settle()
          if (pass % 3 === 1) {
            test.items.value = test.items.value.toReversed()
            test.columns.value = grid ? (pass % 2 ? 2 : 3) : 1
            test.layoutGeneration.value++
            test.list.rect.width = pass % 2 ? 400 : 900
            test.notify([test.list.asElement()])
            // eslint-disable-next-line no-await-in-loop -- Reflow and reorder have distinct teardown work.
            await settle()
          }
          expect(test.mounted.size).toBeLessThanOrEqual(grid ? 36 : 12)
          expect(test.scopes()).toBe(test.mounted.size)
          expect(test.observedTargets()).toBe(test.mounted.size + 2)
          expect(test.result.measurements.cacheSize.value).toBeLessThanOrEqual(64)
          expect(test.listeners()).toBe(rootListeners + test.mounted.size * 5)
          expect(test.retention.retainedKeys.value).toEqual([0, 9999])
          expect(test.frames.size).toBe(0)
        }
        test.root.clientHeight = 0
        test.notify([test.root.asElement()])
        await settle()
        expect(test.result.virtualItems.value).toEqual([])
        expect(test.mounted.size).toBe(0)
        expect(test.observedTargets()).toBe(2)
        expect(test.declarations.get('overflow-anchor')).toBe('auto')
        expect(test.listeners()).toBe(1)
        expect(await test.retention.focusItem(300)).toBe(false)
        test.root.clientHeight = 100
        test.notify([test.root.asElement()])
        await settle()
        expect(test.observedTargets()).toBe(test.mounted.size + 2)
        expect(test.declarations.get('overflow-anchor')).toBe('none')
        test.enabled.value = false
        await settle()
        expect(test.observedTargets()).toBe(0)
        expect(test.listeners()).toBe(0)
        expect(test.scopes()).toBe(0)
        test.enabled.value = true
        await settle()
        expect(
          test.observers.filter((observer) => !observer.disconnect.mock.calls.length),
        ).toHaveLength(1)
        expect(test.observedTargets()).toBe(test.mounted.size + 2)
        releaseEditor()
        releasePopover()
        expect(test.retention.retainedKeys.value).toEqual([])
        // Disposal between scheduling and render must cancel both semantic write/focus jobs.
        const pendingFocus = test.retention.focusItem(5000)
        const offsetBeforeStop = test.root.scrollTop
        test.items.value = [{ key: 10_000, revision: 0 }, ...test.items.value]
        test.stop()
        expect(await pendingFocus).toBe(false)
        await settle()
        expect(test.root.scrollTop).toBe(offsetBeforeStop)
      } finally {
        test.stop()
      }
      expect(test.listeners()).toBe(0)
      expect(test.observedTargets()).toBe(0)
      expect(test.frames.size).toBe(0)
      expect(test.scopes()).toBe(0)
      expect(test.result.measurements.cacheSize.value).toBe(0)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.anchor.pending.value).toBe(false)
      expect(test.declarations.get('overflow-anchor')).toBe('auto')
      for (const observer of test.observers) expect(observer.disconnect).toHaveBeenCalledTimes(1)
    },
  )

  it('repeatedly mounts/disposes the no-observer fallback without per-row global listeners or late reads', async () => {
    for (let cycle = 0; cycle < 6; cycle++) {
      const test = setup(cycle % 2 === 0, false)
      try {
        // eslint-disable-next-line no-await-in-loop -- Verify a fresh scope's baseline each cycle.
        await settle()
        const rootListeners = test.listeners() - test.mounted.size * 5
        for (const offset of [20_000, 50_000, 0]) {
          test.root.scrollTop = offset
          test.root.dispatchEvent(new Event('scroll'))
          // eslint-disable-next-line no-await-in-loop -- Distant windows must release local listeners before the next allocation.
          await settle()
          expect(test.listeners()).toBe(rootListeners + test.mounted.size * 5)
        }
        test.root.clientHeight = 0
        test.view.dispatchEvent(new Event('resize'))
        // eslint-disable-next-line no-await-in-loop -- Exercise the single container fallback during a hidden phase.
        await settle()
        expect(test.mounted.size).toBe(0)
        expect(test.listeners()).toBe(2)
        test.root.clientHeight = 100
        test.view.dispatchEvent(new Event('resize'))
        // eslint-disable-next-line no-await-in-loop -- Restore observation before queuing a final measurement batch.
        await settle()
        const elements = [...test.mounted.values()].map((row) => row.element)
        for (const element of elements) element.getBoundingClientRect.mockClear()
        test.result.measurements.refresh()
        test.stop()
        // eslint-disable-next-line no-await-in-loop -- A pending read from a disposed scope must never touch old rows.
        await settle()
        for (const element of elements) expect(element.getBoundingClientRect).not.toHaveBeenCalled()
      } finally {
        test.stop()
      }
      expect(test.observers).toEqual([])
      expect(test.listeners()).toBe(0)
      expect(test.frames.size).toBe(0)
      expect(test.scopes()).toBe(0)
      expect(test.result.measurements.cacheSize.value).toBe(0)
      expect(test.retention.retainedKeys.value).toEqual([])
      expect(test.declarations.get('overflow-anchor')).toBe('auto')
    }
  })

  it('recreates real grid slot scopes without replaying explicit controller actions', async () => {
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document)
    root.clientHeight = 100
    root.scrollTop = 0
    Object.assign(env.view, {
      getComputedStyle: () => ({
        gridTemplateColumns: '300px 300px 300px',
        columnGap: '12px',
        rowGap: '12px',
      }),
    })
    const controller = {
      requestPage: vi.fn(),
      resolveMedia: vi.fn(),
      writeNamespace: vi.fn(),
    }
    const mounted = vi.fn(),
      released = vi.fn()
    const Card = defineComponent({
      props: { occurrence: { type: String, required: true } },
      setup(props) {
        mounted(props.occurrence)
        onScopeDispose(() => released(props.occurrence))
        return () =>
          h('article', [
            h('button', { onClick: () => controller.requestPage(props.occurrence) }, 'Load'),
            h('button', { onClick: () => controller.resolveMedia(props.occurrence) }, 'Play'),
            h('button', { onClick: () => controller.writeNamespace(props.occurrence) }, 'Save'),
          ])
      },
    })
    const items = Array.from({ length: 10_000 }, (_, key) => ({ key: String(key), revision: 0 }))
    const view = mountVirtualGridComponent(
      defineComponent({
        setup: () => () =>
          h(
            VirtualTrackCardGrid as unknown as Component,
            {
              items,
              getItemKey: (item: (typeof items)[number]) => item.key,
              getContentGeneration: (item: (typeof items)[number]) => item.revision,
              estimatedItemSize: 20,
              scrollElement: root.asElement(),
              displayMode: 'standard',
              mobileColumns: 1,
              cacheLimit: 32,
            },
            {
              default: ({ row }: { row: { item: (typeof items)[number] } }) =>
                h(Card, { occurrence: row.item.key }),
            },
          ),
      }),
      env.document,
    )
    try {
      await settle()
      for (const label of ['Load', 'Play', 'Save']) {
        const button = findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.text === label,
        )
        ;(button.props.onClick as () => void)()
      }
      expect(Object.values(controller).map((action) => action.mock.calls)).toEqual([
        [['0']],
        [['0']],
        [['0']],
      ])
      for (let pass = 0; pass < 12; pass++) {
        root.scrollTop = pass % 2 ? 0 : 50_000
        root.dispatchEvent(new Event('scroll'))
        // eslint-disable-next-line no-await-in-loop -- Force unmount and reconstruction of the original action-owning row.
        await settle()
        expect(mounted.mock.calls.length - released.mock.calls.length).toBeLessThanOrEqual(24)
      }
      expect(mounted.mock.calls.filter(([key]) => key === '0').length).toBe(7)
      for (const action of Object.values(controller))
        expect(action).toHaveBeenCalledExactlyOnceWith('0')
    } finally {
      view.unmount()
    }
    expect(released).toHaveBeenCalledTimes(mounted.mock.calls.length)
    for (const observer of env.observers) expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })
})
