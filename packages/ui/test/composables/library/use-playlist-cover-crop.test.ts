import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import { usePlaylistCoverCrop } from '../../../src/composables/library/use-playlist-cover-crop'

describe('playlist cover crop interaction', () => {
  it('maps preview dragging to source pixels, keeps zoom centered and releases capture', async () => {
    const scope = effectScope()
    const source = shallowRef<ImageBitmap | null>(null)
    const drawImage = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }) }
    const captured = new Set<number>()
    const frame = {
      focus: vi.fn(),
      setPointerCapture: (id: number) => captured.add(id),
      hasPointerCapture: (id: number) => captured.has(id),
      releasePointerCapture: (id: number) => captured.delete(id),
      getBoundingClientRect: () => ({ width: 320, height: 200 }),
    }
    const cropper = scope.run(() =>
      usePlaylistCoverCrop(
        () => source.value,
        shallowRef(canvas as unknown as HTMLCanvasElement),
        shallowRef(frame as unknown as HTMLElement),
      ),
    )!
    const event = (id: number, x: number, y: number) =>
      ({
        isPrimary: true,
        button: 0,
        pointerId: id,
        clientX: x,
        clientY: y,
      }) as PointerEvent
    try {
      source.value = { width: 1600, height: 1000 } as ImageBitmap
      await nextTick()
      expect([canvas.width, canvas.height]).toEqual([1024, 640])
      expect(drawImage).toHaveBeenCalledOnce()
      cropper.adjust(8 / 5, 2)
      expect(cropper.crop.value).toEqual({ x: 400, y: 250, width: 800, height: 500 })
      cropper.start(event(1, 100, 100))
      cropper.move(event(2, 180, 100))
      expect(cropper.crop.value.x).toBe(400)
      cropper.move(event(1, 180, 100))
      expect(cropper.crop.value.x).toBe(200)
      expect(captured.has(1)).toBe(true)
      cropper.endDrag()
      expect(captured.size).toBe(0)
      cropper.move(event(1, -100, -100))
      expect(cropper.crop.value.x).toBe(200)
      const preventDefault = vi.fn()
      cropper.keydown({
        key: 'ArrowRight',
        shiftKey: true,
        preventDefault,
      } as unknown as KeyboardEvent)
      expect(cropper.crop.value.x).toBeCloseTo(280)
      expect(preventDefault).toHaveBeenCalledOnce()
      // Pointer/keyboard changes update CSS only; the preview is never repainted per move.
      expect(drawImage).toHaveBeenCalledOnce()
      cropper.start(event(3, 0, 0))
    } finally {
      scope.stop()
    }
    expect(captured.size).toBe(0)
  })
})
