import { vi } from 'vitest'
import { createRenderer, h } from 'vue'
import type { Component } from 'vue'

import { StudioTestNode } from './test-renderer'

/** Injected boxes/events only; this host does not perform browser table/Grid layout. */
export class MeasuredStudioNode extends StudioTestNode {
  dataset: Record<string, string> = {}
  nodeType = 1
  isConnected = true
  clientWidth = 1000
  clientHeight = 300
  clientTop = 0
  scrollTop = 0
  scrollLeft = 0
  scrollHeight = 2_000_000
  disabled = false
  ownerDocument!: Document
  style = Object.assign(
    {},
    {
      getPropertyValue: (name: string): string => this.declarations.get(name) ?? '',
      getPropertyPriority: () => '',
      setProperty: (name: string, value: string) => this.declarations.set(name, value),
      removeProperty: (name: string) => this.declarations.delete(name),
    },
  )
  private declarations = new Map<string, string>()
  private events = new Map<string, Set<(event: unknown) => void>>()
  get parentElement(): MeasuredStudioNode | null {
    return this.parent as MeasuredStudioNode | null
  }
  override getRootNode(): StudioTestNode {
    return this.ownerDocument as unknown as StudioTestNode
  }
  getClientRects() {
    return this.isConnected ? [this.getBoundingClientRect()] : []
  }
  getBoundingClientRect(): DOMRect {
    return { top: 0, left: 0, width: 1000, height: 76 } as DOMRect
  }
  setAttribute(name: string, value: string) {
    this.props[name] = value
  }
  getAttribute(name: string) {
    return this.props[name] === undefined ? null : String(this.props[name])
  }
  hasAttribute(name: string) {
    return name in this.props && this.props[name] !== false
  }
  removeAttribute(name: string) {
    delete this.props[name]
  }
  contains(target: StudioTestNode): boolean {
    for (let node: StudioTestNode | null = target; node; node = node.parent)
      if (node === this) return true
    return false
  }
  matches(selector: string): boolean {
    if (selector.startsWith('.'))
      return String(this.props.class ?? '')
        .split(' ')
        .includes(selector.slice(1))
    const attributes = [...selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)]
    return attributes.length
      ? attributes.every(
          ([, name, value]) =>
            name !== undefined &&
            name in this.props &&
            (value === undefined || String(this.props[name]) === value),
        )
      : selector === this.tag
  }
  closest(selector: string): MeasuredStudioNode | null {
    return selector.split(',').some((part) => this.matches(part.trim()))
      ? this
      : (this.parentElement?.closest(selector) ?? null)
  }
  querySelectorAll(selector: string): MeasuredStudioNode[] {
    const result: MeasuredStudioNode[] = []
    for (const child of this.children as MeasuredStudioNode[]) {
      if (child.matches(selector)) result.push(child)
      result.push(...child.querySelectorAll(selector))
    }
    return result
  }
  querySelector(selector: string): MeasuredStudioNode | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
  override addEventListener(name: string, listener: (event: unknown) => void) {
    const listeners = this.events.get(name) ?? new Set()
    listeners.add(listener)
    this.events.set(name, listeners)
  }
  override removeEventListener(name: string, listener: (event: unknown) => void) {
    this.events.get(name)?.delete(listener)
  }
  dispatchEvent(event: Event) {
    for (const listener of this.events.get(event.type) ?? []) listener(event)
    return true
  }
  focus() {
    Object.assign(this.ownerDocument, { activeElement: this })
    bubbleFocus(this)
  }
}

function bubbleFocus(node: MeasuredStudioNode) {
  node.dispatchEvent(new Event('focusin'))
  if (node.parentElement) bubbleFocus(node.parentElement)
}
function detach(node: StudioTestNode) {
  if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
  node.parent = null
}

export function mountMeasuredStudio(
  component: Component,
  options: { styled?: boolean; columns?: () => number } = {},
) {
  const observers: {
    observe: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
    notify: () => void
  }[] = []
  class Observer {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    constructor(callback: ResizeObserverCallback) {
      observers.push({
        observe: this.observe,
        disconnect: this.disconnect,
        notify: () =>
          callback(
            this.observe.mock.calls.map(([target]) => ({ target }) as ResizeObserverEntry),
            this as unknown as ResizeObserver,
          ),
      })
    }
  }
  let narrow = false
  const view = Object.assign(new EventTarget(), {
    ResizeObserver: Observer,
    getComputedStyle: (node: MeasuredStudioNode) => ({
      overflowY: node === desk && narrow ? 'auto' : 'visible',
      gridTemplateColumns: Array(options.columns?.() ?? 2)
        .fill('300px')
        .join(' '),
      columnGap: '12px',
      rowGap: '12px',
      visibility: 'visible',
      direction: 'ltr',
    }),
  })
  const document = { defaultView: view, activeElement: null } as unknown as Document
  const naturalHeight = options.styled ? 144 : 76
  function element(tag: string) {
    const node = new MeasuredStudioNode(tag)
    node.ownerDocument = document
    node.getBoundingClientRect = () => {
      const scroll = narrow ? desk : content
      const key = node.dataset.amContinuityItem ?? node.dataset.occurrence
      const index = key ? Number(key.replace('track-', '')) : 0
      const start = options.styled
        ? Math.floor(index / (options.columns?.() ?? 2)) * (naturalHeight + 12)
        : index * naturalHeight
      return {
        top: node === content || node === desk ? 0 : 24 + start - scroll.scrollTop,
        left: 0,
        width: 1000,
        height: naturalHeight,
        bottom: 24 + start - scroll.scrollTop + naturalHeight,
      } as DOMRect
    }
    return node
  }
  const renderer = createRenderer<MeasuredStudioNode, MeasuredStudioNode>({
    querySelector: () => overlay,
    createElement: element,
    createText: (text) => Object.assign(element('#text'), { text }),
    createComment: (text) => Object.assign(element('#comment'), { text }),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
      node.children = []
    },
    parentNode: (node) => node.parentElement,
    nextSibling: (node) =>
      (node.parent?.children[node.parent.children.indexOf(node) + 1] as MeasuredStudioNode) ?? null,
    patchProp: (node, key, _previous, next) => {
      if (next === undefined || next === null) delete node.props[key]
      else node.props[key] = next
      if (key === 'disabled') node.disabled = Boolean(next)
      if (key.startsWith('data-')) {
        const name = key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        if (next === undefined || next === null) delete node.dataset[name]
        else node.dataset[name] = String(next)
      }
    },
    insert: (node, parent, anchor) => {
      detach(node)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove: (node) => {
      detach(node)
      node.isConnected = false
    },
    setScopeId: (node, id) => node.setAttribute(id, ''),
  })
  const desk = element('div')
  const overlay = element('div')
  desk.props.class = 'studio-desk'
  const content = element('main')
  content.props.class = 'studio-content'
  content.parent = desk
  desk.children.push(content)
  const app = renderer.createApp({ render: () => h(component) })
  app.mount(content)
  return {
    root: content,
    scroll: content,
    desk,
    document,
    observers,
    setNarrow(value: boolean) {
      narrow = value
      view.dispatchEvent(new Event('resize'))
    },
    unmount: () => app.unmount(),
  }
}
