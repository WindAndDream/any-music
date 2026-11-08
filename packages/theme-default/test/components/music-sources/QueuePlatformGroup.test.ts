import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import QueuePlatformGroup from '../../../src/components/music-sources/QueuePlatformGroup.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

afterEach(() => vi.unstubAllGlobals())

describe('QueuePlatformGroup summary', () => {
  it('keeps selection, opening and holding distinct and exposes partial selection', async () => {
    const select = vi.fn()
    const open = vi.fn()
    const dragStart = vi.fn()
    const shift = vi.fn()
    const props = reactive({
      platformId: 'a',
      name: '平台 A',
      count: 2,
      totalCount: 3,
      filtered: true,
      isCustom: false,
      dragging: false,
      selected: false,
      selectable: true,
      indeterminate: true,
      onSelect: select,
      onOpen: open,
      onDragStart: dragStart,
      onShift: shift,
    })
    const view = mountCatalogComponent(QueuePlatformGroup, props)
    const checkbox = findCatalogElement(view.root, (node) => node.tag === 'input')
    expect(checkbox.props.checked).toBe(false)
    expect(checkbox.props.indeterminate).toBe(true)
    expect(checkbox.props['aria-checked']).toBe('mixed')
    dispatchCatalogEvent(checkbox, 'onChange')
    expect(select).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    expect(dragStart).not.toHaveBeenCalled()
    props.indeterminate = false
    props.selected = true
    await nextTick()
    expect(checkbox.props.checked).toBe(true)
    expect(checkbox.props.indeterminate).toBe(false)
    expect(checkbox.props['aria-checked']).toBe(true)
    const card = findCatalogElement(view.root, (node) => node.tag === 'section')
    expect(card.props.class).toContain('queue-platform-group--selected')
    const event = { button: 0, stopPropagation() {} }
    ;(card.props.onPointerdown as (event: unknown) => void)(event)
    expect(dragStart).toHaveBeenCalledExactlyOnceWith(event, 'a')
    const handlers = card.props.onKeydown as ((event: unknown) => void)[]
    handlers.forEach((handler) =>
      handler({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} }),
    )
    expect(shift).toHaveBeenCalledExactlyOnceWith('a', 1)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'a'),
      'onClick',
    )
    expect(open).toHaveBeenCalledOnce()
    expect(select).toHaveBeenCalledOnce()
    view.unmount()
  })
  it.each([false, true])(
    'drops the type only when the complete count exceeds its width (custom: %s)',
    async (isCustom) => {
      const observers: { notify: () => void; disconnect: ReturnType<typeof vi.fn> }[] = []
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe = vi.fn()
          disconnect = vi.fn()
          constructor(notify: () => void) {
            observers.push({ notify, disconnect: this.disconnect })
          }
        },
      )
      const props = reactive({
        platformId: 'a',
        name: '平台 A',
        count: 12,
        totalCount: 200,
        filtered: true,
        isCustom,
        dragging: false,
        playbackStatus: 'playing' as const,
      })
      const view = mountCatalogComponent(QueuePlatformGroup, props)
      await nextTick()
      const count = findCatalogElement(
        view.root,
        (node) => node.props.class === 'queue-platform-group__count',
      )
      const measurements = count.children.filter((node) => node.props['aria-hidden'] === 'true')
      Object.assign(measurements[0]!, { scrollWidth: 180 })
      Object.assign(measurements[1]!, { scrollWidth: 120 })
      const resize = async (width: number) => {
        Object.assign(count, { clientWidth: width })
        observers.at(-1)!.notify()
        await nextTick()
      }
      const prefix = () =>
        findCatalogElement(
          count,
          (node) => node.props.class === 'queue-platform-group__inline-type',
        )
      await resize(180)
      expect(prefix().textContent).toContain(isCustom ? '本地拼接' : '音乐源')
      await resize(150)
      expect(prefix).toThrow()
      await resize(60)
      expect(prefix).toThrow()
      expect(count.textContent).toContain('匹配 12 / 200 首')
      expect(view.root.textContent).toContain('正在播放')
      // 保留隐藏测量的自然宽度，让加宽和队列数量变化都能恢复完整类型。
      await resize(200)
      expect(prefix().textContent).toContain(isCustom ? '本地拼接' : '音乐源')
      props.totalCount = 300
      Object.assign(measurements[0]!, { scrollWidth: 220 })
      await nextTick()
      expect(prefix).toThrow()
      expect(count.props.title).toContain('匹配 12 / 300 首')
      view.unmount()
      expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true)
    },
  )
})
