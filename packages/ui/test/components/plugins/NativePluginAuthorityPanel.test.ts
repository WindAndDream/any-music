import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import NativePluginAuthorityPanel from '../../../src/components/plugins/NativePluginAuthorityPanel.vue'
import type { NativePluginSnapshot } from '../../../src/product/native-plugin-authority'
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

function button(root: CatalogTestElement, label: string) {
  return findCatalogElement(
    root,
    (node) => node.tag === 'button' && node.textContent.trim() === label,
  )
}

const install: NativePluginSnapshot = {
  installId: 'install-1',
  pluginId: 'org.example.source',
  contentHash: 'a'.repeat(64),
  publisher: 'publisher',
  generation: 1,
  dataGeneration: 1,
  permissionEpoch: 1,
  enabled: true,
  historicalLevel: 'L2',
  commands: [{ id: 'query', title: { en: 'Query', 'zh-CN': '查询音乐源' } }],
  contributions: ['music.sources'],
  canRollback: true,
}

describe('NativePluginAuthorityPanel', () => {
  it('forwards native import, DEV, refresh and diagnostic actions without running them on mount', () => {
    const props = {
      installs: [],
      busy: false,
      previewSupported: true,
      nativePickerSupported: true,
      devSupported: true,
      devPairingPath: 'private/pairing.json',
      onChooseNative: vi.fn(),
      onBeginDev: vi.fn(),
      onEndDev: vi.fn(),
      onRefresh: vi.fn(),
      onRefreshDiagnostics: vi.fn(),
      onExportDiagnostics: vi.fn(),
    }
    const view = mountCatalogComponent(NativePluginAuthorityPanel, props)
    expect(view.root.textContent).toContain('暂无原生插件安装记录。')
    for (const [label, callback] of [
      ['从系统选择插件包', props.onChooseNative],
      ['选择 DEV 项目并配对', props.onBeginDev],
      ['结束 DEV 配对', props.onEndDev],
      ['刷新授权状态', props.onRefresh],
      ['查看脱敏诊断', props.onRefreshDiagnostics],
      ['选择位置导出脱敏诊断', props.onExportDiagnostics],
    ] as const) {
      expect(callback).not.toHaveBeenCalled()
      dispatchCatalogEvent(button(view.root, label), 'onClick')
      expect(callback).toHaveBeenCalledOnce()
    }
    view.unmount()
  })

  it('preserves bounded command input and disables unavailable installation actions', async () => {
    const props = reactive({
      installs: [install],
      busy: false,
      tracks: Array.from({ length: 25 }, (_, index) => ({
        id: `track-${index}`,
        title: `歌曲 ${index}`,
      })),
      onExecute: vi.fn(),
      onRollback: vi.fn(),
      onRevoke: vi.fn(),
    })
    const view = mountCatalogComponent(NativePluginAuthorityPanel, props)
    const query = findCatalogElement(view.root, (node) => node.props.type === 'search')
    query.value = '本次查询'
    dispatchCatalogEvent(query, 'onInput')
    const tracks = findCatalogElement(
      view.root,
      (node) => node.props.class === 'native-plugin-installs__tracks',
    )
    expect(tracks.children.filter((node) => node.tag === 'label')).toHaveLength(20)
    const checkbox = findCatalogElement(tracks, (node) => node.props.type === 'checkbox')
    Object.assign(checkbox, { checked: true })
    dispatchCatalogEvent(checkbox, 'onChange')
    await nextTick()
    dispatchCatalogEvent(button(view.root, '查询音乐源'), 'onClick')
    expect(props.onExecute).toHaveBeenCalledExactlyOnceWith('install-1', 'query', {
      query: '本次查询',
      items: [{ id: 'track-0', title: '歌曲 0' }],
    })
    dispatchCatalogEvent(button(view.root, '回退代码与数据并撤权'), 'onClick')
    expect(props.onRollback).toHaveBeenCalledExactlyOnceWith('install-1')
    dispatchCatalogEvent(button(view.root, '撤销授权'), 'onClick')
    expect(props.onRevoke).toHaveBeenCalledExactlyOnceWith('install-1')
    props.busy = true
    await nextTick()
    for (const label of ['查询音乐源', '回退代码与数据并撤权', '撤销授权']) {
      expect(button(view.root, label).props.disabled).toBe(true)
    }
    props.busy = false
    props.installs = [{ ...install, enabled: false }]
    await nextTick()
    expect(button(view.root, '查询音乐源').props.disabled).toBe(true)
    expect(button(view.root, '撤销授权').props.disabled).toBe(true)
    view.unmount()
  })

  it('keeps result saving separate from presentation and displays native errors', () => {
    const onSaveResult = vi.fn()
    const view = mountCatalogComponent(NativePluginAuthorityPanel, {
      installs: [],
      busy: false,
      result: { token: 'result', value: { text: '查询结果' } },
      errorMessage: '原生操作失败',
      onSaveResult,
    })
    expect(findCatalogElement(view.root, (node) => node.props.role === 'alert').textContent).toBe(
      '原生操作失败',
    )
    dispatchCatalogEvent(button(view.root, '选择位置保存此结果'), 'onClick')
    expect(onSaveResult).toHaveBeenCalledOnce()
    view.unmount()
  })
})
