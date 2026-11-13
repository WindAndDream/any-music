import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import ProxyManagementList from '../../../src/components/settings/ProxyManagementList.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../music-sources/catalog-test-renderer'

describe('ProxyManagementList', () => {
  it('requires confirmation, supports cancellation and only removes an unassigned proxy', async () => {
    const props = reactive({
      proxies: [
        {
          id: 'assigned',
          name: '主代理',
          url: 'http://localhost:80',
          protocol: 'HTTP',
          accountNames: ['主账号'],
        },
        {
          id: 'free',
          name: '备用代理',
          url: 'socks5://localhost:1080',
          protocol: 'SOCKS5',
          accountNames: [] as string[],
        },
      ],
      busy: false,
      onRemove: vi.fn(),
    })
    const view = mountCatalogComponent(ProxyManagementList, props)
    const button = (label: string) =>
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.props['aria-label'] === label,
      )
    expect(button('删除代理 主代理').props.disabled).toBe(true)
    expect(button('删除代理 主代理').props['aria-describedby']).toBeTruthy()
    dispatchCatalogEvent(button('删除代理 备用代理'), 'onClick')
    await nextTick()
    expect(props.onRemove).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.trim() === '取消',
      ),
      'onClick',
    )
    await nextTick()
    expect(view.root.textContent).not.toContain('确认删除“')
    dispatchCatalogEvent(button('删除代理 备用代理'), 'onClick')
    await nextTick()
    props.busy = true
    await nextTick()
    dispatchCatalogEvent(button('确认删除代理 备用代理'), 'onClick')
    expect(props.onRemove).not.toHaveBeenCalled()
    props.busy = false
    props.proxies[1]!.accountNames = ['新分配的账号']
    await nextTick()
    dispatchCatalogEvent(button('确认删除代理 备用代理'), 'onClick')
    expect(props.onRemove).not.toHaveBeenCalled()
    props.proxies[1]!.accountNames = []
    await nextTick()
    dispatchCatalogEvent(button('确认删除代理 备用代理'), 'onClick')
    expect(props.onRemove).toHaveBeenCalledExactlyOnceWith('free')
    view.unmount()
  })
})
