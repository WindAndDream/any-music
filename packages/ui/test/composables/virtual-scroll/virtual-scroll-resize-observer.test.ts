import { describe, expect, it, vi } from 'vitest'

import { observeVirtualElement } from '../../../src/composables/virtual-scroll/virtual-scroll-resize-observer'
import {
  createResizeEnvironment,
  VirtualElement,
} from '../../fixtures/virtual-scroll/resize-observer'

describe('virtual resize observer ownership', () => {
  it('pools targets and batches a shared callback once while retaining independent subscriptions', () => {
    const env = createResizeEnvironment()
    const root = new VirtualElement(env.document).asElement(),
      list = new VirtualElement(env.document).asElement()
    const callback = vi.fn(),
      other = vi.fn()
    const stopRoot = observeVirtualElement(root, callback)!
    const stopList = observeVirtualElement(list, callback)!
    const stopOther = observeVirtualElement(root, other)!
    const stopDuplicate = observeVirtualElement(root, callback)!
    expect(env.observers).toHaveLength(1)
    const observer = env.observers[0]!
    expect(observer.observe).toHaveBeenCalledTimes(2)
    observer.notify([root, list])
    expect(callback).toHaveBeenCalledExactlyOnceWith([{ target: root }, { target: list }])
    stopRoot()
    stopDuplicate()
    expect(observer.unobserve).not.toHaveBeenCalled()
    stopList()
    expect(observer.unobserve).toHaveBeenCalledExactlyOnceWith(list)
    stopOther()
    expect(observer.disconnect).toHaveBeenCalledOnce()
    callback.mockClear()
    other.mockClear()
    observer.notify([root, list])
    expect(callback).not.toHaveBeenCalled()
    expect(other).not.toHaveBeenCalled()
    stopOther()
    expect(observer.disconnect).toHaveBeenCalledOnce()
  })

  it('isolates document realms and creates a fresh pool after the last target is released', () => {
    const first = createResizeEnvironment(),
      second = createResizeEnvironment()
    const root = new VirtualElement(first.document).asElement()
    const stop = observeVirtualElement(root, vi.fn())!
    const stopOther = observeVirtualElement(
      new VirtualElement(second.document).asElement(),
      vi.fn(),
    )!
    expect(first.observers).toHaveLength(1)
    expect(second.observers).toHaveLength(1)
    stop()
    const stopAgain = observeVirtualElement(root, vi.fn())!
    expect(first.observers).toHaveLength(2)
    stopAgain()
    stopOther()
  })
})
