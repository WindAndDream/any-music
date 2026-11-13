import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { useScrollPageLoader } from '../../../src/composables/music-sources/use-scroll-page-loader'
import {
  createEditingSession,
  type EditingSession,
} from '../../../src/composables/use-editing-session'
import { useFixedVirtualList } from '../../../src/virtual-scroll'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

class ScrollElement extends EventTarget {
  parentElement: ScrollElement | null = null
  overflowY = 'visible'
  scrollTop = 0
  scrollHeight = 1000
  clientHeight = 400

  scrollTo(top: number): void {
    this.scrollTop = top
    this.dispatchEvent(new Event('scroll'))
  }

  wheel(deltaY: number): void {
    this.dispatchEvent(Object.assign(new Event('wheel'), { deltaY }))
  }
}

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.unstubAllGlobals()
})

/** 用事件目标模拟详情对话框的滚动容器，验证逐页请求及卸载清理。 */
function createLoader(editing?: EditingSession, fillShortList = true) {
  vi.stubGlobal('getComputedStyle', (element: ScrollElement) => ({ overflowY: element.overflowY }))
  const container = new ScrollElement()
  container.overflowY = 'auto'
  const list = new ScrollElement()
  list.parentElement = container
  const listElement = shallowRef<HTMLElement | null>(null)
  const hasMore = shallowRef(true)
  const loading = shallowRef(false)
  const pageNumber = shallowRef(1)
  const visibleCount = shallowRef(20)
  const loadedCount = shallowRef(20)
  const loadNext = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() =>
    useScrollPageLoader({
      editing,
      listElement,
      hasMore,
      loading,
      pageNumber,
      visibleCount,
      loadedCount,
      loadNext,
      fillShortList,
    }),
  )

  return {
    container,
    listElement,
    list: list as unknown as HTMLElement,
    hasMore,
    loading,
    pageNumber,
    visibleCount,
    loadedCount,
    loadNext,
    stop: () => scope.stop(),
  }
}

class VirtualPageElement extends VirtualElement {
  // Deliberately represents only mounted content. Virtual admission must ignore it.
  scrollHeight = 200
  wheel(deltaY: number): void {
    this.dispatchEvent(Object.assign(new Event('wheel'), { deltaY }))
  }
}

function createPageState(count = 100) {
  return {
    hasMore: shallowRef(true),
    loading: shallowRef(false),
    pageNumber: shallowRef(1),
    loadedCount: shallowRef(count),
  }
}

