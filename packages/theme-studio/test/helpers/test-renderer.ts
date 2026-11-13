import { createRenderer, h, markRaw } from 'vue'
import type { Component } from 'vue'

/** Runs compiled native handlers in Node; it does not establish browser focus or layout. */
export class StudioTestNode {
  props: Record<string, unknown> = {}
  children: StudioTestNode[] = []
  parent: StudioTestNode | null = null
  text = ''
  private listeners = new Map<string, ((event: unknown) => void)[]>()
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
    // Match native DOM nodes: teleport targets must never become reactive readonly proxies.
    markRaw(this)
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('')
  }
  getRootNode(): StudioTestNode {
    return this.parent?.getRootNode() ?? this
  }
  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  removeEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(
      name,
      (this.listeners.get(name) ?? []).filter((item) => item !== listener),
    )
  }
}

function remove(node: StudioTestNode) {
  if (node.parent) node.parent.children = node.parent.children.filter((item) => item !== node)
  node.parent = null
}

const renderer = createRenderer<StudioTestNode, StudioTestNode>({
  createElement: (tag) => new StudioTestNode(tag),
  createText: (text) => Object.assign(new StudioTestNode('#text'), { text }),
  createComment: (text) => Object.assign(new StudioTestNode('#comment'), { text }),
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
})

export function mountStudio(component: Component, props: Record<string, unknown>) {
  const root = new StudioTestNode('root')
  const app = renderer.createApp({ render: () => h(component, props) })
  app.mount(root)
  return { root, unmount: () => app.unmount() }
}

export function findStudioNode(
  root: StudioTestNode,
  predicate: (node: StudioTestNode) => boolean,
): StudioTestNode {
  const candidates = [root, ...root.children.flatMap((child) => flatten(child))]
  const found = candidates.find(predicate)
  if (!found) throw new Error('Expected Studio control was not rendered')
  return found
}

function flatten(node: StudioTestNode): StudioTestNode[] {
  return [node, ...node.children.flatMap(flatten)]
}

export function invokeStudio(node: StudioTestNode, event: string, value?: unknown) {
  const handler = node.props[event] as ((value?: unknown) => void) | undefined
  handler?.(value)
}
