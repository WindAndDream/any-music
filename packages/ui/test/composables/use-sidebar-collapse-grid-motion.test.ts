import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, provide, shallowRef } from 'vue'

import {
  collapsingSidebarSideKey,
  useSidebarCollapseGridMotion,
} from '../../src/composables/use-sidebar-collapse-grid-motion'
import { mountCatalogComponent } from '../components/music-sources/catalog-test-renderer'
import { createResizeEnvironment } from '../fixtures/virtual-scroll/resize-observer'

function box(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function mountGrid(measured = false, addedInset = 0) {
  const env = createResizeEnvironment()
  const side = shallowRef<'left' | 'right'>()
  let isWide = false
  const style = {
    direction: 'ltr',
    gridTemplateColumns: '100px 100px',
    rowGap: '0px',
    columnGap: '10px',
    getPropertyValue: (name: string) => (name === '--am-motion-normal' ? '220ms' : 'ease-in-out'),
  }
  const getComputedStyle = vi.fn(() => style)
  Object.assign(env.view, { getComputedStyle })
  const gridBox = () => (isWide ? box(20, 0, 270, 4000) : box(40, 0, 210, 4000))
  const grid = {
    ownerDocument: env.document,
    isConnected: true,
    hasAttribute: () => false,
    getBoundingClientRect: vi.fn(gridBox),
  } as unknown as HTMLElement
  const records = Array.from({ length: 100 }, (_, index) => {
    const animation = Object.assign(new EventTarget(), { cancel: vi.fn() })
    const markers = new Map<string, string>()
    return {
      animation,
      markers,
      parentElement: grid,
      getBoundingClientRect: vi.fn(() => {
        const width = isWide ? 130 : 100
        return box(
          gridBox().left + (index % 2) * (width + 10),
          Math.floor(index / 2) * 80,
          width,
          80,
        )
      }),
      getAttribute: (name: string) => markers.get(name) ?? null,
      hasAttribute: (name: string) => markers.has(name),
      setAttribute: (name: string, value: string) => markers.set(name, value),
      removeAttribute: (name: string) => markers.delete(name),
      animate: vi.fn(() => animation),
    }
  })
  Object.assign(grid, { children: records })
  const viewport = {
    getBoundingClientRect: () =>
      box(gridBox().left - (isWide ? addedInset : 0), 80, gridBox().width, 80),
  } as HTMLElement
  const feature = defineComponent({
    setup() {
      useSidebarCollapseGridMotion({
        element: grid,
        scrollElement: viewport,
        getLayout: measured ? () => ({ width: 210, columns: 2, columnGap: 10 }) : undefined,
      })
      return () => h('div')
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provide(collapsingSidebarSideKey, side)
        return () => h(feature)
      },
    }),
    {},
  )
  return {
    side,
    records,
    getComputedStyle,
    dispose: view.unmount,
    widen(columns: number) {
      isWide = true
      style.gridTemplateColumns = Array.from({ length: columns }, () => '130px').join(' ')
      env.observers[0]!.notify([grid])
    },
  }
}

describe('sidebar collapse card motion', () => {
  it.each([
    ['left', 3, '-30px', 'inset(0 30px 0 0)'],
    ['right', 2, '30px', 'inset(0 0 0 30px)'],
  ] as const)('moves and reveals only visible cards for a %s rail', (side, index, x, clipPath) => {
    const grid = mountGrid()
    try {
      grid.side.value = side
      grid.widen(2)
      expect(grid.records.filter(({ animate }) => animate.mock.calls.length)).toEqual(
        grid.records.slice(2, 4),
      )
      expect(grid.records[index]!.animate).toHaveBeenCalledWith(
        [
          { translate: x, clipPath },
          { translate: '0px', clipPath: 'inset(0)' },
        ],
        { duration: 220, easing: 'ease-in-out' },
      )
      expect(grid.records[index]!.markers.has('data-am-grid-moving')).toBe(true)
      grid.side.value = undefined
      expect(grid.records[index]!.animation.cancel).toHaveBeenCalledOnce()
      expect(grid.records[index]!.markers.has('data-am-grid-moving')).toBe(false)
    } finally {
      grid.dispose()
    }
  })

  it('leaves column changes to the existing keyed motion', () => {
    const grid = mountGrid(true)
    try {
      grid.side.value = 'left'
      expect(grid.getComputedStyle).not.toHaveBeenCalled()
      grid.widen(3)
      expect(
        grid.records.every(({ getBoundingClientRect }) => !getBoundingClientRect.mock.calls.length),
      ).toBe(true)
      expect(grid.records.every(({ animate }) => !animate.mock.calls.length)).toBe(true)
    } finally {
      grid.dispose()
    }
  })

  it('includes a responsive inset change on the full card grid', () => {
    const grid = mountGrid(false, 3)
    try {
      grid.side.value = 'left'
      grid.widen(2)
      expect(grid.records[2]!.animate).toHaveBeenCalledWith(
        [
          { translate: '-3px', clipPath: 'inset(0 30px 0 0)' },
          { translate: '0px', clipPath: 'inset(0)' },
        ],
        { duration: 220, easing: 'ease-in-out' },
      )
    } finally {
      grid.dispose()
    }
  })
})
