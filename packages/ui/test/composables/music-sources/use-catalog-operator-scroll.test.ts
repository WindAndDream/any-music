import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { useCatalogOperatorScroll } from '../../../src/composables/music-sources/use-catalog-operator-scroll'
import {
  CatalogTestElement,
  mountCatalogComponent,
} from '../../components/music-sources/catalog-test-renderer'

/** 只模拟滚动尺寸与捕获能力，验证指针和观察器生命周期，不启动界面。 */
class ScrollElement extends CatalogTestElement {
  scrollWidth = 472
  clientWidth = 240
  scrollLeft = 0
  offsetLeft = 0
  offsetWidth = 112
  pointerId: number | undefined
  setPointerCapture = vi.fn((id: number) => {
    this.pointerId = id
  })
  hasPointerCapture(id: number) {
    return this.pointerId === id
  }
  releasePointerCapture = vi.fn(() => {
    this.pointerId = undefined
  })
  scrollTo = vi.fn((options: ScrollToOptions) => {
    this.scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, options.left ?? 0))
  })
}

let observerCallback: () => void
const observe = vi.fn()
const disconnect = vi.fn()
const views: ReturnType<typeof mountCatalogComponent>[] = []
const matchMedia = vi.fn(() => ({ matches: false }))

beforeEach(() => {
  vi.stubGlobal('HTMLElement', ScrollElement)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { matchMedia }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        observerCallback = callback
      }
      observe = observe
      disconnect = disconnect
    },
  )
  vi.clearAllMocks()
  matchMedia.mockReturnValue({ matches: false })
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.unstubAllGlobals()
})

function mountScroll() {
  const container = new ScrollElement('container')
  const viewport = new ScrollElement('viewport')
  const content = new ScrollElement('content')
  content.children = [0, 120, 240, 360].map((left) =>
    Object.assign(new ScrollElement('button'), { offsetLeft: left }),
  )
  let scroll!: ReturnType<typeof useCatalogOperatorScroll>
  const host = defineComponent({
    setup() {
      scroll = useCatalogOperatorScroll({
        container: () => container as unknown as HTMLElement,
        viewport: () => viewport as unknown as HTMLElement,
        content: () => content as unknown as HTMLElement,
      })
      return () => h('div')
    },
  })
  const view = mountCatalogComponent(host, {})
  views.push(view)
  return { scroll, container, viewport, content, view }
}

function pointer(x: number, y = 0, overrides: Partial<PointerEvent> = {}) {
  return {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as PointerEvent
}
function click(detail = 1) {
  return { detail, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent
}

describe('useCatalogOperatorScroll', () => {
  it('aligns arrow advances to the next clipped button, returns from the end, and respects reduced motion', () => {
    const { scroll, container, viewport } = mountScroll()
    expect(scroll.hasOverflow.value).toBe(true)
    expect(observe).toHaveBeenCalledTimes(3)
    scroll.advance()
    expect(viewport.scrollTo).toHaveBeenLastCalledWith({ left: 240, behavior: 'smooth' })
    scroll.updateScroll()
    expect(scroll.isAtEnd.value).toBe(true)
    matchMedia.mockReturnValue({ matches: true })
    scroll.advance()
    expect(viewport.scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'instant' })
    scroll.updateScroll()
    expect(scroll.isAtEnd.value).toBe(false)
    viewport.clientWidth = 500
    container.clientWidth = 500
    observerCallback()
    expect(scroll.hasOverflow.value).toBe(false)
  })

  it('leaves scrolling as soon as the buttons fit the full row, even while the arrow still occupies space', () => {
    const { scroll, container, viewport, content } = mountScroll()
    expect(scroll.hasOverflow.value).toBe(true)
    container.clientWidth = 472
    viewport.clientWidth = 424
    observerCallback()
    expect(scroll.hasOverflow.value).toBe(false)
    expect(scroll.isAtEnd.value).toBe(false)
    scroll.advance()
    expect(viewport.scrollTo).not.toHaveBeenCalled()

    container.clientWidth = 280
    viewport.clientWidth = 232
    observerCallback()
    expect(scroll.hasOverflow.value).toBe(true)
    // 命名按钮消失后，剩下的按钮足够放进整行，也应恢复居中布局。
    content.scrollWidth = 240
    viewport.scrollWidth = 240
    observerCallback()
    expect(scroll.hasOverflow.value).toBe(false)
  })

  it.each(['mouse', 'touch'])(
    'drags with %s, suppresses the endpoint click, and preserves keyboard clicks',
    (pointerType) => {
      const { scroll, viewport } = mountScroll()
      scroll.handlePointerDown(pointer(200, 0, { pointerType }))
      scroll.handlePointerMove(pointer(110, 3, { pointerType }))
      expect(viewport.scrollLeft).toBe(90)
      expect(viewport.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1)
      scroll.handlePointerUp(pointer(80, 3, { pointerType }))
      expect(viewport.scrollLeft).toBe(120)
      expect(viewport.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
      const keyboard = click(0)
      scroll.handleClick(keyboard)
      expect(keyboard.preventDefault).not.toHaveBeenCalled()
      const endpoint = click()
      scroll.handleClick(endpoint)
      expect(endpoint.preventDefault).toHaveBeenCalledOnce()
      scroll.handlePointerDown(pointer(100))
      scroll.handlePointerUp(pointer(100))
      const ordinary = click()
      scroll.handleClick(ordinary)
      expect(ordinary.preventDefault).not.toHaveBeenCalled()
    },
  )

  it('locks vertical gestures, ignores secondary pointers, and releases capture on cancel and unmount', () => {
    const { scroll, viewport, view } = mountScroll()
    scroll.handlePointerDown(pointer(200))
    scroll.handlePointerMove(pointer(198, 30))
    scroll.handlePointerUp(pointer(20, 31))
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.setPointerCapture).not.toHaveBeenCalled()
    scroll.handlePointerDown(pointer(200, 0, { button: 2 }))
    scroll.handlePointerUp(pointer(20))
    expect(viewport.scrollLeft).toBe(0)
    scroll.handlePointerDown(pointer(200))
    scroll.handlePointerMove(pointer(100, 0, { pointerId: 2 }))
    expect(viewport.scrollLeft).toBe(0)
    scroll.handlePointerMove(pointer(100))
    scroll.handlePointerCancel(pointer(100))
    expect(viewport.releasePointerCapture).toHaveBeenCalledOnce()
    scroll.handlePointerUp(pointer(20))
    expect(viewport.scrollLeft).toBe(100)
    scroll.handlePointerDown(pointer(200))
    scroll.handlePointerMove(pointer(100))
    view.unmount()
    views.splice(views.indexOf(view), 1)
    expect(viewport.releasePointerCapture).toHaveBeenCalledTimes(2)
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