function createVirtualLoader({
  count = 100,
  listOffset = 0,
  editing,
  fillShortList = true,
  state = createPageState(count),
}: {
  count?: number
  listOffset?: number
  editing?: EditingSession
  fillShortList?: boolean
  state?: ReturnType<typeof createPageState>
} = {}) {
  const env = createResizeEnvironment()
  // The installed engine's touch-tail lifecycle uses the element's owning window timers.
  Object.assign(env.view, {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
  const container = new VirtualPageElement(env.document)
  container.clientHeight = 400
  container.scrollTop = 0
  const list = new VirtualPageElement(env.document)
  list.rect.top = container.rect.top + container.clientTop + listOffset
  const listElement = shallowRef<HTMLElement | null>(null)
  const scrollElement = shallowRef<HTMLElement | null>(container.asElement())
  const items = shallowRef(Array.from({ length: count }, (_, index) => index))
  const itemSize = shallowRef(20)
  const enabled = shallowRef(true)
  const loadNext = vi.fn()
  const scope = effectScope()
  scopes.push(scope)
  const virtual = scope.run(() => {
    const virtualList = useFixedVirtualList({
      items,
      getItemKey: (item) => item,
      itemSize,
      listElement,
      scrollElement,
      enabled,
    })
    useScrollPageLoader({
      editing,
      listElement,
      virtualList,
      ...state,
      visibleCount: virtualList.count,
      loadNext,
      fillShortList,
    })
    return virtualList
  })!
  return {
    ...env,
    ...state,
    state,
    container,
    list,
    listElement,
    scrollElement,
    items,
    itemSize,
    enabled,
    loadNext,
    virtual,
    mount: () => {
      listElement.value = list.asElement()
    },
    scrollTo: (top: number) => {
      list.rect.top -= top - container.scrollTop
      container.scrollTop = top
      container.dispatchEvent(new Event('scroll'))
    },
    stop: () => scope.stop(),
  }
}

function swipe(element: EventTarget, start = 100, end = 60): void {
  element.dispatchEvent(Object.assign(new Event('touchstart'), { touches: [{ clientY: start }] }))
  element.dispatchEvent(Object.assign(new Event('touchmove'), { touches: [{ clientY: end }] }))
  element.dispatchEvent(Object.assign(new Event('touchend'), { touches: [] }))
}

function press(element: EventTarget, key: string): void {
  element.dispatchEvent(Object.assign(new Event('keydown'), { key }))
}

describe('useScrollPageLoader', () => {
  it('does not carry a previous scroll demand into an explicitly refreshed listing', async () => {
    const loader = createLoader(undefined, false)
    loader.listElement.value = loader.list
    await nextTick()
    loader.container.scrollTo(600)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.pageNumber.value = 0
    await nextTick()
    loader.pageNumber.value = 1
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.container.wheel(120)
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
    loader.stop()
  })
  it('continues a downward scroll that reached the bottom during a pending page', async () => {
    const loader = createLoader(undefined, false)
    loader.listElement.value = loader.list
    await nextTick()
    loader.loading.value = true
    await nextTick()
    loader.container.scrollTo(600)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.pageNumber.value = 2
    loader.loading.value = false
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.container.wheel(120)
    loader.container.scrollTo(600)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.container.scrollHeight = 2000
    loader.pageNumber.value = 3
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
  })

  it('admits downward wheel input on a short list without requiring the manual button', async () => {
    const loader = createLoader(undefined, false)
    loader.container.scrollHeight = 200
    loader.listElement.value = loader.list
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.wheel(-120)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.wheel(120)
    loader.container.wheel(120)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
    loader.pageNumber.value = 2
    loader.container.wheel(120)
    expect(loader.loadNext).toHaveBeenCalledOnce()
  })

  it('admits a swipe at the bottom of a short filtered list without repeated requests', async () => {
    const loader = createLoader()
    loader.container.scrollHeight = 200
    loader.visibleCount.value = 0
    loader.listElement.value = loader.list
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.dispatchEvent(
      Object.assign(new Event('touchstart'), { touches: [{ clientY: 100 }] }),
    )
    loader.container.dispatchEvent(
      Object.assign(new Event('touchmove'), { touches: [{ clientY: 70 }] }),
    )
    loader.container.dispatchEvent(
      Object.assign(new Event('touchmove'), { touches: [{ clientY: 40 }] }),
    )
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.pageNumber.value = 2
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
  })

  it('allows keyboard paging from a focused short list', async () => {
    const loader = createLoader(undefined, false)
    loader.container.scrollHeight = 200
    loader.listElement.value = loader.list
    await nextTick()
    const list = loader.list as unknown as ScrollElement
    list.dispatchEvent(Object.assign(new Event('keydown'), { key: 'PageDown' }))
    expect(loader.loadNext).toHaveBeenCalledOnce()
    list.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowDown' }))
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
  })

  it('withdraws pending scroll demand when the user scrolls back up', async () => {
    const loader = createLoader(undefined, false)
    loader.listElement.value = loader.list
    loader.loading.value = true
    await nextTick()
    loader.container.scrollTo(600)
    loader.container.scrollTo(590)
    loader.pageNumber.value = 2
    loader.loading.value = false
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.stop()
  })

  it('does not continuously page filtered results after one explicit scroll', async () => {
    const loader = createLoader(undefined, false)
    loader.visibleCount.value = 1
    loader.listElement.value = loader.list
    await nextTick()
    loader.container.scrollTo(600)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.pageNumber.value = 2
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
  })

  it('keeps retained short results idle on mount and page changes, while admitting a downward scroll', async () => {
    const loader = createLoader(undefined, false)
    loader.container.scrollHeight = 200
    loader.listElement.value = loader.list
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.pageNumber.value = 2
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.scrollHeight = 1000
    loader.container.scrollTo(600)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
  })
  it('retains page admission across remounts and resets on explicit listing restart', async () => {
    const editing = createEditingSession()
    const first = createLoader(editing)
    first.container.scrollHeight = 200
    first.listElement.value = first.list
    await nextTick()
    expect(first.loadNext).toHaveBeenCalledTimes(1)
    first.stop()

    const second = createLoader(editing)
    second.container.scrollHeight = 200
    second.listElement.value = second.list
    await nextTick()
    expect(second.loadNext).not.toHaveBeenCalled()
    first.container.scrollTo(390)
    expect(first.loadNext).toHaveBeenCalledTimes(1)

    second.pageNumber.value = 2
    await nextTick()
    expect(second.loadNext).toHaveBeenCalledTimes(1)
    second.pageNumber.value = 0
    await nextTick()
    expect(second.loadNext).toHaveBeenCalledTimes(1)
    second.pageNumber.value = 1
    await nextTick()
    expect(second.loadNext).toHaveBeenCalledTimes(2)
    second.stop()
    editing.dispose()
  })
  it('loads once per page on a downward scroll near the bottom and stops after disposal', async () => {
    const loader = createLoader()
    loader.listElement.value = loader.list
    await nextTick()

    loader.container.scrollTo(100)
    loader.container.scrollTo(360)
    loader.container.scrollTo(380)
    expect(loader.loadNext).toHaveBeenCalledTimes(1)

    loader.loading.value = true
    loader.pageNumber.value = 2
    loader.loadedCount.value = 40
    loader.visibleCount.value = 40
    await nextTick()
    loader.container.scrollTo(400)
    expect(loader.loadNext).toHaveBeenCalledTimes(1)

    loader.loading.value = false
    await nextTick()
    loader.container.scrollTo(420)
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
    loader.stop()
    loader.container.scrollTo(440)
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
  })

  it('fills an unfiltered short list but does not prefetch sparse filtered results', async () => {
    const loader = createLoader()
    loader.container.scrollHeight = 200
    loader.visibleCount.value = 1
    loader.listElement.value = loader.list
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()

    loader.visibleCount.value = 20
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(1)

    loader.loading.value = true
    loader.pageNumber.value = 2
    loader.visibleCount.value = 40
    loader.loadedCount.value = 40
    await nextTick()
    loader.container.scrollHeight = 500
    loader.loading.value = false
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(1)
    loader.stop()
  })

  it('continues from an empty first page and stops when the viewport fills', async () => {
    const loader = createLoader()
    loader.container.scrollHeight = 200
    loader.visibleCount.value = 0
    loader.loadedCount.value = 0
    loader.listElement.value = loader.list
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(1)
    loader.pageNumber.value = 2
    loader.visibleCount.value = 7
    loader.loadedCount.value = 7
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
    loader.container.scrollHeight = 800
    loader.pageNumber.value = 3
    loader.visibleCount.value = 14
    loader.loadedCount.value = 14
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
    loader.stop()
  })

  it('fills after resizing and releases its observer on disposal', async () => {
    let callback: (() => void) | undefined
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(onResize: () => void) {
          callback = onResize
        }
        observe() {}
        disconnect = disconnect
      },
    )
    const loader = createLoader()
    loader.listElement.value = loader.list
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.scrollHeight = 200
    callback?.()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('does not load when the source is exhausted', async () => {
    const loader = createLoader()
    loader.hasMore.value = false
    loader.listElement.value = loader.list
    await nextTick()
    loader.container.scrollTo(390)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.stop()
  })
})

describe('virtual pagination admission', () => {
  it('uses the full extent rather than mounted DOM height or virtual window length', async () => {
    const loader = createVirtualLoader({ count: 1_000 })
    const getStyle = vi.fn(() => ({ overflowY: 'visible' }))
    const createObserver = vi.fn()
    vi.stubGlobal('getComputedStyle', getStyle)
    vi.stubGlobal('ResizeObserver', createObserver)
    loader.mount()
    await nextTick()
    expect(loader.virtual.count.value).toBe(1_000)
    expect(loader.virtual.virtualItems.value.length).toBeLessThan(30)
    expect(loader.virtual.totalSize.value).toBe(20_000)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.getBoundingClientRect.mockClear()
    loader.list.getBoundingClientRect.mockClear()
    const readHeight = vi.fn(() => 400)
    Object.defineProperty(loader.container, 'clientHeight', { get: readHeight })
    loader.container.wheel(120)
    press(loader.list, 'End')
    swipe(loader.container)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.scrollTo(19_350)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.scrollTo(19_360)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    // An empty committed page still has all 1,000 loaded items, even with only a window mounted.
    loader.loading.value = true
    await nextTick()
    loader.pageNumber.value = 2
    loader.loading.value = false
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
    expect(readHeight).not.toHaveBeenCalled()
    expect(loader.container.getBoundingClientRect).not.toHaveBeenCalled()
    expect(loader.list.getBoundingClientRect).not.toHaveBeenCalled()
    expect(getStyle).not.toHaveBeenCalled()
    expect(createObserver).not.toHaveBeenCalled()
    expect(loader.observers).toHaveLength(1)
    expect(loader.observers[0]!.observe).toHaveBeenCalledTimes(2)
    loader.stop()
    expect(loader.observers[0]!.disconnect).toHaveBeenCalledOnce()
  })

  it('includes preceding headers in both short-list filling and the bottom threshold', async () => {
    const loader = createVirtualLoader({ count: 20, listOffset: 300 })
    loader.mount()
    await nextTick()
    expect(loader.virtual.totalSize.value).toBe(400)
    expect(loader.virtual.context.metrics.value.listOffset).toBe(300)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.wheel(120)
    loader.scrollTo(59)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.scrollTo(60)
    expect(loader.loadNext).toHaveBeenCalledOnce()
  })

  it.each(['wheel', 'touch', 'ArrowDown', 'PageDown', 'End'])(
    'admits one page for repeated %s demand at the virtual end',
    async (input) => {
      const loader = createVirtualLoader({ fillShortList: false })
      loader.container.scrollTop = 1_600
      loader.list.rect.top -= 1_600
      loader.mount()
      await nextTick()
      function demand() {
        if (input === 'wheel') loader.container.wheel(120)
        else if (input === 'touch') swipe(loader.container)
        else press(loader.list, input)
      }
      demand()
      demand()
      expect(loader.loadNext).toHaveBeenCalledOnce()
      loader.loading.value = true
      await nextTick()
      loader.items.value = Array.from({ length: 200 }, (_, index) => index)
      loader.loadedCount.value = 200
      loader.pageNumber.value = 2
      loader.loading.value = false
      await nextTick()
      demand()
      expect(loader.loadNext).toHaveBeenCalledOnce()
    },
  )

  it('fills empty and short complete pages only until the virtual extent becomes scrollable', async () => {
    const loader = createVirtualLoader({ count: 0 })
    // A stale spacer/other mounted DOM must not hide the empty virtual collection.
    loader.container.scrollHeight = 20_000
    loader.mount()
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.items.value = [0, 1, 2]
    loader.loadedCount.value = 3
    loader.pageNumber.value = 2
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
    loader.items.value = Array.from({ length: 21 }, (_, index) => index)
    loader.loadedCount.value = 21
    loader.pageNumber.value = 3
    await nextTick()
    expect(loader.virtual.totalSize.value).toBe(420)
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
  })

  it('does not automatically fill or continue empty filtered pages', async () => {
    const state = createPageState(100)
    const loader = createVirtualLoader({ count: 1, state })
    loader.mount()
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.wheel(120)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.loading.value = true
    await nextTick()
    loader.items.value = []
    loader.loadedCount.value = 200
    loader.pageNumber.value = 2
    loader.loading.value = false
    await nextTick()
    loader.observers[0]!.notify([loader.container.asElement(), loader.list.asElement()])
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    swipe(loader.container)
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
    loader.hasMore.value = false
    loader.pageNumber.value = 3
    await nextTick()
    loader.container.wheel(120)
    press(loader.list, 'End')
    swipe(loader.container)
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
  })

  it('retries a failed page only after fresh explicit demand, never after resize or remount', async () => {
    const editing = createEditingSession()
    const first = createVirtualLoader({ count: 10, editing })
    first.mount()
    await nextTick()
    expect(first.loadNext).toHaveBeenCalledOnce()
    first.loading.value = true
    await nextTick()
    first.stop()
    const second = createVirtualLoader({ count: 10, editing, state: first.state })
    second.mount()
    await nextTick()
    second.container.wheel(120)
    expect(second.loadNext).not.toHaveBeenCalled()
    second.loading.value = false
    await nextTick()
    second.container.clientHeight = 500
    second.observers[0]!.notify([second.container.asElement(), second.list.asElement()])
    await nextTick()
    expect(second.loadNext).not.toHaveBeenCalled()
    second.stop()
    const third = createVirtualLoader({ count: 10, editing, state: first.state })
    third.mount()
    await nextTick()
    expect(third.loadNext).not.toHaveBeenCalled()
    third.container.wheel(120)
    third.container.wheel(120)
    expect(third.loadNext).toHaveBeenCalledOnce()
    third.stop()
    editing.dispose()
  })

  it('continues demand received during a retained request once, using the complete counts', async () => {
    const editing = createEditingSession()
    const first = createVirtualLoader({ editing, fillShortList: false })
    first.mount()
    await nextTick()
    first.scrollTo(1_600)
    first.loading.value = true
    await nextTick()
    first.stop()
    const second = createVirtualLoader({ editing, fillShortList: false, state: first.state })
    second.container.scrollTop = 1_600
    second.list.rect.top -= 1_600
    second.mount()
    await nextTick()
    expect(second.loadNext).not.toHaveBeenCalled()
    second.container.wheel(120)
    swipe(second.container)
    press(second.list, 'End')
    expect(second.loadNext).not.toHaveBeenCalled()
    second.pageNumber.value = 2
    second.loading.value = false
    await nextTick()
    expect(second.loadNext).toHaveBeenCalledOnce()
    second.observers[0]!.notify([second.container.asElement(), second.list.asElement()])
    await nextTick()
    expect(second.loadNext).toHaveBeenCalledOnce()
    second.stop()
    editing.dispose()
  })

  it('does not duplicate admission on measurement, window changes, mount changes or root replacement', async () => {
    const loader = createVirtualLoader({ count: 10 })
    loader.mount()
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.itemSize.value = 10
    loader.observers[0]!.notify([loader.container.asElement(), loader.list.asElement()])
    await nextTick()
    loader.listElement.value = null
    await nextTick()
    const replacement = new VirtualPageElement(loader.document)
    replacement.scrollTop = 0
    replacement.clientHeight = 400
    loader.scrollElement.value = replacement.asElement()
    loader.mount()
    await nextTick()
    loader.container.wheel(120)
    replacement.wheel(120)
    press(loader.list, 'PageDown')
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.pageNumber.value = 0
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.pageNumber.value = 1
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledTimes(2)
  })

  it('waits for an available, enabled, nonzero context and fills after it becomes ready', async () => {
    const loader = createVirtualLoader({ count: 10 })
    loader.scrollElement.value = null
    loader.mount()
    await nextTick()
    press(loader.list, 'End')
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.scrollElement.value = loader.container.asElement()
    loader.container.clientHeight = 0
    await nextTick()
    loader.container.wheel(120)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.enabled.value = false
    loader.container.clientHeight = 400
    await nextTick()
    loader.container.wheel(120)
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.enabled.value = true
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.enabled.value = false
    await nextTick()
    loader.enabled.value = true
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
  })

  it('fills after the total size shrinks without adding row observations or repeating admission', async () => {
    const loader = createVirtualLoader()
    loader.mount()
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.itemSize.value = 2
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.container.clientHeight = 500
    loader.list.rect.top += 20
    loader.observers[0]!.notify([loader.container.asElement(), loader.list.asElement()])
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    expect(loader.observers[0]!.observe).toHaveBeenCalledTimes(2)
  })

  it('keeps retained short results idle through page, extent and viewport changes', async () => {
    const loader = createVirtualLoader({ count: 10, fillShortList: false })
    loader.mount()
    await nextTick()
    loader.pageNumber.value = 2
    loader.itemSize.value = 10
    loader.container.clientHeight = 500
    loader.observers[0]!.notify([loader.container.asElement(), loader.list.asElement()])
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.container.wheel(120)
    expect(loader.loadNext).toHaveBeenCalledOnce()
  })

  it('withdraws pending demand on reverse wheel and touch input', async () => {
    const loader = createVirtualLoader({ fillShortList: false })
    loader.mount()
    loader.loading.value = true
    await nextTick()
    loader.scrollTo(1_600)
    loader.container.wheel(-120)
    loader.pageNumber.value = 2
    loader.loading.value = false
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.loading.value = true
    await nextTick()
    swipe(loader.container)
    swipe(loader.container, 60, 100)
    loader.pageNumber.value = 3
    loader.loading.value = false
    await nextTick()
    expect(loader.loadNext).not.toHaveBeenCalled()
  })

  it('releases listeners and ignores late resize batches after disposal', async () => {
    const loader = createVirtualLoader({ count: 10, fillShortList: false })
    loader.mount()
    await nextTick()
    loader.container.wheel(120)
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.stop()
    loader.pageNumber.value = 2
    loader.container.wheel(120)
    press(loader.list, 'End')
    swipe(loader.container)
    loader.observers[0]!.notify([loader.container.asElement(), loader.list.asElement()])
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    expect(loader.observers[0]!.unobserve).toHaveBeenCalledTimes(2)
    expect(loader.observers[0]!.disconnect).toHaveBeenCalledOnce()
  })
})

describe('explicit nonvirtual roots', () => {
  it('waits for an injected root and tracks its replacement without rediscovering an ancestor', async () => {
    const getStyle = vi.fn()
    vi.stubGlobal('getComputedStyle', getStyle)
    const first = new ScrollElement()
    first.scrollHeight = 200
    const second = new ScrollElement()
    second.scrollHeight = 200
    const scrollElement = shallowRef<HTMLElement | null>(null)
    const listElement = shallowRef(first as unknown as HTMLElement)
    const loadNext = vi.fn()
    const scope = effectScope()
    scopes.push(scope)
    scope.run(() =>
      useScrollPageLoader({
        listElement,
        scrollElement,
        ...createPageState(),
        visibleCount: 100,
        loadNext,
        fillShortList: false,
      }),
    )
    first.wheel(120)
    expect(loadNext).not.toHaveBeenCalled()
    scrollElement.value = first as unknown as HTMLElement
    await nextTick()
    scrollElement.value = second as unknown as HTMLElement
    // Even before the post-flush listener handoff, the stale root cannot admit a page.
    first.wheel(120)
    expect(loadNext).not.toHaveBeenCalled()
    await nextTick()
    first.wheel(120)
    expect(loadNext).not.toHaveBeenCalled()
    second.wheel(120)
    expect(loadNext).toHaveBeenCalledOnce()
    expect(getStyle).not.toHaveBeenCalled()
  })

  it('ignores a legacy observer callback after its attachment was replaced or disposed', async () => {
    const callbacks: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    const loader = createLoader()
    loader.listElement.value = loader.list
    await nextTick()
    loader.listElement.value = null
    await nextTick()
    loader.container.scrollHeight = 200
    callbacks[0]?.()
    expect(loader.loadNext).not.toHaveBeenCalled()
    loader.listElement.value = loader.list
    await nextTick()
    expect(loader.loadNext).toHaveBeenCalledOnce()
    loader.pageNumber.value = 2
    loader.stop()
    callbacks[0]?.()
    callbacks[1]?.()
    expect(loader.loadNext).toHaveBeenCalledOnce()
  })
})

describe('page retry', () => {
  it.each(['nonvirtual', 'virtual'])(
    'observes a same-tick failure in a %s list without automatically retrying it',
    async (mode) => {
      const loader = mode === 'virtual' ? createVirtualLoader({ count: 10 }) : createLoader()
      loader.container.scrollHeight = 200
      loader.loadNext.mockImplementation(() => {
        loader.loading.value = true
        loader.loading.value = false
      })
      loader.listElement.value =
        loader.list instanceof VirtualPageElement ? loader.list.asElement() : loader.list
      await nextTick()
      expect(loader.loadNext).toHaveBeenCalledOnce()
      loader.container.wheel(120)
      expect(loader.loadNext).toHaveBeenCalledTimes(2)
      await nextTick()
      expect(loader.loadNext).toHaveBeenCalledTimes(2)
      loader.hasMore.value = false
      await nextTick()
      loader.container.wheel(120)
      expect(loader.loadNext).toHaveBeenCalledTimes(2)
      loader.hasMore.value = true
      await nextTick()
      expect(loader.loadNext).toHaveBeenCalledTimes(2)
      loader.container.wheel(120)
      expect(loader.loadNext).toHaveBeenCalledTimes(3)
    },
  )
})
