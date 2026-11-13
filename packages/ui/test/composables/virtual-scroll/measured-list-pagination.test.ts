import { expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useScrollPageLoader } from '../../../src/composables/music-sources/use-scroll-page-loader'
import { useMeasuredVirtualList } from '../../../src/virtual-scroll'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

it('admits pages from measured full extent and explicit demand, independent of the mounted window', async () => {
  const env = createResizeEnvironment(),
    scope = effectScope()
  const root = new VirtualElement(env.document),
    list = new VirtualElement(env.document),
    unit = new VirtualElement(env.document)
  root.clientHeight = 100
  root.scrollTop = 1_740
  list.rect.top = 12 + 60 - root.scrollTop
  unit.rect.height = 220
  const loadNext = vi.fn(),
    loading = ref(false)
  try {
    const result = scope.run(() => {
      const virtual = useMeasuredVirtualList({
        items: Array.from({ length: 100 }, (_, key) => key),
        getItemKey: (key) => key,
        getContentGeneration: () => 0,
        estimatedItemSize: 20,
        scrollElement: root.asElement(),
        listElement: list.asElement(),
      })
      useScrollPageLoader({
        listElement: list.asElement(),
        virtualList: virtual,
        hasMore: true,
        loading,
        pageNumber: 1,
        visibleCount: virtual.count,
        loadedCount: 100,
        fillShortList: false,
        loadNext,
      })
      return virtual
    })!
    result.measurements.observeItem(87, unit.asElement())
    await settle()
    expect(result.count.value).toBe(100)
    expect(result.virtualItems.value.length).toBeLessThan(100)
    expect(result.totalSize.value).toBe(2_200)
    const wheel = () => root.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100 }))
    wheel()
    expect(loadNext).not.toHaveBeenCalled()
    unit.rect.height = 10
    env.observers[0]!.notify([unit.asElement()])
    await settle()
    expect(result.totalSize.value).toBe(1_990)
    expect(loadNext).not.toHaveBeenCalled()
    wheel()
    expect(loadNext).toHaveBeenCalledTimes(1)
    loading.value = true
    unit.rect.height = 40
    env.observers[0]!.notify([unit.asElement()])
    await settle()
    expect(loadNext).toHaveBeenCalledTimes(1)
    unit.rect.height = 10
    env.observers[0]!.notify([unit.asElement()])
    await settle()
    expect(loadNext).toHaveBeenCalledTimes(1)
    loading.value = false
    result.measurements.refresh()
    await settle()
    expect(loadNext).toHaveBeenCalledTimes(1)
    wheel()
    expect(loadNext).toHaveBeenCalledTimes(2)
    wheel()
    expect(loadNext).toHaveBeenCalledTimes(2)
    // Pagination consumes the existing context; it adds no viewport or item observations.
    expect(env.observers).toHaveLength(1)
    expect(env.observers[0]!.observe).toHaveBeenCalledTimes(3)
  } finally {
    scope.stop()
  }
  root.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: 100 }))
  expect(loadNext).toHaveBeenCalledTimes(2)
})
