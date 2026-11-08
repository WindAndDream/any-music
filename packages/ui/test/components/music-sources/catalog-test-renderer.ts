import { createRenderer, h, markRaw } from 'vue'
import type { Component } from 'vue'

/** Node 内的轻量渲染宿主，执行编译后的组件事件而不启动产品或浏览器。 */
export class CatalogTestElement {
  props: Record<string, unknown> = {}
  style: Record<string, string> = {}
  children: CatalogTestElement[] = []
  parent: CatalogTestElement | null = null
  text = ''
  value = ''
  selected = false
  isFocused = false
  private listeners = new Map<string, ((event: unknown) => void)[]>()

  readonly tag: string

  constructor(tag: string) {
    this.tag = tag
    markRaw(this)
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('')
  }

  /** 供 Vue 的原生 select v-model 指令读取选项，仍只运行组件事件。 */
  get options(): CatalogTestElement[] {
    return this.children.filter((child) => child.tag === 'option')
  }

  closest(selectors: string): CatalogTestElement | null {
    const matches = selectors.split(',').some((selector) => {
      const value = selector.trim()
      return value.startsWith('[') ? value.slice(1, -1) in this.props : this.tag === value
    })
    return matches ? this : (this.parent?.closest(selectors) ?? null)
  }

  focus(): void {
    this.isFocused = true
  }
  select(): void {}

  /** 转场的无障碍生命周期使用标准属性方法；这里只模拟属性，不启动浏览器动画。 */
  setAttribute(name: string, value: string): void {
    this.props[name] = value
  }
  getAttribute(name: string): string | null {
    return name in this.props ? String(this.props[name]) : null
  }
  removeAttribute(name: string): void {
    delete this.props[name]
  }

  /** 支持筛选器的初始焦点与日历键盘定位，不依赖产品界面或真实 DOM。 */
  querySelector(selector: string): CatalogTestElement | null {
    const matches = (node: CatalogTestElement): boolean =>
      selector.split(',').some((part) => {
        const attributes = [...part.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)]
        return (
          attributes.length > 0 &&
          attributes.every((match) => {
            const key = match[1]
            return (
              key !== undefined &&
              key in node.props &&
              (match[2] === undefined || String(node.props[key]) === match[2])
            )
          })
        )
      })
    for (const child of this.children) {
      if (matches(child)) return child
      const descendant = child.querySelector(selector)
      if (descendant) return descendant
    }
    return null
  }

  addEventListener(name: string, listener: (event: unknown) => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }

  dispatchListeners(name: string, event: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event)
  }

  getRootNode(): CatalogTestElement {
    return this.parent?.getRootNode() ?? this
  }
}

function removeNode(node: CatalogTestElement): void {
  if (node.parent) {
    node.parent.children = node.parent.children.filter((child) => child !== node)
    node.parent = null
  }
}

const renderer = createRenderer<CatalogTestElement, CatalogTestElement>({
  createElement: (tag) => new CatalogTestElement(tag),
  createText: (text) => Object.assign(new CatalogTestElement('#text'), { text }),
  createComment: (text) => Object.assign(new CatalogTestElement('#comment'), { text }),
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
    if (key === 'value') node.value = String(next ?? '')
    if (next === undefined || next === null) delete node.props[key]
    else node.props[key] = next
  },
  insert: (node, parent, anchor) => {
    removeNode(node)
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove: removeNode,
  setScopeId: (node, id) => node.setAttribute(id, ''),
})

export function mountCatalogComponent(component: Component, props: Record<string, unknown>) {
  const root = new CatalogTestElement('root')
  const app = renderer.createApp({ render: () => h(component, { ...props }) })
  app.mount(root)
  return { root, unmount: () => app.unmount() }
}

export function findCatalogElement(
  root: CatalogTestElement,
  predicate: (node: CatalogTestElement) => boolean,
): CatalogTestElement {
  if (predicate(root)) return root
  for (const child of root.children) {
    try {
      return findCatalogElement(child, predicate)
    } catch {
      /* 继续搜索其他分支。 */
    }
  }
  throw new Error('Expected catalog element was not rendered')
}

/** 模拟原生冒泡，确保按钮/复选框的事件不会被卡片空白热区重复处理。 */
export function dispatchCatalogEvent(
  target: CatalogTestElement,
  name: string,
  bubbles = true,
): void {
  const event = { target, preventDefault() {}, stopPropagation() {} }
  for (let node: CatalogTestElement | null = target; node; node = bubbles ? node.parent : null) {
    node.dispatchListeners(name.slice(2).toLowerCase(), event)
    const handler = node.props[name] as ((event: unknown) => void) | undefined
    handler?.(event)
  }
}
