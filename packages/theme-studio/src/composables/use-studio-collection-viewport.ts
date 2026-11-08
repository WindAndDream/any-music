import { shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

/** Studio moves vertical scrolling from content to desk at its container breakpoint. */
export function useStudioCollectionViewport(element: Readonly<Ref<HTMLElement | null>>) {
  const scrollElement = shallowRef<HTMLElement | null>(null)
  watch(
    element,
    (node, _previous, onCleanup) => {
      const content = node?.closest<HTMLElement>('.studio-content')
      const desk = content?.closest<HTMLElement>('.studio-desk')
      const view = node?.ownerDocument?.defaultView
      function refresh() {
        const overflow = desk && view?.getComputedStyle(desk).overflowY
        scrollElement.value =
          desk && (overflow === 'auto' || overflow === 'scroll') ? desk : (content ?? null)
      }
      refresh()
      const Observer = view?.ResizeObserver
      const observer = Observer ? new Observer(refresh) : undefined
      if (content) observer?.observe(content)
      if (desk) observer?.observe(desk)
      view?.addEventListener('resize', refresh)
      onCleanup(() => {
        observer?.disconnect()
        view?.removeEventListener('resize', refresh)
      })
    },
    { immediate: true, flush: 'post' },
  )
  return scrollElement
}
