import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick } from 'vue'

import AccountConnectionForm from '@/components/accounts/AccountConnectionForm.vue'
import type { NativeAccount, NativeProxy } from '@/features/accounts/account-runtime'

class TestNode {
  parent: TestNode | null = null
  children: TestNode[] = []
  props: Record<string, unknown> = {}
  text = ''
  readonly tag: string
  constructor(tag: string) {
    this.tag = tag
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('')
  }
}

// Exercise compiled component events in Node without launching the product UI.
const renderer = createRenderer<TestNode, TestNode>({
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
function nodes(root: TestNode): TestNode[] {
  return [root, ...root.children.flatMap(nodes)]
}
async function event(node: TestNode, name: string) {
  const handler = node.props[name] as (event: unknown) => void
  handler({ target: node, preventDefault() {} })
  await nextTick()
}
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

const proxies: NativeProxy[] = Array.from({ length: 10 }, (_, index) => ({
  id: `p${index + 1}`,
  name: `代理 ${index + 1}`,
  url: `http://127.0.0.1:${8000 + index}`,
}))
function mount(overrides: Partial<NativeAccount> = {}, busy = false, savedProxies = proxies) {
  const account: NativeAccount = {
    id: 'account',
    platformId: 'bilibili',
    name: '测试账号',
    status: 'ready',
    state: { login: 'signed-out', verification: 'not-required', connection: 'available' },
    enabled: true,
    authentication: 'anonymous',
    userAgent: '',
    webId: '',
    proxyId: null,
    backupProxyIds: [],
    ...overrides,
  }
  const save = vi.fn()
  const root = new TestNode('root')
  const app = renderer.createApp({
    render: () => h(AccountConnectionForm, { account, proxies: savedProxies, busy, onSave: save }),
  })
  app.mount(root)
  cleanups.push(() => app.unmount())
  function find(predicate: (node: TestNode) => boolean) {
    const found = nodes(root).find(predicate)
    if (!found) throw new Error('Expected connection control was not rendered')
    return found
  }
  return {
    root,
    account,
    save,
    find,
    choose: (id: string) =>
      event(
        find((node) => node.tag === 'input' && node.props.value === id),
        'onChange',
      ),
    click: (label: string) =>
      event(
        find((node) => node.props['aria-label'] === label),
        'onClick',
      ),
    submit: () =>
      event(
        find((node) => node.tag === 'form'),
        'onSubmit',
      ),
  }
}

describe('account connection list', () => {
  it('lists direct and saved proxy connections without dropdowns and saves the selected proxy', async () => {
    const view = mount()
    expect(nodes(view.root).filter((node) => node.tag === 'input')).toHaveLength(11)
    expect(nodes(view.root).some((node) => node.tag === 'select')).toBe(false)
    expect(view.root.textContent).toContain('直连')
    expect(view.root.textContent).toContain(proxies[0]!.url)
    await view.choose('p2')
    await view.submit()
    expect(view.save).toHaveBeenCalledWith({ ...view.account, proxyId: 'p2' })
    expect(view.account.proxyId).toBeNull()
  })
  it('preserves backup ordering and excludes the primary and existing backups from additions', async () => {
    const view = mount({ proxyId: 'p1', backupProxyIds: ['p2'] })
    expect(
      nodes(view.root).some((node) => node.props['aria-label'] === '添加备用代理 代理 1'),
    ).toBe(false)
    expect(
      nodes(view.root).some((node) => node.props['aria-label'] === '添加备用代理 代理 2'),
    ).toBe(false)
    await view.click('添加备用代理 代理 3')
    await view.click('上移备用代理 2')
    await view.submit()
    expect(view.save).toHaveBeenLastCalledWith({ ...view.account, backupProxyIds: ['p3', 'p2'] })
    await view.click('移除备用代理 1')
    await view.choose('p2')
    await view.submit()
    expect(view.save).toHaveBeenLastCalledWith({
      ...view.account,
      proxyId: 'p2',
      backupProxyIds: [],
    })
  })
  it('clears backups when direct is selected and retains the direct-only empty state', async () => {
    const view = mount({ proxyId: 'p1', backupProxyIds: ['p2', 'p3'] })
    await view.choose('')
    expect(view.root.textContent).not.toContain('添加备用代理')
    await view.submit()
    expect(view.save).toHaveBeenCalledWith({ ...view.account, proxyId: null, backupProxyIds: [] })
    const empty = mount({}, false, [])
    expect(empty.root.textContent).toContain('还没有代理')
    await empty.submit()
    expect(empty.save).toHaveBeenCalledWith(empty.account)
  })
  it('limits backups to eight and disables connection fields while busy', async () => {
    const view = mount({
      proxyId: 'p1',
      backupProxyIds: proxies.slice(1, 8).map((proxy) => proxy.id),
    })
    await view.click('添加备用代理 代理 9')
    expect(view.root.textContent).toContain('已达到备用代理上限')
    const backups = view.find(
      (node) => node.tag === 'fieldset' && node.textContent.includes('添加备用代理'),
    )
    expect(backups.props.disabled).toBe(true)
    await view.submit()
    expect(view.save.mock.lastCall?.[0].backupProxyIds).toHaveLength(8)
    const busy = mount({ proxyId: 'p1' }, true)
    expect(
      nodes(busy.root)
        .filter((node) => node.tag === 'fieldset')
        .every((node) => node.props.disabled),
    ).toBe(true)
    expect(busy.find((node) => node.props.type === 'submit').props.disabled).toBe(true)
  })
})
