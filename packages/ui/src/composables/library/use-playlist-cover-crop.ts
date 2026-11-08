import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { getPlaylistCoverCrop, getPlaylistCoverCropPosition } from './playlist-cover-crop'

/** A fixed frame with a movable image; pointer and keyboard inputs share source-pixel geometry. */
export function usePlaylistCoverCrop(
  source: () => ImageBitmap | null,
  canvas: Readonly<Ref<HTMLCanvasElement | null>>,
  frame: Readonly<Ref<HTMLElement | null>>,
) {
  const ratio = shallowRef(8 / 5)
  const zoom = shallowRef(1)
  const position = shallowRef({ x: 0.5, y: 0.5 })
  let drag: { id: number; x: number; y: number; startX: number; startY: number } | undefined
  const crop = computed(() => {
    const image = source()
    return getPlaylistCoverCrop(
      image?.width ?? 1,
      image?.height ?? 1,
      ratio.value,
      zoom.value,
      position.value.x,
      position.value.y,
    )
  })
  const style = computed(() => {
    const image = source()
    const rect = crop.value
    return {
      width: `${(100 * (image?.width ?? 1)) / rect.width}%`,
      height: `${(100 * (image?.height ?? 1)) / rect.height}%`,
      left: `${(-100 * rect.x) / rect.width}%`,
      top: `${(-100 * rect.y) / rect.height}%`,
    }
  })
  function endDrag() {
    if (drag && frame.value?.hasPointerCapture(drag.id)) frame.value.releasePointerCapture(drag.id)
    drag = undefined
  }
  function reset() {
    endDrag()
    zoom.value = 1
    position.value = { x: 0.5, y: 0.5 }
  }
  watch(source, () => {
    ratio.value = 8 / 5
    reset()
  })
  watch(
    [source, canvas],
    ([image, element]) => {
      if (!image || !element) return
      const scale = Math.min(1, 1024 / Math.max(image.width, image.height))
      element.width = Math.max(1, Math.round(image.width * scale))
      element.height = Math.max(1, Math.round(image.height * scale))
      element.getContext('2d')?.drawImage(image, 0, 0, element.width, element.height)
    },
    { flush: 'post' },
  )
  onScopeDispose(endDrag)
  function adjust(nextRatio: number, nextZoom: number) {
    const image = source()
    if (!image) return
    const previous = crop.value
    endDrag()
    ratio.value = nextRatio
    zoom.value = nextZoom
    position.value = getPlaylistCoverCropPosition(
      image.width,
      image.height,
      crop.value,
      previous.x + previous.width / 2,
      previous.y + previous.height / 2,
    )
  }
  function start(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || !source()) return
    endDrag()
    frame.value?.focus({ preventScroll: true })
    frame.value?.setPointerCapture(event.pointerId)
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: crop.value.x,
      startY: crop.value.y,
    }
  }
  function move(event: PointerEvent) {
    const image = source()
    const bounds = frame.value?.getBoundingClientRect()
    if (!drag || drag.id !== event.pointerId || !image || !bounds?.width || !bounds.height) return
    const rect = crop.value
    position.value = getPlaylistCoverCropPosition(
      image.width,
      image.height,
      rect,
      drag.startX - ((event.clientX - drag.x) * rect.width) / bounds.width + rect.width / 2,
      drag.startY - ((event.clientY - drag.y) * rect.height) / bounds.height + rect.height / 2,
    )
  }
  function keydown(event: KeyboardEvent) {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key]
    if (!direction) return
    event.preventDefault()
    const step = event.shiftKey ? 0.1 : 0.02
    position.value = {
      x: Math.max(0, Math.min(1, position.value.x + direction[0]! * step)),
      y: Math.max(0, Math.min(1, position.value.y + direction[1]! * step)),
    }
  }
  return { ratio, zoom, crop, style, adjust, reset, start, move, endDrag, keydown }
}
