import { expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef, withDirectives } from 'vue'
import type { Directive } from 'vue'

import SlidingSegments from '../../src/components/SlidingSegments.vue'
import {
  CatalogTestElement,
  findCatalogElement,
  mountCatalogComponent,
} from './music-sources/catalog-test-renderer'

it('moves between unequal buttons, realigns after wrapping and disconnects when removed', async () => {
  const selected = shallowRef(0)
  const first = { offsetLeft: 4, offsetTop: 4, offsetWidth: 100, offsetHeight: 44 }
  const second = { offsetLeft: 108, offsetTop: 4, offsetWidth: 78, offsetHeight: 44 }
  const disconnect = vi.fn()
  let resize!: () => void
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = disconnect
      constructor(update: () => void) {
        resize = update
      }
    },
  )
  const host: Directive<CatalogTestElement> = {
    created(element) {
      Object.assign(element, { ownerDocument: {} })
    },
  }
  const geometry: Directive<CatalogTestElement, typeof first> = {
    created(element, { value }) {
      Object.defineProperties(element, {
        tagName: { value: 'BUTTON' },
        offsetLeft: { get: () => value.offsetLeft },
        offsetTop: { get: () => value.offsetTop },
        offsetWidth: { get: () => value.offsetWidth },
        offsetHeight: { get: () => value.offsetHeight },
      })
    },
  }

  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () =>
        withDirectives(
          h(
            SlidingSegments,
            { role: 'group', 'aria-label': '视图切换' },
            {
              default: () => [
                withDirectives(h('button', { 'aria-pressed': selected.value === 0 }, '全部'), [
                  [geometry, first],
                ]),
                withDirectives(h('button', { 'aria-pressed': selected.value === 1 }, '按平台'), [
                  [geometry, second],
                ]),
              ],
            },
          ),
          [[host]],
        ),
    }),
    {},
  )

  try {
    const group = findCatalogElement(view.root, (node) => node.props.role === 'group')
    const slider = findCatalogElement(group, (node) => node.props['aria-hidden'] === 'true')
    expect(group.getAttribute('data-slider-positioned')).toBe('')
    expect(slider.style).toMatchObject({ transform: 'translate(4px, 4px)', width: '100px' })
    expect(slider.getAttribute('data-slider-moving')).toBe('false')

    selected.value = 1
    await nextTick()
    expect(slider.style).toMatchObject({ transform: 'translate(108px, 4px)', width: '78px' })
    expect(slider.getAttribute('data-slider-moving')).toBe('true')

    selected.value = 0
    await nextTick()
    expect(slider.style.transform).toBe('translate(4px, 4px)')
    expect(slider.getAttribute('data-slider-moving')).toBe('true')

    selected.value = 1
    await nextTick()
    Object.assign(second, { offsetLeft: 4, offsetTop: 52, offsetWidth: 84 })
    resize()
    expect(slider.style).toMatchObject({ transform: 'translate(4px, 52px)', width: '84px' })
    expect(slider.getAttribute('data-slider-moving')).toBe('false')

    selected.value = -1
    await nextTick()
    expect(group.getAttribute('data-slider-positioned')).toBeNull()
  } finally {
    view.unmount()
    vi.unstubAllGlobals()
  }
  expect(disconnect).toHaveBeenCalledOnce()
})
