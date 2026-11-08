import { createRenderer, h } from 'vue'
import type { Component } from 'vue'

export class Node {
  props: Record<string, unknown> = {}
  children: Node[] = []
  parent: Node | null = null
  text = ''
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('')
  }
  closest(selectors: string): Node | null {
    const matches = selectors.split(',').some((selector) => {
      const value = selector.trim()
      return value.startsWith('[') ? value.slice(1, -1) in this.props : this.tag === value
    })
    return matches ? this : (this.parent?.closest(selectors) ?? null)
  }
}
function remove(node: Node) {
  if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
  node.parent = null
}
const renderer = createRenderer<Node, Node>({
  createElement: (tag) => new Node(tag),
  createText: (text) => Object.assign(new Node('#text'), { text }),
  createComment: (text) => Object.assign(new Node('#comment'), { text }),
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
  insert(node, parent, anchor) {
    remove(node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove,
  setScopeId: (node, id) => {
    node.props[id] = ''
  },
})
export function mount(component: Component) {
  const root = new Node('root')
  const app = renderer.createApp({ render: () => h(component) })
  app.mount(root)
  return { root, unmount: () => app.unmount() }
}
export function find(root: Node, predicate: (node: Node) => boolean): Node {
  if (predicate(root)) return root
  for (const child of root.children) {
    try {
      return find(child, predicate)
    } catch {
      /* Continue the search. */
    }
  }
  throw new Error('Expected card element')
}
export function click(node: Node) {
  let stopped = false
  const event = {
    target: node,
    stopPropagation() {
      stopped = true
    },
    preventDefault() {},
  }
  const path: Node[] = []
  for (let current: Node | null = node; current; current = current.parent) path.push(current)
  for (let index = path.length - 1; index >= 0; index--) {
    const current = path[index]!
    ;(current.props.onClickCapture as ((event: object) => void) | undefined)?.(event)
    if (stopped) return
  }
  for (const current of path) {
    ;(current.props.onClick as ((event: object) => void) | undefined)?.(event)
    if (stopped) return
  }
}
