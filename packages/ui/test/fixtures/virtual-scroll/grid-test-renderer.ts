import { createRenderer, h } from 'vue'
import type { Component } from 'vue'

import { CatalogTestElement } from '../../components/music-sources/catalog-test-renderer'

function remove(node: CatalogTestElement) {
  if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
  node.parent = null
}

/** Injected natural geometry only. This renderer does not compute CSS Grid or image layout. */
export function mountVirtualGridComponent(component: Component, document: Document, width = 1000) {
  function element(tag: string) {
    const events = new EventTarget()
    return Object.assign(new CatalogTestElement(tag), {
      ownerDocument: document,
      isConnected: true,
      getBoundingClientRect: () => ({ top: 12, left: 0, width, height: 20 }) as DOMRect,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
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
      node.props[key] = next
    },
    insert: (node, parent, anchor) => {
      remove(node)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove,
    setScopeId: (node, id) => node.setAttribute(id, ''),
  })
  const root = element('root')
  const app = renderer.createApp({ render: () => h(component) })
  app.mount(root)
  return { root, unmount: () => app.unmount() }
}
