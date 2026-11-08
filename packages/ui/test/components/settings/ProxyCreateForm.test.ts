import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import ProxyCreateForm from '../../../src/components/settings/ProxyCreateForm.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../music-sources/catalog-test-renderer'

beforeEach(() => vi.stubGlobal('document', { activeElement: null }))
afterEach(() => vi.unstubAllGlobals())

describe('ProxyCreateForm', () => {
  it('associates field errors with inputs and forwards draft, blur and submit events', () => {
    const props = reactive({
      name: '',
      url: '',
      busy: false,
      nameError: '代理名称已存在',
      urlError: '代理端口无效',
      'onUpdate:name': vi.fn(),
      'onUpdate:url': vi.fn(),
      onValidateName: vi.fn(),
      onValidateUrl: vi.fn(),
      onAdd: vi.fn(),
    })
    const view = mountCatalogComponent(ProxyCreateForm, props)
    const name = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.placeholder === '例如：本地代理',
    )
    const url = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.inputmode === 'url',
    )
    for (const input of [name, url]) {
      expect(input.props['aria-invalid']).toBe(true)
      expect(input.props['aria-describedby']).toBeTruthy()
    }
    expect(view.root.textContent).toContain('代理名称已存在')
    expect(view.root.textContent).toContain('代理端口无效')
    url.value = 'socks5://localhost:1080'
    dispatchCatalogEvent(url, 'onInput', false)
    dispatchCatalogEvent(url, 'onBlur', false)
    dispatchCatalogEvent(name, 'onBlur', false)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
      false,
    )
    expect(props['onUpdate:url']).toHaveBeenCalledWith('socks5://localhost:1080')
    expect(props.onValidateName).toHaveBeenCalledOnce()
    expect(props.onValidateUrl).toHaveBeenCalledOnce()
    expect(props.onAdd).toHaveBeenCalledOnce()
    view.unmount()
  })
})
