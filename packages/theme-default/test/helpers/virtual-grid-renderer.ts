import { createRenderer, h } from 'vue'
import type { Component } from 'vue'

import { CatalogTestElement } from './test-renderer'

function detach(node: CatalogTestElement) {
  if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
  node.parent = null
}

function isCatalogViewport(node: CatalogTestElement) {
  return (
    node.props['data-catalog-view'] === 'lists' ||
    node.props.class === 'catalog-page__tracks-scroll'
  )
}

/** Injected geometry for real theme rows; this host performs no CSS layout or browser work. */
export function mountMeasuredThemeGrid(
  component: Component,
  columns: () => number,
  naturalHeight = 100,
) {
  const view = Object.assign(new EventTarget(), {
    getComputedStyle: () => ({
      gridTemplateColumns: Array(columns()).fill('300px').join(' '),
      columnGap: '12px',
      rowGap: '12px',
      direction: 'ltr',
      visibility: 'visible',
    }),
  })
  const document = { defaultView: view, activeElement: null } as unknown as Document
  const declarations = new Map<string, string>()
  const scroll = Object.assign(new EventTarget(), {
    ownerDocument: document,
    isConnected: true,
    clientWidth: 1000,
    clientHeight: 300,
    clientTop: 0,
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 2_000_000,
    style: {
      getPropertyValue: (name: string) => declarations.get(name) ?? '',
      getPropertyPriority: () => '',
      setProperty: (name: string, value: string) => declarations.set(name, value),
      removeProperty: (name: string) => declarations.delete(name),
    },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 1000, height: 300 }) as DOMRect,
  })
  function element(tag: string) {
    const node = new CatalogTestElement(tag)
    function bounds() {
      let root: CatalogTestElement | null = node
      while (root && !isCatalogViewport(root)) root = root.parent
      const top =
        root === node
          ? 0
          : 24 - (root ? (root as unknown as HTMLElement).scrollTop : scroll.scrollTop)
      const height = root === node ? 300 : naturalHeight
      return { top, left: 0, width: 1000, height, bottom: top + height, right: 1000 } as DOMRect
    }
    Object.defineProperty(node, 'parentElement', { get: () => node.parent })
    const scrollStyle = Object.assign(node.style, {
      getPropertyValue: (name: string) => node.style[name] ?? '',
      getPropertyPriority: () => '',
      setProperty: (name: string, value: string) => (node.style[name] = value),
      removeProperty: (name: string) => delete node.style[name],
    })
    return Object.assign(node, {
      ownerDocument: document,
      isConnected: true,
      nodeType: 1,
      clientWidth: 1000,
      clientHeight: 300,
      clientTop: 0,
      scrollTop: 0,
      scrollHeight: 2_000_000,
      style: scrollStyle,
      matches: (selector: string) =>
        selector === ':disabled' ? Boolean(node.props.disabled) : node.closest(selector) === node,
      getClientRects: () => (node.parent ? [bounds()] : []),
      getBoundingClientRect: bounds,
      getRootNode: () => document,
      closest: (selector: string): CatalogTestElement | null =>
        selector === '.music-app-shell__content'
          ? (scroll as unknown as CatalogTestElement)
          : CatalogTestElement.prototype.closest.call(node, selector),
      contains: (target: CatalogTestElement) => {
        for (let item: CatalogTestElement | null = target; item; item = item.parent)
          if (item === node) return true
        return false
      },
      focus: () => {
        Object.assign(document, { activeElement: node })
        for (let current: CatalogTestElement | null = node; current; current = current.parent)
          current.dispatchListeners('focusin', { target: node })
      },
      dispatchEvent: (event: Event) => node.dispatchListeners(event.type, event),
      setPointerCapture: () => {},
      hasPointerCapture: () => true,
      releasePointerCapture: () => {},
    })
  }
  const renderer = createRenderer<CatalogTestElement, CatalogTestElement>({
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
    remove: (node) => {
      detach(node)
      Object.assign(node, { isConnected: false })
    },
    setScopeId: (node, id) => node.setAttribute(id, ''),
  })
  const root = element('root')
  Object.assign(document, {
    querySelectorAll: root.querySelectorAll.bind(root),
    querySelector: root.querySelector.bind(root),
    contains: root.contains,
  })
  const app = renderer.createApp({ render: () => h(component, { scroll }) })
  app.mount(root)
  return { root, document, scroll, view, app, unmount: () => app.unmount() }
}
