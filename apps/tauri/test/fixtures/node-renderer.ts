import { createRenderer } from 'vue'

/** Minimal component lifecycle/event host; it makes no browser focus or layout claims. */
export class TestNode {
  parent: TestNode | null = null
  children: TestNode[] = []
  props: Record<string, unknown> = {}
  text = ''
  value = ''
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
  }
  get tagName() {
    return this.tag.toUpperCase()
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('')
  }
  addEventListener() {}
  removeEventListener() {}
  getAttribute(name: string) {
    return this.props[name] ?? null
  }
}
export function nodes(root: TestNode): TestNode[] {
  return [root, ...root.children.flatMap(nodes)]
}
export const renderer = createRenderer<TestNode, TestNode>({
  createElement: (tag) => new TestNode(tag),
  createText: (text) => Object.assign(new TestNode('#text'), { text }),
  createComment: () => new TestNode('#comment'),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
    node.children = []
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  patchProp: (node, key, _previous, value) => {
    node.props[key] = value
  },
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node)
    node.parent = null
  },
})
