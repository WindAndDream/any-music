import type { MusicSourcePlugin } from '@any-music/core'
import type { ResourceCacheSettingsContext } from '@any-music/ui'
import { provideSettingsFeedback } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'

import GlobalSettingsPanel from '../../../src/components/settings/GlobalSettingsPanel.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'
import type { CatalogTestElement } from '../../helpers/test-renderer'

// Node 渲染宿主验证真实分类切换与原生表单事件；不启动产品界面或请求平台接口。
beforeEach(() => vi.stubGlobal('document', { activeElement: null }))
afterEach(() => vi.unstubAllGlobals())

function createPlugin(id: string, provenance: 'built-in' | 'external'): MusicSourcePlugin {
  return {
    descriptor: {
      id,
      name: id,
      provenance,
      capabilities: { search: true, importUrl: false, session: false },
      importUrlScopes: [],
    },
    checkAvailability: vi.fn(),
    validateImportUrl: vi.fn(),
    getSession: vi.fn(),
    getLoginUrl: vi.fn(),
    search: vi.fn(),
    importFromUrl: vi.fn(),
    resolveMedia: vi.fn(),
  }
}

function mountSettings(isMobileLayout = true, desktopAccounts = false, withCache = false) {
  const builtIn = createPlugin('内置来源', 'built-in')
  const external = createPlugin('外部来源', 'external')
  const props = reactive({
    plugins: [builtIn, external],
    availabilityByPluginId: {},
    enabledPluginIds: ['内置来源'],
    externalSourcesEnabled: true,
    profile: { id: 'creator:stable', displayName: '我的创作' },
    historyLimit: 100,
    downloadConcurrency: 2,
    isMobileLayout,
    displayDefaults: {},
    setDisplayDefault: vi.fn(),
    accountSummary: '已启用 3 个账号',
    networkTitle: desktopAccounts ? '代理管理' : undefined,
    networkSummary: desktopAccounts ? '已配置 2 个代理' : undefined,
    onSetDownloadConcurrency: vi.fn(),
    onSetHistoryLimit: vi.fn(),
    onUpdateLocalUserDisplayName: vi.fn(),
    onSetPluginEnabled: vi.fn(),
    onCheckPlugin: vi.fn(),
  })
  let feedback!: ReturnType<typeof provideSettingsFeedback>
  const consumer = defineComponent({
    setup: () => () =>
      h(GlobalSettingsPanel, props, {
        'appearance-settings': () => h('button', '主题选择'),
        'navigation-settings': () => h('button', '导航排序'),
        'network-settings': () => h('button', '代理配置'),
        'external-source-settings': () => h('button', '外置导入表单'),
        ...(desktopAccounts ? { 'account-settings': () => h('button', '桌面账号配置') } : {}),
        ...(desktopAccounts ? { 'download-settings': () => h('button', '选择下载目录') } : {}),
        ...(withCache
          ? {
              'cache-settings': ({ placement }: ResourceCacheSettingsContext) =>
                h('button', placement === 'header' ? '缓存介绍' : '缓存配置'),
            }
          : {}),
      }),
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        feedback = provideSettingsFeedback()
        return () => h(consumer)
      },
    }),
    {},
  )
  return { ...view, props, builtIn, external, feedback }
}

function findEntry(root: CatalogTestElement, title: string) {
  return findCatalogElement(
    root,
    (node) => node.tag === 'button' && node.textContent.includes(title),
  )
}

