/** Transient presentation state. Keys identify occurrences, never pixel positions or business state. */
export interface PresentationContinuitySnapshot {
  anchor?: { key: string; offset: number }
  focus?: { itemKey: string; controlKey: string }
}

export interface PresentationContinuityAdapter {
  capture(): PresentationContinuitySnapshot | undefined
  restore(snapshot: PresentationContinuitySnapshot, signal: AbortSignal): Promise<boolean>
}

const adapters = new WeakMap<Element, PresentationContinuityAdapter>()

/** Build-owned renderers register only their current semantic collection surface. */
export function registerPresentationContinuity(
  element: Element,
  adapter: PresentationContinuityAdapter,
) {
  adapters.set(element, adapter)
  return () => {
    if (adapters.get(element) === adapter) adapters.delete(element)
  }
}

export function getPresentationContinuity(element: Element) {
  return adapters.get(element)
}
