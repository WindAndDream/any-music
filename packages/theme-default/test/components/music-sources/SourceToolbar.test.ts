import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import SourceToolbar from '../../../src/components/music-sources/SourceToolbar.vue'
import {
  CatalogTestElement,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const views: ReturnType<typeof mountCatalogComponent>[] = []
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('HTMLElement', CatalogTestElement)
  vi.stubGlobal('Element', CatalogTestElement)
})
afterEach(() => {
  views.splice(0).forEach((view) => view.unmount())
  vi.unstubAllGlobals()
})

function setup() {
  const view = mountCatalogComponent(SourceToolbar, {
    pluginId: 'test',
    supportsSearch: true,
    supportsImport: true,
    importUrlScopes: [],
    searchQuery: '',
    importUrl: '',
  })
  views.push(view)
  const viewport = findCatalogElement(view.root, (node) =>
    String(node.props.class).includes('source-toolbar__viewport'),
  )
  let captured: number | undefined
  const releasePointerCapture = vi.fn(() => {
    captured = undefined
  })
  Object.assign(viewport, {
    getBoundingClientRect: () => ({ width: 400 }),
    setPointerCapture: (id: number) => {
      captured = id
    },
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture,
  })
  const pointer = (x: number, pointerId = 1) =>
    ({
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      currentTarget: viewport,
      target: viewport,
    }) as unknown as PointerEvent
  const send = (name: string, x = 200, pointerId = 1) =>
    (viewport.props[name] as (event: PointerEvent) => void)(pointer(x, pointerId))
  const isDragging = () => String(viewport.props.class).includes('--dragging')
  const isSearchActive = () =>
    findCatalogElement(view.root, (node) => node.props.id === 'am-source-search-tab').props[
      'aria-selected'
    ]
  return { view, send, isDragging, isSearchActive, releasePointerCapture }
}

describe('SourceToolbar swipe lifecycle', () => {
  it.each(['blur', 'pointermove', 'pointercancel', 'lostpointercapture', 'Escape'])(
    'restores the cursor on %s without switching mode and permits the next swipe',
    async (type) => {
      const test = setup()
      test.send('onPointerdown')
      test.send('onPointermove', 80)
      await nextTick()
      expect(test.isDragging()).toBe(true)
      if (type === 'lostpointercapture') test.send('onLostpointercapture')
      else
        window.dispatchEvent(
          Object.assign(new Event(type === 'Escape' ? 'keydown' : type), {
            pointerId: 1,
            pointerType: 'mouse',
            buttons: 0,
            key: 'Escape',
          }),
        )
      await nextTick()
      expect(test.isDragging()).toBe(false)
      expect(test.isSearchActive()).toBe(true)
      test.send('onPointerup', 80)
      expect(test.releasePointerCapture).toHaveBeenCalledOnce()
      test.send('onPointerdown')
      test.send('onPointerup', 80)
      await nextTick()
      expect(test.isDragging()).toBe(false)
      expect(test.isSearchActive()).toBe(false)
    },
  )

  it('ignores another pointer and releases capture on disposal', async () => {
    const test = setup()
    test.send('onPointerdown')
    test.send('onPointermove', 80, 2)
    test.send('onPointerup', 80, 2)
    await nextTick()
    expect(test.isDragging()).toBe(true)
    expect(test.isSearchActive()).toBe(true)
    test.view.unmount()
    expect(test.releasePointerCapture).toHaveBeenCalledOnce()
    views.splice(views.indexOf(test.view), 1)
  })
})
