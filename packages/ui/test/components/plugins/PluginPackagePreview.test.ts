import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import PluginPackagePreview from '../../../src/components/plugins/PluginPackagePreview.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../music-sources/catalog-test-renderer'

beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('document', { activeElement: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('native package preview', () => {
  it('resets all consent when the native package preview changes', async () => {
    const props = reactive({
      busy: false,
      onInstall: vi.fn(),
      preview: {
        token: 'first-preview',
        pluginId: 'org.example.source',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
        publisher: null,
        publisherVerified: false,
        execution: 'sandbox-code',
        permissions: ['network.publicHttps'],
        addedPermissions: ['network.publicHttps'],
        historicalLevel: 'L2',
        canInstall: true,
        blockedReason: '',
      },
    })
    const view = mountCatalogComponent(PluginPackagePreview, props)
    const checkbox = (text: string) =>
      findCatalogElement(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'label' && node.textContent.includes(text),
        ),
        (node) => node.props.type === 'checkbox',
      )
    const check = (text: string) => {
      const input = checkbox(text)
      Object.assign(input, { checked: true })
      dispatchCatalogEvent(input, 'onChange')
    }
    const submit = () =>
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '确认安装与授权',
        ),
        'onClick',
      )
    check('允许 network.publicHttps')
    check('允许此次更新继承')
    await nextTick()
    check('允许公开网络处理')
    await nextTick()
    submit()
    expect(props.onInstall).toHaveBeenLastCalledWith(['network.publicHttps'], true, true)
    props.preview = { ...props.preview, token: 'second-preview' }
    await nextTick()
    submit()
    expect(props.onInstall).toHaveBeenLastCalledWith([], false, false)
    expect(view.root.textContent).not.toContain('允许公开网络处理')
    view.unmount()
  })
  it('offers standard file and HTTPS interface imports and forwards an address only on submit', async () => {
    const onPreviewUrl = vi.fn()
    const mounted = mountCatalogComponent(PluginPackagePreview, {
      busy: false,
      remoteSupported: true,
      onPreviewUrl,
    })
    expect(mounted.root.textContent).toContain('文件导入（.amplugin）')
    expect(mounted.root.textContent).toContain('接口导入')
    expect(mounted.root.textContent).toContain('导入规范')
    const file = findCatalogElement(mounted.root, (node) => node.props.type === 'file')
    expect(file.props.accept).toBe('.amplugin')
    const address = findCatalogElement(mounted.root, (node) => node.props.type === 'url')
    address.value = ' https://example.com/catalog.amplugin '
    dispatchCatalogEvent(address, 'onInput')
    await nextTick()
    expect(onPreviewUrl).not.toHaveBeenCalled()
    const form = findCatalogElement(mounted.root, (node) => node.tag === 'form')
    expect(
      findCatalogElement(form, (node) => node.tag === 'button' && node.props.type === 'submit')
        .textContent,
    ).toContain('下载并预览')
    dispatchCatalogEvent(form, 'onSubmit')
    expect(onPreviewUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/catalog.amplugin')
    await nextTick()
    dispatchCatalogEvent(form, 'onSubmit')
    expect(onPreviewUrl).toHaveBeenCalledOnce()
    mounted.unmount()
  })
  it('shows unverified identity and permission differences as text, without an activation action', () => {
    const onSelectFile = vi.fn(),
      onClear = vi.fn()
    const mounted = mountCatalogComponent(PluginPackagePreview, {
      busy: false,
      onSelectFile,
      onClear,
      preview: {
        token: 'native-preview',
        pluginId: 'org.example.plugin',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
        publisher: null,
        publisherVerified: false,
        execution: 'sandbox-code',
        permissions: ['network.publicHttps'],
        addedPermissions: ['network.publicHttps'],
        historicalLevel: 'L2',
        canInstall: false,
        blockedReason: '当前生产 Profile 未准入。',
      },
    })
    expect(mounted.root.textContent).toContain('发布者身份未验证')
    expect(mounted.root.textContent).toContain('数据外发授权')
    expect(mounted.root.textContent).toContain('当前生产 Profile 未准入')
    expect(() =>
      findCatalogElement(
        mounted.root,
        (node) => node.tag === 'button' && node.textContent.trim() === '确认安装与授权',
      ),
    ).toThrow()
    const input = findCatalogElement(mounted.root, (n) => n.tag === 'input')
    const file = new File(['untrusted'], 'test.amplugin')
    Object.assign(input, { files: [file], value: 'test.amplugin' })
    dispatchCatalogEvent(input, 'onChange')
    expect(onSelectFile).toHaveBeenCalledExactlyOnceWith(file)
    dispatchCatalogEvent(
      findCatalogElement(mounted.root, (n) => n.tag === 'button'),
      'onClick',
    )
    expect(onClear).toHaveBeenCalledOnce()
    mounted.unmount()
  })
})
