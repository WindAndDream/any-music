import { setMaxListeners } from 'node:events'

import { createRenderer, markRaw } from 'vue'

import { CatalogTestElement } from './test-renderer'

function detach(node: CatalogTestElement) {
  if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
  node.parent = null
}

/** Real compiled theme components, injected boxes/focus only; no native layout acceptance. */
export function createSemanticThemeRenderer(getTheme: () => 'classic' | 'studio') {
  const view = Object.assign(new EventTarget(), {
    getComputedStyle: () => ({
      gridTemplateColumns: '300px 300px 300px',
      columnGap: '12px',
      rowGap: '12px',
      direction: 'ltr',
      visibility: 'visible',
    }),
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
  })
  const document = { defaultView: view, activeElement: null } as unknown as Document
  // Many mounted neutral controls share this injected browser surface. Native EventTarget
  // has no Node ten-listener diagnostic; keep a finite fixture ceiling above this view's use.
  setMaxListeners(100, view)
  class SemanticElement extends CatalogTestElement {
    readonly ownerDocument = document
    readonly nodeType = 1
    clientWidth = 1000
    clientHeight = 300
    clientTop = 0
    scrollTop = 0
    scrollLeft = 0
    scrollHeight = 1_000_000
    scrollWidth = 1000
    get isConnected(): boolean {
      return this === root || Boolean(this.parent && (this.parent as SemanticElement).isConnected)
    }
    get parentElement() {
      return this.parent as SemanticElement | null
    }
    constructor(tag: string) {
      super(tag)
      const values = new Map<string, string>()
      Object.assign(this.style, {
        setProperty: (key: string, value: string) => values.set(key, value),
        getPropertyValue: (key: string) => values.get(key) ?? '',
        getPropertyPriority: () => '',
        removeProperty: (key: string) => values.delete(key),
      })
      markRaw(this)
    }
    hasAttribute(key: string) {
      return key in this.props && this.props[key] !== false
    }
    override setAttribute(key: string, value: string) {
      super.setAttribute(key, value)
      if (key.startsWith('data-'))
        this.dataset[
          key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        ] = value
    }
    override removeAttribute(key: string) {
      super.removeAttribute(key)
      if (key.startsWith('data-'))
        delete this.dataset[
          key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        ]
    }
    override closest(selector: string): SemanticElement | null {
      const matches = selector.split(',').some((part) => {
        const candidate = part.trim()
        if (candidate.startsWith('.'))
          return String(this.props.class ?? '')
            .split(' ')
            .includes(candidate.slice(1))
        const match = candidate.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/)
        const name = match?.[1]
        return name
          ? name in this.props &&
              this.props[name] !== false &&
              (match?.[2] === undefined || this.props[name] === match[2])
          : this.tag === candidate
      })
      return matches ? this : ((this.parent as SemanticElement | null)?.closest(selector) ?? null)
    }
    contains(target: CatalogTestElement): boolean {
      return (
        target === this ||
        this.children.some((child) => (child as SemanticElement).contains(target))
      )
    }
    override getRootNode() {
      return document as unknown as CatalogTestElement
    }
    getClientRects() {
      return this.isConnected ? [this.getBoundingClientRect()] : []
    }
    getBoundingClientRect(): DOMRect {
      const scroll = this.closest('.music-app-shell__content, .studio-content')
      const occurrence = this.closest('[data-occurrence], [data-am-continuity-item]')
      const key = occurrence?.dataset.occurrence ?? occurrence?.dataset.amContinuityItem
      const index = key ? Number(key.slice(key.lastIndexOf(':') + 1)) : undefined
      const position =
        index !== undefined && Number.isFinite(index)
          ? getTheme() === 'classic'
            ? Math.floor(index / 3) * 112
            : index * 60
          : 0
      const height = getTheme() === 'classic' ? 100 : 60
      const top = this === scroll ? 0 : 80 + position - (scroll?.scrollTop ?? 0)
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 1000,
        width: 1000,
        height,
        x: 0,
        y: top,
        toJSON() {},
      }
    }
    override focus() {
      Object.assign(document, { activeElement: this })
      this.dispatchListeners('focusin', { target: this })
    }
  }
  const root = new SemanticElement('root')
  const renderer = createRenderer<CatalogTestElement, CatalogTestElement>({
    createElement: (tag) => new SemanticElement(tag),
    createText: (text) => Object.assign(new SemanticElement('#text'), { text }),
    createComment: (text) => Object.assign(new SemanticElement('#comment'), { text }),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
      node.children = []
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    patchProp: (node, key, _previous, next) => {
      if (key.startsWith('data-')) {
        const name = key.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
        if (next === undefined || next === null) delete node.dataset[name]
        else node.dataset[name] = String(next)
      }
      if (next === undefined || next === null) delete node.props[key]
      else node.props[key] = next
    },
    insert: (node, parent, anchor) => {
      detach(node)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove: detach,
    setScopeId: (node, id) => node.setAttribute(id, ''),
  })
  return { renderer, root, document, view, Element: SemanticElement }
}
