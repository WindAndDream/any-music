import { computed, nextTick, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

/** Fit the initial artwork with breathing room, then let zoom use the full screen surface. */
export function useImagePreview(
  props: Readonly<{ open: boolean; src: string; title: string }>,
  viewport: Readonly<Ref<HTMLElement | null>>,
) {
  const zoom = shallowRef(1)
  const content = shallowRef({ src: props.src, title: props.title })
  const naturalSize = shallowRef({ width: 1024, height: 1024 })
  const viewportSize = shallowRef({ width: 0, height: 0 })
  const fittedSize = computed(() => {
    const image = naturalSize.value
    const bounds = viewportSize.value
    const scale = Math.min(
      1,
      (bounds.width * 0.8) / image.width,
      (bounds.height * 0.75) / image.height,
    )
    return { width: image.width * scale, height: image.height * scale }
  })
  watch(
    [() => props.open, () => props.src, () => props.title],
    ([open, src, title], [wasOpen, previousSrc]) => {
      if (!open) return // Retain artwork and scale throughout the dialog's leave transition.
      content.value = { src, title }
      if (!wasOpen || src !== previousSrc) {
        zoom.value = 1
        naturalSize.value = { width: 1024, height: 1024 }
      }
    },
  )
  watch(
    viewport,
    (element, _, onCleanup) => {
      if (!element) return
      const measure = () => {
        viewportSize.value = { width: element.clientWidth, height: element.clientHeight }
      }
      measure()
      if (typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      onCleanup(() => observer.disconnect())
    },
    { flush: 'post' },
  )
  watch([zoom, fittedSize], async () => {
    await nextTick()
    const element = viewport.value
    if (!element || !props.open) return
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
  })
  return {
    zoom,
    content,
    canvasStyle: computed(() => ({
      inlineSize: `${Math.max(viewportSize.value.width, fittedSize.value.width * zoom.value)}px`,
      blockSize: `${Math.max(viewportSize.value.height, fittedSize.value.height * zoom.value)}px`,
    })),
    imageStyle: computed(() => ({
      inlineSize: `${fittedSize.value.width}px`,
      blockSize: `${fittedSize.value.height}px`,
      transform: `translate(-50%, -50%) scale(${zoom.value})`,
    })),
    setZoom: (value: number) => {
      zoom.value = Math.min(4, Math.max(1, value))
    },
    handleLoad: (event: Event) => {
      const image = event.target as HTMLImageElement
      if (image.naturalWidth && image.naturalHeight)
        naturalSize.value = { width: image.naturalWidth, height: image.naturalHeight }
    },
  }
}