describe('GlobalSettingsPanel', () => {
  it.each([true, false])(
    'opens the default display settings with collapsed feature groups (mobile=%s)',
    async (mobile) => {
      const view = mountSettings(mobile)
      dispatchCatalogEvent(findEntry(view.root, '展示方式'), 'onClick')
      await nextTick()
      expect(view.root.textContent).toContain('默认风格与排列方式')
      const displaySettings = findCatalogElement(
        view.root,
        (node) => node.props.class === 'display-settings',
      )
      const discover = findCatalogElement(
        displaySettings,
        (node) => node.tag === 'button' && node.textContent.includes('发现'),
      )
      expect(discover.props['aria-expanded']).toBe(false)
      dispatchCatalogEvent(discover, 'onClick')
      await nextTick()
      expect(discover.props['aria-expanded']).toBe(true)
      const queue = findCatalogElement(
        displaySettings,
        (node) =>
          node.tag === 'button' &&
          node.textContent.includes('待听') &&
          'aria-expanded' in node.props,
      )
      dispatchCatalogEvent(queue, 'onClick')
      await nextTick()
      expect(discover.props['aria-expanded']).toBe(false)
      expect(queue.props['aria-expanded']).toBe(true)
      expect(view.props.setDisplayDefault).not.toHaveBeenCalled()
      const tags = findCatalogElement(
        displaySettings,
        (node) => node.tag === 'button' && node.textContent.includes('标签管理'),
      )
      dispatchCatalogEvent(tags, 'onClick')
      await nextTick()
      expect(tags.textContent).toContain('2 个区域')
      const associatedTracks = findCatalogElement(
        displaySettings,
        (node) => node.props['data-am-focus-key'] === 'settings:display:tags:associated-tracks',
      )
      expect(associatedTracks.textContent).toContain('关联音乐')
      view.unmount()
    },
  )
  it.each([true, false])(
    'exposes cache settings only when the runtime supplies the port (mobile=%s)',
    async (mobile) => {
      const absent = mountSettings(mobile)
      expect(() => findEntry(absent.root, '资源缓存')).toThrow()
      absent.unmount()
      const present = mountSettings(mobile, false, true)
      dispatchCatalogEvent(findEntry(present.root, '资源缓存'), 'onClick')
      await nextTick()
      expect(present.root.textContent).toContain('缓存配置')
      const header = findCatalogElement(present.root, (node) => node.tag === 'header')
      expect(header.textContent).toContain('缓存介绍')
      expect(header.textContent).not.toContain('缓存配置')
      present.unmount()
    },
  )
  it.each([true, false])(
    'composes native directory selection with concurrency settings (mobile=%s)',
    async (mobile) => {
      const view = mountSettings(mobile, true)
      dispatchCatalogEvent(findEntry(view.root, '歌曲下载'), 'onClick')
      await nextTick()
      expect(view.root.textContent).toContain('选择下载目录')
      expect(view.root.textContent).toContain('最高下载并发')
      view.unmount()
      const userscript = mountSettings(mobile)
      dispatchCatalogEvent(findEntry(userscript.root, '歌曲下载'), 'onClick')
      await nextTick()
      expect(userscript.root.textContent).not.toContain('选择下载目录')
      expect(userscript.root.textContent).toContain('最高下载并发')
      userscript.unmount()
    },
  )
  it.each([true, false])(
    'withdraws external settings and visited content when disabled (mobile=%s)',
    async (mobile) => {
      const view = mountSettings(mobile)
      const externalEntry = () =>
        findCatalogElement(
          view.root,
          (node) => node.props['data-settings-entry'] === 'external-sources',
        )
      dispatchCatalogEvent(externalEntry(), 'onClick')
      await nextTick()
      expect(view.root.textContent).toContain('外置导入表单')
      view.props.externalSourcesEnabled = false
      await nextTick()
      expect(externalEntry).toThrow()
      expect(view.root.textContent).not.toContain('外置导入表单')
      dispatchCatalogEvent(findEntry(view.root, '音乐源管理'), 'onClick')
      await nextTick()
      expect(view.root.textContent).not.toContain('外置音乐源')
      expect(view.root.textContent).not.toContain('外部来源')
      view.props.externalSourcesEnabled = true
      await nextTick()
      dispatchCatalogEvent(findEntry(view.root, '音乐源管理'), 'onClick')
      await nextTick()
      expect(view.root.textContent).toContain('外置音乐源')
      expect(view.root.textContent).not.toContain('外部导入插件')
      dispatchCatalogEvent(externalEntry(), 'onClick')
      await nextTick()
      expect(view.root.textContent).toContain('外置导入表单')
      view.unmount()
    },
  )
  it('embeds native accounts and multiple proxies into the existing settings navigation', async () => {
    const view = mountSettings(false, true)
    expect(view.root.textContent).toContain('已启用 3 个账号')
    expect(view.root.textContent).toContain('已配置 2 个代理')
    dispatchCatalogEvent(findEntry(view.root, '账号管理'), 'onClick')
    await nextTick()
    expect(view.root.textContent).toContain('桌面账号配置')
    dispatchCatalogEvent(findEntry(view.root, '代理管理'), 'onClick')
    await nextTick()
    expect(view.root.textContent).toContain('代理配置')
    view.unmount()
    const userscript = mountSettings(false)
    expect(userscript.root.textContent).not.toContain('账号管理')
    expect(userscript.root.textContent).toContain('请求代理')
    userscript.unmount()
  })
  it.each([
    ['歌曲下载', '', '下载并发'],
    ['歌曲下载', '1.5', '下载并发'],
    ['播放历史', '0', '历史记录数量'],
    ['创作者资料', '   ', '创作者名称'],
  ])(
    'pops up validation feedback for %s with invalid input %j',
    async (section, value, message) => {
      const view = mountSettings()
      dispatchCatalogEvent(findEntry(view.root, section), 'onClick')
      await nextTick()
      const input = findCatalogElement(view.root, (node) => node.tag === 'input')
      input.value = value
      dispatchCatalogEvent(input, 'onInput')
      await nextTick()
      const form = findCatalogElement(view.root, (node) => node.tag === 'form')
      expect(form.props.novalidate).toBeDefined()
      dispatchCatalogEvent(form, 'onSubmit')
      await nextTick()
      expect(view.feedback.notice.value?.tone).toBe('error')
      expect(view.feedback.notice.value?.message).toContain(message)
      expect(findCatalogElement(form, (node) => node.props.role === 'alert').textContent).toContain(
        message,
      )
      expect(input.props['aria-invalid']).toBe(true)
      expect(view.props.onSetDownloadConcurrency).not.toHaveBeenCalled()
      expect(view.props.onSetHistoryLimit).not.toHaveBeenCalled()
      expect(view.props.onUpdateLocalUserDisplayName).not.toHaveBeenCalled()
      view.unmount()
    },
  )

  it('opens grouped mobile settings, removes the overview from interaction, and preserves a draft on return', async () => {
    const view = mountSettings()
    for (const title of ['外观与导航', '音乐源', '网络与下载', '记录与创作'])
      expect(view.root.textContent).toContain(title)
    expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
    dispatchCatalogEvent(findEntry(view.root, '歌曲下载'), 'onClick')
    await nextTick()
    const overview = findCatalogElement(view.root, (node) => node.tag === 'nav')
    expect(overview.props.inert).toBe(true)
    expect(overview.props['aria-hidden']).toBe('true')
    const heading = findCatalogElement(view.root, (node) => 'data-settings-heading' in node.props)
    expect(heading.isFocused).toBe(true)
    const input = findCatalogElement(view.root, (node) => node.tag === 'input')
    input.value = '4'
    dispatchCatalogEvent(input, 'onInput')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '返回设置'),
      'onClick',
    )
    await nextTick()
    expect(overview.props.inert).toBeUndefined()
    expect(findEntry(view.root, '歌曲下载').isFocused).toBe(true)
    dispatchCatalogEvent(findEntry(view.root, '歌曲下载'), 'onClick')
    await nextTick()
    expect(findCatalogElement(view.root, (node) => node.tag === 'input')).toBe(input)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    expect(view.props.onSetDownloadConcurrency).toHaveBeenCalledExactlyOnceWith(4)
    view.unmount()
  })

  it('keeps desktop categories visible and forwards source actions without contacting platforms', async () => {
    const view = mountSettings(false)
    expect(view.root.textContent).toContain('主题选择')
    expect(findCatalogElement(view.root, (node) => node.tag === 'nav').props.inert).toBeUndefined()
    expect(() =>
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '返回设置'),
    ).toThrow()
    dispatchCatalogEvent(findEntry(view.root, '音乐源管理'), 'onClick')
    await nextTick()
    expect(view.root.textContent).not.toContain('管理内置音乐源和导入插件。')
    expect(
      view.root.textContent.match(/至少保留一个音乐源。关闭音乐源不会删除已有歌曲和列表。/g),
    ).toHaveLength(1)
    const enabledSwitch = findCatalogElement(
      view.root,
      (node) => node.props['aria-label'] === '启用内置来源',
    )
    expect(enabledSwitch.props.disabled).toBe(true)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '启用外部来源'),
      'onClick',
    )
    expect(view.props.onSetPluginEnabled).toHaveBeenCalledExactlyOnceWith('外部来源', true)
    dispatchCatalogEvent(findEntry(view.root, '检测'), 'onClick')
    expect(view.props.onCheckPlugin).toHaveBeenCalledExactlyOnceWith('外部来源')
    expect(view.builtIn.checkAvailability).not.toHaveBeenCalled()
    expect(view.external.checkAvailability).not.toHaveBeenCalled()
    dispatchCatalogEvent(findEntry(view.root, '请求代理'), 'onClick')
    await nextTick()
    expect(view.root.textContent).toContain('代理配置')
    view.unmount()
  })

  it('preserves existing history and creator save contracts after navigating between pages', async () => {
    const view = mountSettings()
    dispatchCatalogEvent(findEntry(view.root, '播放历史'), 'onClick')
    await nextTick()
    const historyInput = findCatalogElement(view.root, (node) => node.tag === 'input')
    historyInput.value = '80'
    dispatchCatalogEvent(historyInput, 'onInput')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    expect(view.props.onSetHistoryLimit).toHaveBeenCalledExactlyOnceWith(80)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '返回设置'),
      'onClick',
    )
    await nextTick()
    dispatchCatalogEvent(findEntry(view.root, '创作者资料'), 'onClick')
    await nextTick()
    const nameInput = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.autocomplete === 'nickname',
    )
    nameInput.value = '新名称'
    dispatchCatalogEvent(nameInput, 'onInput')
    await nextTick()
    const profileForm = findCatalogElement(
      view.root,
      (node) => node.tag === 'form' && node.textContent.includes('稳定用户 ID'),
    )
    dispatchCatalogEvent(profileForm, 'onSubmit')
    expect(view.props.onUpdateLocalUserDisplayName).toHaveBeenCalledExactlyOnceWith('新名称')
    const stableId = findCatalogElement(
      profileForm,
      (node) => node.tag === 'input' && node.props.readonly !== undefined,
    )
    expect(stableId.props.value).toBe('creator:stable')
    view.unmount()
  })
})
