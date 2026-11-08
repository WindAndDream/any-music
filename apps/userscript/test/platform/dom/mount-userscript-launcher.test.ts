import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  mountUserscriptLauncher,
  USERSCRIPT_HOST_TAG_NAME,
} from '@/platform/dom/mount-userscript-launcher'

describe('mountUserscriptLauncher', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('mounts one production launcher and removes it idempotently', () => {
    const testDocument = new TestDocument()
    vi.stubGlobal('document', testDocument as unknown as Document)
    vi.stubGlobal('MutationObserver', TestMutationObserver)

    const mounted = mountUserscriptLauncher({
      loadExpandedApp: vi.fn(() => Promise.resolve(undefined)),
    })

    expect(mounted?.host.localName).toBe(USERSCRIPT_HOST_TAG_NAME)
    expect(testDocument.documentElement.children).toContain(mounted?.host)
    expect(
      mountUserscriptLauncher({ loadExpandedApp: vi.fn(() => Promise.resolve(undefined)) }),
    ).toBeUndefined()

    mounted?.unmount()
    mounted?.unmount()
    expect(testDocument.documentElement.children).not.toContain(mounted?.host)
    expect(TestMutationObserver.instances.at(-1)?.disconnect).toHaveBeenCalledOnce()
  })

  it('shows a failed writer claim to touch and assistive users, then retries the same launcher', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const testDocument = new TestDocument()
    vi.stubGlobal('document', testDocument as unknown as Document)
    vi.stubGlobal('MutationObserver', TestMutationObserver)
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    })
    const unmount = vi.fn()
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('另一个标签页已展开 Any Music，请先关闭该标签页后重试。'))
      .mockResolvedValueOnce({ unmount })
    const mounted = mountUserscriptLauncher({ loadExpandedApp: load })!
    const shadow = (mounted.host as unknown as TestElement).shadowRoot!
    const indicator = shadow.children[1] as TestElement
    const button = shadow.children[2] as TestElement
    const [title, description] = indicator.children[1]!.children as TestElement[]

    button.dispatch('click')
    button.dispatch('click')
    await vi.runAllTimersAsync()
    expect(load).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(false)
    expect(button.attributes.get('aria-busy')).toBe('false')
    expect(button.attributes.get('aria-describedby')).toBe(indicator.id)
    expect(indicator.attributes.get('aria-hidden')).toBe('false')
    expect(indicator.classList.add).toHaveBeenCalledWith(
      'am-launcher-status--error',
      'am-launcher-status--active',
    )
    expect(title!.textContent).toBe('Any Music 打开失败')
    expect(description!.textContent).toContain('另一个标签页已展开')
    expect(description!.textContent).toContain('点击右侧按钮重试')

    button.dispatch('click')
    expect(title!.textContent).toBe('正在打开 Any Music')
    expect(indicator.classList.remove).toHaveBeenCalledWith('am-launcher-status--error')
    await vi.runAllTimersAsync()
    expect(load).toHaveBeenCalledTimes(2)
    button.dispatch('click')
    await vi.runAllTimersAsync()
    expect(load).toHaveBeenCalledTimes(2)
    mounted.unmount()
    expect(unmount).toHaveBeenCalledOnce()
  })
})

class TestNode {
  readonly children: TestNode[] = []
  parent?: TestNode
  textContent = ''

  append(...nodes: TestNode[]): void {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: TestNode[]): void {
    for (const child of this.children) child.parent = undefined
    this.children.splice(0)
    this.append(...nodes)
  }

  remove(): void {
    if (!this.parent) return
    const index = this.parent.children.indexOf(this)
    if (index >= 0) this.parent.children.splice(index, 1)
    this.parent = undefined
  }
}

class TestEventNode extends TestNode {
  readonly #listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListener>()
    listeners.add(listener)
    this.#listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.#listeners.get(type)?.delete(listener)
  }

  dispatch(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(new Event(type))
  }
}

class TestElement extends TestEventNode {
  readonly attributes = new Map<string, string>()
  readonly classList = { add: vi.fn(), remove: vi.fn() }
  readonly localName: string
  shadowRoot?: TestShadowRoot
  type = ''
  id = ''
  title = ''
  disabled = false

  constructor(localName: string) {
    super()
    this.localName = localName
  }

  attachShadow(): ShadowRoot {
    this.shadowRoot = new TestShadowRoot()
    return this.shadowRoot as unknown as ShadowRoot
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

class TestShadowRoot extends TestEventNode {}

class TestDocument {
  readonly documentElement = new TestElement('html')

  createElement(name: string): HTMLElement {
    return new TestElement(name) as unknown as HTMLElement
  }

  createElementNS(_namespace: string, name: string): SVGElement {
    return new TestElement(name) as unknown as SVGElement
  }

  querySelector(name: string): Element | null {
    return (this.documentElement.children.find(
      (node) => node instanceof TestElement && node.localName === name,
    ) ?? null) as unknown as Element | null
  }
}

class TestMutationObserver {
  static readonly instances: TestMutationObserver[] = []
  readonly disconnect = vi.fn()

  constructor(_callback: MutationCallback) {
    TestMutationObserver.instances.push(this)
  }

  observe(): void {}
}
