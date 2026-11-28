import { invoke } from '@tauri-apps/api/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import type { CatalogAction, CatalogSnapshot } from '../../src/catalog-webview/contracts'
import { useCatalogWebview } from '../../src/platform/use-catalog-webview'
import { nodes, renderer, TestNode } from '../fixtures/node-renderer'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('document', new EventTarget())
  vi.stubGlobal('ShadowRoot', class extends EventTarget {})
  vi.stubGlobal('innerWidth', 800)
  vi.stubGlobal('innerHeight', 600)
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('matchMedia', () => ({ matches: innerWidth <= 600 }))
  vi.stubGlobal('getComputedStyle', () => ({ padding: '0px 16px 24px' }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16),
  )
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.mocked(invoke).mockImplementation(
    async <T>(command: string) =>
      (command === 'sync_catalog_webview' ? { ready: true, scrollTop: 320 } : undefined) as T,
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function mountViewport(box = { left: 0, top: 0, right: 800, bottom: 600 }) {
  const covered = shallowRef(false)
  const region = {
    isConnected: true,
    getRootNode: () => document,
    getBoundingClientRect: () => box,
    contains: (element: unknown) => element === region,
  }
  Object.assign(document, { elementFromPoint: () => (covered.value ? null : region) })
  const viewport = shallowRef({
    isConnected: true,
    parentElement: region,
  } as unknown as HTMLElement)
  const mounted = shallowRef(true)
  const ready = shallowRef(false)
  const suspended = shallowRef(false)
  const onAction = vi.fn((action: CatalogAction) => {
    if (action.type === 'actions') suspended.value = true
  })
  let scrollTop = 0
  let openDisplay!: () => void
  const snapshot = { tracks: [] } as unknown as CatalogSnapshot
  const Viewport = defineComponent({
    setup() {
      const { openOverlay } = useCatalogWebview(viewport, {
        accountId: 'test-account',
        query: 'test search',
        get suspended() {
          return suspended.value
        },
        snapshot,
        setReady: (value) => (ready.value = value),
        onAction,
        readScroll: () => scrollTop,
        saveScroll: (value) => (scrollTop = value),
      })
      openDisplay = () => openOverlay(() => (suspended.value = true))
      return () => h('div')
    },
  })
  const root = new TestNode('root')
  const app = renderer.createApp({
    render: () => [mounted.value && h(Viewport), !ready.value && h('ul')],
  })
  app.mount(root)
  return {
    mounted,
    covered,
    suspended,
    openDisplay,
    onAction,
    fallback: () => nodes(root).some(({ tag }) => tag === 'ul'),
    readScroll: () => scrollTop,
    unmount: () => app.unmount(),
  }
}

it('opens display settings after native parking and restores the latest scroll after the scrim leaves', async () => {
  const view = mountViewport()
  await vi.advanceTimersByTimeAsync(32)
  expect(view.fallback()).toBe(false)
  expect(view.readScroll()).toBe(320)

  const park = deferred<{ ready: boolean }>()
  vi.mocked(invoke)
    .mockResolvedValueOnce({ ready: true, scrollTop: 465 })
    .mockReturnValueOnce(park.promise)
  view.openDisplay()
  await vi.advanceTimersByTimeAsync(0)
  expect(view.fallback()).toBe(true)
  expect(view.readScroll()).toBe(465)
  expect(view.suspended.value).toBe(false)
  const initial = vi.mocked(invoke).mock.calls[0]?.[1] as { request: { lease: string } } | undefined
  const lease = initial?.request.lease
  expect(lease).toEqual(expect.any(String))
  const parked = {
    request: { lease, accountId: 'test-account', query: 'test search' },
  }
  await vi.advanceTimersByTimeAsync(16)
  expect(invoke).not.toHaveBeenCalledWith('sync_catalog_webview', parked)
  await vi.advanceTimersByTimeAsync(16)
  expect(invoke).toHaveBeenLastCalledWith('sync_catalog_webview', parked)
  expect(view.suspended.value).toBe(false)
  park.resolve({ ready: false })
  await vi.advanceTimersByTimeAsync(0)
  expect(view.suspended.value).toBe(true)

  view.covered.value = true
  view.suspended.value = false
  await vi.advanceTimersByTimeAsync(100)
  expect(invoke).toHaveBeenLastCalledWith('sync_catalog_webview', parked)
  expect(view.fallback()).toBe(true)
  view.covered.value = false
  vi.mocked(invoke).mockResolvedValueOnce({ ready: true, scrollTop: 465 })
  await vi.advanceTimersByTimeAsync(50)
  expect(view.fallback()).toBe(true)
  expect(invoke).toHaveBeenLastCalledWith('sync_catalog_webview', {
    request: expect.objectContaining({
      lease,
      bounds: expect.any(Object),
      snapshot: expect.objectContaining({ scrollTop: 465 }),
    }),
  })
  await vi.advanceTimersByTimeAsync(32)
  expect(view.fallback()).toBe(false)
  expect(view.readScroll()).toBe(465)
  view.unmount()
})

it('keeps ordinary song actions in the current surface and paints before opening song actions', async () => {
  const view = mountViewport()
  await vi.advanceTimersByTimeAsync(32)
  const actions: CatalogAction[] = [
    { type: 'select', id: 'track' },
    { type: 'favorite', id: 'track' },
    { type: 'play', id: 'track' },
    { type: 'download', id: 'track' },
    { type: 'more' },
  ]
  vi.mocked(invoke).mockResolvedValueOnce({ ready: true, scrollTop: 640, actions })
  await vi.advanceTimersByTimeAsync(70)
  expect(view.onAction.mock.calls.map(([action]) => action)).toEqual(actions)
  expect(view.fallback()).toBe(false)
  expect(invoke).toHaveBeenCalledTimes(2)

  vi.mocked(invoke).mockResolvedValueOnce({
    ready: true,
    scrollTop: 645,
    actions: [{ type: 'actions', id: 'track' }],
  })
  await vi.advanceTimersByTimeAsync(70)
  expect(view.fallback()).toBe(true)
  expect(view.readScroll()).toBe(645)
  expect(invoke).toHaveBeenCalledTimes(3)
  expect(view.onAction).toHaveBeenCalledTimes(actions.length)
  await vi.advanceTimersByTimeAsync(32)
  expect(invoke).toHaveBeenCalledTimes(4)
  expect(view.onAction).toHaveBeenLastCalledWith({ type: 'actions', id: 'track' })
  view.unmount()
})

it('keeps the app list mounted when display settings are clicked during the first placement', async () => {
  const placement = deferred<{ ready: boolean; scrollTop: number }>()
  vi.mocked(invoke).mockReturnValueOnce(placement.promise)
  const view = mountViewport()
  view.openDisplay()
  await vi.advanceTimersByTimeAsync(0)
  expect(view.fallback()).toBe(true)
  expect(view.suspended.value).toBe(false)

  placement.resolve({ ready: true, scrollTop: 75 })
  await vi.advanceTimersByTimeAsync(32)
  expect(view.fallback()).toBe(true)
  expect(view.suspended.value).toBe(true)
  expect(view.readScroll()).toBe(75)
  view.unmount()
})

it('keeps the fallback in place when a pre-overlay sync answers after a quick close', async () => {
  const view = mountViewport()
  await vi.advanceTimersByTimeAsync(32)
  const late = deferred<{ ready: boolean; actions: CatalogAction[] }>()
  vi.mocked(invoke).mockReturnValueOnce(late.promise)
  await vi.advanceTimersByTimeAsync(70)
  view.suspended.value = true
  await vi.advanceTimersByTimeAsync(32)
  view.suspended.value = false

  late.resolve({ ready: true, actions: [{ type: 'actions', id: 'stale' }] })
  await vi.advanceTimersByTimeAsync(0)
  expect(view.fallback()).toBe(true)
  expect(view.onAction).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenLastCalledWith('sync_catalog_webview', {
    request: { lease: expect.any(String), accountId: 'test-account', query: 'test search' },
  })
  await vi.advanceTimersByTimeAsync(150 + 32)
  expect(view.fallback()).toBe(false)
  view.unmount()
})

it('uses the main window grid breakpoint and keeps the full list geometry when resuming', async () => {
  vi.stubGlobal('devicePixelRatio', 1.25)
  const box = { left: 30.5, top: 40, right: 530.5, bottom: 440 }
  const view = mountViewport(box)
  await vi.advanceTimersByTimeAsync(32)
  expect(invoke).toHaveBeenLastCalledWith('sync_catalog_webview', {
    request: expect.objectContaining({
      bounds: { x: 30.4, y: 40, width: 500, height: 400 },
      snapshot: expect.objectContaining({
        layout: { padding: '0px 16px 24px', viewportSize: 'wide' },
      }),
    }),
  })
  // A clipped viewport would change the scroll range when switching surfaces.
  box.top = -20
  await vi.advanceTimersByTimeAsync(70 + 32)
  expect(view.fallback()).toBe(true)
  expect(invoke).toHaveBeenLastCalledWith('sync_catalog_webview', {
    request: { lease: expect.any(String), accountId: 'test-account', query: 'test search' },
  })
  view.unmount()
})

it('drops an unopened dialog when its list lease is removed', async () => {
  const view = mountViewport()
  await vi.advanceTimersByTimeAsync(32)
  const park = deferred<{ ready: boolean }>()
  vi.mocked(invoke)
    .mockResolvedValueOnce({ ready: true, scrollTop: 320 })
    .mockReturnValueOnce(park.promise)
  view.openDisplay()
  await vi.advanceTimersByTimeAsync(32)
  view.mounted.value = false
  await nextTick()
  park.resolve({ ready: false })
  await vi.advanceTimersByTimeAsync(32)
  expect(view.suspended.value).toBe(false)
  view.unmount()
})

it('puts retained rows behind the child before closing the exhausted results lease', async () => {
  const view = mountViewport()
  await vi.advanceTimersByTimeAsync(32)
  expect(view.fallback()).toBe(false)
  view.mounted.value = false
  await nextTick()

  expect(view.fallback()).toBe(true)
  expect(view.readScroll()).toBe(320)
  expect(invoke).not.toHaveBeenCalledWith('close_catalog_webview', expect.anything())
  await vi.advanceTimersByTimeAsync(32)
  expect(invoke).toHaveBeenLastCalledWith('close_catalog_webview', { lease: expect.any(String) })
  view.unmount()
})

it('parks a leaving list immediately while a native placement is still in flight', async () => {
  const placement = deferred<{ ready: boolean; actions: CatalogAction[] }>()
  vi.mocked(invoke).mockReturnValueOnce(placement.promise)
  const view = mountViewport()
  view.mounted.value = false
  await nextTick()
  expect(invoke).toHaveBeenCalledWith('sync_catalog_webview', {
    request: { lease: expect.any(String), accountId: 'test-account', query: 'test search' },
  })

  placement.resolve({ ready: true, actions: [{ type: 'more' }] })
  await vi.advanceTimersByTimeAsync(0)
  expect(view.fallback()).toBe(true)
  expect(view.onAction).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenLastCalledWith('close_catalog_webview', { lease: expect.any(String) })
  view.unmount()
})
