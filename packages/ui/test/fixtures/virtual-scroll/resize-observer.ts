import { vi } from 'vitest'

export function createResizeEnvironment() {
  const observers: {
    observe: ReturnType<typeof vi.fn>
    unobserve: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    notify: (targets: Element[]) => void
  }[] = []
  class Observer {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    constructor(notify: ResizeObserverCallback) {
      observers.push({
        observe: this.observe,
        unobserve: this.unobserve,
        disconnect: this.disconnect,
        notify: (targets) =>
          notify(
            targets.map((target) => ({ target }) as ResizeObserverEntry),
            this as unknown as ResizeObserver,
          ),
      })
    }
  }
  const view = Object.assign(new EventTarget(), { ResizeObserver: Observer })
  const document = { defaultView: view } as unknown as Document
  return { document, view, observers }
}

export class VirtualElement extends EventTarget {
  isConnected = true
  clientWidth = 500
  clientHeight = 300
  clientTop = 2
  clientLeft = 3
  scrollTop = 80
  scrollLeft = 0
  rect = { top: 10, left: 20, width: 500, height: 300 }
  getBoundingClientRect = vi.fn(() => this.rect as DOMRect)
  readonly ownerDocument: Document
  constructor(document: Document) {
    super()
    this.ownerDocument = document
  }
  asElement(): HTMLElement {
    return this as unknown as HTMLElement
  }
}
