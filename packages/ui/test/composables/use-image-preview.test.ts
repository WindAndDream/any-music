import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef } from 'vue'

import { useImagePreview } from '../../src/composables/use-image-preview'

afterEach(() => vi.unstubAllGlobals())

describe('centered image preview', () => {
  it('keeps the image center fixed while zooming, shrinking and resizing, with reachable edges', async () => {
    const scope = effectScope()
    const props = reactive({ open: true, src: 'cover', title: '封面' })
    const viewport = shallowRef<HTMLElement | null>(null)
    let resize!: () => void
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    const preview = scope.run(() => useImagePreview(props, viewport))!
    const element = {
      clientWidth: 600,
      clientHeight: 400,
      scrollLeft: 0,
      scrollTop: 0,
      get scrollWidth() {
        return parseFloat(preview.canvasStyle.value.inlineSize)
      },
      get scrollHeight() {
        return parseFloat(preview.canvasStyle.value.blockSize)
      },
    }
    try {
      viewport.value = element as HTMLElement
      preview.handleLoad({ target: { naturalWidth: 1200, naturalHeight: 800 } } as unknown as Event)
      await nextTick()
      await nextTick()
      async function expectCenteredAt(zoom: number) {
        preview.setZoom(zoom)
        await nextTick()
        await nextTick()
        expect(element.scrollWidth / 2 - element.scrollLeft).toBe(300)
        expect(element.scrollHeight / 2 - element.scrollTop).toBe(200)
        expect(element.scrollLeft).toBeGreaterThanOrEqual(0)
        expect(element.scrollTop).toBeGreaterThanOrEqual(0)
      }
      await expectCenteredAt(2)
      await expectCenteredAt(4)
      await expectCenteredAt(1.5)
      await expectCenteredAt(1)
      preview.setZoom(2)
      element.clientWidth = 300
      resize()
      await nextTick()
      await nextTick()
      expect(element.scrollWidth / 2 - element.scrollLeft).toBe(150)
      expect(preview.imageStyle.value.inlineSize).toBe('240px')
    } finally {
      scope.stop()
    }
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('retains the current artwork and zoom during close, and resets on reopening', async () => {
    const scope = effectScope()
    const props = reactive({ open: true, src: 'cover', title: '封面' })
    const preview = scope.run(() => useImagePreview(props, shallowRef(null)))!
    try {
      preview.setZoom(2)
      props.open = false
      props.src = ''
      props.title = ''
      await nextTick()
      expect(preview.content.value).toEqual({ src: 'cover', title: '封面' })
      expect(preview.zoom.value).toBe(2)
      props.open = true
      props.src = 'another'
      await nextTick()
      expect(preview.zoom.value).toBe(1)
      expect(preview.content.value.src).toBe('another')
    } finally {
      scope.stop()
    }
  })
})

describe('full-surface artwork zoom', () => {
  it('grows the artwork beyond its initial fitted area and keeps enlarged edges scrollable', async () => {
    const scope = effectScope()
    const viewport = shallowRef<HTMLElement | null>(null)
    const props = reactive({ open: true, src: 'cover', title: '封面' })
    const preview = scope.run(() => useImagePreview(props, viewport))!
    const surface = {
      clientWidth: 1200,
      clientHeight: 900,
      scrollWidth: 1350,
      scrollHeight: 1350,
      scrollLeft: 0,
      scrollTop: 0,
    }
    try {
      viewport.value = surface as HTMLElement
      await nextTick()
      preview.handleLoad({
        target: { naturalWidth: 2000, naturalHeight: 2000 },
      } as unknown as Event)
      await nextTick()
      expect(preview.imageStyle.value.inlineSize).toBe('675px')
      preview.setZoom(2)
      await nextTick()
      await nextTick()
      expect(preview.canvasStyle.value).toEqual({ inlineSize: '1350px', blockSize: '1350px' })
      expect(preview.imageStyle.value.transform).toContain('scale(2)')
      expect(surface.scrollLeft).toBe(75)
      expect(surface.scrollTop).toBe(225)
      props.open = false
      await nextTick()
      expect(preview.zoom.value).toBe(2)
      props.open = true
      await nextTick()
      expect(preview.zoom.value).toBe(1)
    } finally {
      scope.stop()
    }
  })
})
