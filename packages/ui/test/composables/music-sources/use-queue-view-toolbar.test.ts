import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, shallowRef } from 'vue'

import { useQueueViewToolbar } from '../../../src/composables/music-sources/use-queue-view-toolbar'
import { mountCatalogComponent } from '../../components/music-sources/catalog-test-renderer'

interface ObserverStub {
  notify: (entries: IntersectionObserverEntry[]) => void
  observe: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  options?: IntersectionObserverInit
}
const observers: ObserverStub[] = []
const views: ReturnType<typeof mountCatalogComponent>[] = []
const matchMedia = vi.fn(() => ({ matches: false }))

beforeEach(() => {
  observers.length = 0
  matchMedia.mockReturnValue({ matches: false })
  vi.stubGlobal('window', { matchMedia })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '220ms' }))
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
      readonly notify: ObserverStub['notify']
      readonly options?: IntersectionObserverInit
      constructor(callback: ObserverStub['notify'], options?: IntersectionObserverInit) {
        this.notify = callback
        this.options = options
        observers.push(this)
      }
    },
  )
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.unstubAllGlobals()
})

function notify(observer: ObserverStub, top: number, isIntersecting = false): void {
  observer.notify([
    {
      boundingClientRect: { top },
      rootBounds: { top: 20 },
      isIntersecting,
    } as IntersectionObserverEntry,
  ])
}
function mountToolbar() {
  let toolbar!: ReturnType<typeof useQueueViewToolbar>
  const root = {} as HTMLElement
  const marker = { closest: vi.fn(() => root) } as unknown as HTMLElement
  const cancel = vi.fn()
  const animate = vi.fn(() => ({ cancel }) as unknown as Animation)
  let renderedLeft = 320
  const arrangement = {
    isConnected: true,
    getBoundingClientRect: () => ({ left: renderedLeft }),
    animate,
  } as unknown as HTMLElement
  const active = shallowRef(true)
  const child = defineComponent({
    setup() {
      toolbar = useQueueViewToolbar({ marker: () => marker, arrangement: () => arrangement })
      return () => {
        // 模拟 Vue 提交布局后才改变 DOM 位置，不能让 ref 写入同步改变测量值。
        renderedLeft = toolbar.isPinned.value ? 0 : 320
        return h('div')
      }
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () => h(KeepAlive, null, { default: () => (active.value ? h(child) : null) }),
    }),
    {},
  )
  views.push(view)
  return { toolbar, root, marker, arrangement, animate, cancel, active, view }
}

describe('useQueueViewToolbar', () => {
  it('observes the shell scroll area and pins only after crossing its upper edge', async () => {
    const test = mountToolbar()
    await nextTick()
    const observer = observers.at(-1)!
    expect(observer.options?.root).toBe(test.root)
    expect(observer.observe).toHaveBeenCalledWith(test.marker)
    notify(observer, 900)
    expect(test.toolbar.isPinned.value).toBe(false)
    notify(observer, 21, true)
    expect(test.toolbar.isPinned.value).toBe(false)
    notify(observer, 19)
    expect(test.toolbar.isPinned.value).toBe(true)
    await nextTick()
    expect(test.animate).toHaveBeenLastCalledWith(
      [{ transform: 'translateX(320px)' }, { transform: 'translateX(0)' }],
      expect.objectContaining({ duration: 220 }),
    )
    // 同一个观察器必须继续接收回滚和再次吸顶，动画代次不能使后续观察失效。
    notify(observer, 21, true)
    await nextTick()
    expect(test.toolbar.isPinned.value).toBe(false)
    expect(test.cancel).toHaveBeenCalledOnce()
    expect(test.animate).toHaveBeenLastCalledWith(
      [{ transform: 'translateX(-320px)' }, { transform: 'translateX(0)' }],
      expect.any(Object),
    )
    notify(observer, 19)
    await nextTick()
    expect(test.toolbar.isPinned.value).toBe(true)
    expect(test.animate).toHaveBeenCalledTimes(3)
  })

  it('discards superseded animation work on rapid boundary crossings', async () => {
    const test = mountToolbar()
    await nextTick()
    const observer = observers.at(-1)!
    notify(observer, 19)
    notify(observer, 21, true)
    await nextTick()
    expect(test.toolbar.isPinned.value).toBe(false)
    expect(test.animate).not.toHaveBeenCalled()
  })

  it('keeps sticky alignment without animation when motion is reduced or Web Animations is absent', async () => {
    const test = mountToolbar()
    await nextTick()
    const observer = observers.at(-1)!
    matchMedia.mockReturnValue({ matches: true })
    notify(observer, 19)
    await nextTick()
    expect(test.toolbar.isPinned.value).toBe(true)
    expect(test.animate).not.toHaveBeenCalled()
    matchMedia.mockReturnValue({ matches: false })
    Object.assign(test.arrangement, { animate: undefined })
    notify(observer, 21, true)
    await nextTick()
    expect(test.toolbar.isPinned.value).toBe(false)
    expect(test.animate).not.toHaveBeenCalled()
  })

  it('disconnects while cached, observes again on activation and ignores stale callbacks after disposal', async () => {
    const test = mountToolbar()
    await nextTick()
    const original = observers.at(-1)!
    notify(original, 19)
    await nextTick()
    test.active.value = false
    await nextTick()
    expect(original.disconnect).toHaveBeenCalled()
    expect(test.cancel).toHaveBeenCalled()
    notify(original, 21, true)
    expect(test.toolbar.isPinned.value).toBe(true)
    test.active.value = true
    await nextTick()
    const current = observers.at(-1)!
    expect(current).not.toBe(original)
    notify(current, 21, true)
    await nextTick()
    expect(test.toolbar.isPinned.value).toBe(false)
    notify(current, 19)
    test.view.unmount()
    await nextTick()
    expect(current.disconnect).toHaveBeenCalled()
    expect(test.animate).toHaveBeenCalledTimes(2)
    notify(current, 21, true)
    expect(test.toolbar.isPinned.value).toBe(true)
  })
})
