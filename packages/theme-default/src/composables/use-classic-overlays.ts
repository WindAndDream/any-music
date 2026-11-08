import {
  computed,
  inject,
  onScopeDispose,
  provide,
  shallowReactive,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import type { InjectionKey, Ref } from 'vue'

interface ClassicOverlays {
  toolbarTarget: Readonly<Ref<HTMLElement | null>>
  sourceTarget: Readonly<Ref<HTMLElement | null>>
  modalTarget: Readonly<Ref<HTMLElement | null>>
  operatorTarget: Readonly<Ref<HTMLElement | null>>
  /** Root-owned action opener retained through the dialog's closing/focus handoff. */
  trackActionId: Readonly<Ref<string | undefined>>
  pages: Map<symbol, { modal: boolean; operator: boolean }>
}
const overlaysKey: InjectionKey<ClassicOverlays> = Symbol('classic-overlays')

/** Theme-owned DOM layers escape scrolling pages; business/editing state stays in the host. */
export function provideClassicOverlays() {
  const toolbarTarget = useTemplateRef<HTMLElement>('toolbarTarget')
  const sourceTarget = useTemplateRef<HTMLElement>('sourceTarget')
  const modalTarget = useTemplateRef<HTMLElement>('modalTarget')
  const operatorTarget = useTemplateRef<HTMLElement>('operatorTarget')
  const trackActionId = shallowRef<string>()
  const pages = shallowReactive(new Map<symbol, { modal: boolean; operator: boolean }>())
  provide(overlaysKey, {
    toolbarTarget,
    sourceTarget,
    modalTarget,
    operatorTarget,
    trackActionId,
    pages,
  })
  return {
    modalTarget,
    operatorTarget,
    trackActionId,
    modalOpen: computed(() => [...pages.values()].some((page) => page.modal)),
    operatorOpen: computed(() => [...pages.values()].some((page) => page.operator)),
  }
}

export function useClassicOverlays(modal: () => boolean, operator: () => boolean = () => false) {
  const overlays = inject(overlaysKey, undefined)
  const id = Symbol('classic-page')
  if (overlays) {
    watch(
      [modal, operator],
      ([isModal, isOperator]) => overlays.pages.set(id, { modal: isModal, operator: isOperator }),
      {
        immediate: true,
      },
    )
    onScopeDispose(() => overlays.pages.delete(id))
  }
  return overlays
}
