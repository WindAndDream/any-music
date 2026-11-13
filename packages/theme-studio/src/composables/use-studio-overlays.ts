import {
  computed,
  inject,
  onScopeDispose,
  provide,
  shallowReactive,
  useTemplateRef,
  watch,
} from 'vue'
import type { InjectionKey, Ref } from 'vue'

interface StudioOverlays {
  trackActionId: Readonly<Ref<string | null>>
  target: Readonly<Ref<HTMLElement | null>>
  pages: Map<symbol, boolean>
}
const overlayKey: InjectionKey<StudioOverlays> = Symbol('studio-page-overlays')

/** Page dialogs escape the scrolling/size-contained desk while staying inside the product root. */
export function provideStudioOverlays(trackActionId: () => string | null = () => null) {
  const target = useTemplateRef<HTMLElement>('pageModalTarget')
  const pages = shallowReactive(new Map<symbol, boolean>())
  provide(overlayKey, { target, pages, trackActionId: computed(trackActionId) })
  return { modalOpen: computed(() => [...pages.values()].some(Boolean)) }
}

export function useStudioOverlays(open: () => boolean) {
  const overlays = inject(overlayKey, undefined)
  const id = Symbol('studio-page')
  if (overlays) {
    watch(open, (value) => overlays.pages.set(id, value), { immediate: true })
    onScopeDispose(() => overlays.pages.delete(id))
  }
  return overlays
}
