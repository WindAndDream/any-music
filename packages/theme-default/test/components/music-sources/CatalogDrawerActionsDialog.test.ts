import type { CatalogDrawerView } from '@any-music/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import CatalogDrawerActionsDialog from '../../../src/components/music-sources/CatalogDrawerActionsDialog.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// 焦点圈由已有 AppDialog 负责；这里只替换模态宿主，验证真实编译后的列表操作交互。
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('section', slots.default?.()) : null,
    }),
  }
})

const drawer: CatalogDrawerView = {
  id: 'drawer:1',
  pluginId: 'test',
  pluginName: '测试平台',
  kind: 'search',
  input: '华语',
  title: '华语搜索',
  isExpanded: false,
  isSourceEnabled: true,
  loadedPageCount: 1,
  tracks: [
    {
      id: 'track:1',
      title: '华语歌曲',
      artists: [],
      source: { pluginId: 'test', resourceId: '1', mediaKind: 'audio' },
    },
  ],
  hasMore: false,
  isLoading: false,
  status: 'ready',
  errorMessage: '',
  invalidReason: '',
}

afterEach(() => vi.unstubAllGlobals())

describe('CatalogDrawerActionsDialog', () => {
  it.each([
    [{ id: 'a', name: '平台用户', customName: '常用账号' }, '平台用户（常用账号）'],
    [{ id: 'a', customName: '常用账号' }, '常用账号'],
    [{ id: 'a', name: '平台用户' }, '平台用户'],
    [{ id: 'a', name: ' 平台用户 ', customName: '平台用户' }, '平台用户'],
    [undefined, '未读取用户名'],
  ])('shows the actual request account as one label', (account, expected) => {
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, {
      open: true,
      drawer: { ...drawer, account },
      favoriteTrackIds: new Set(),
    })
    const details = findCatalogElement(
      mounted.root,
      (node) => node.props['aria-label'] === '列表请求账号',
    )
    expect(details.textContent).toContain(expected)
    expect(details.textContent).not.toContain('自定义命名')
    mounted.unmount()
  })

  it('keeps the original account name while reflecting its current status', async () => {
    const props = reactive({
      open: true,
      drawer: { ...drawer, account: { id: 'old', name: '原账号' }, accountStatus: '已登录' },
      favoriteTrackIds: new Set<string>(),
    })
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, props)
    const details = findCatalogElement(
      mounted.root,
      (node) => node.props['aria-label'] === '列表请求账号',
    )
    expect(details.textContent).toContain('原账号')
    expect(details.textContent).toContain('已登录')
    props.drawer.accountStatus = '已删除'
    await nextTick()
    expect(details.textContent).toContain('原账号')
    expect(details.textContent).toContain('已删除')
    mounted.unmount()
  })

  it('copies the entire current public list and loaded tracks as JSON without refreshing or closing', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const onRefresh = vi.fn()
    const onClose = vi.fn()
    const currentDrawer = {
      ...drawer,
      input: '搜索词\n包含"引号"和反斜杠\\',
      account: { id: 'account:1', name: '用户名', customName: '常用账号' },
      createdAtMs: 12345,
    }
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, {
      open: true,
      drawer: currentDrawer,
      favoriteTrackIds: new Set(),
      onRefresh,
      onClose,
    })
    const button = findCatalogElement(
      mounted.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === '复制完整信息',
    )
    expect(writeText).not.toHaveBeenCalled()
    dispatchCatalogEvent(button, 'onClick')
    dispatchCatalogEvent(button, 'onClick')
    await vi.waitFor(() => expect(mounted.root.textContent).toContain('完整信息已复制为 JSON。'))
    expect(writeText).toHaveBeenCalledOnce()
    expect(JSON.parse(writeText.mock.calls[0]![0])).toEqual(currentDrawer)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    mounted.unmount()
  })
  it.each(['search', 'import-url'] as const)(
    'copies the exact original %s input and follows a switch to the other request kind',
    async (kind) => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })
      const onRefresh = vi.fn()
      const onClose = vi.fn()
      const props = reactive({
        open: true,
        drawer: {
          ...drawer,
          kind,
          input:
            kind === 'search'
              ? '  原词\n"引号"  '
              : 'https://example.com/music/123?title=%E9%9F%B3%E4%B9%90&value=a%2Bb#part-2',
        },
        favoriteTrackIds: new Set<string>(),
        onRefresh,
        onClose,
      })
      const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, props)
      const inputLabel = () => (props.drawer.kind === 'search' ? '原始搜索词' : '导入链接')
      const copyInput = () =>
        findCatalogElement(
          mounted.root,
          (node) => node.tag === 'button' && node.props['aria-label'] === `复制${inputLabel()}`,
        )
      expect(copyInput().props.title).toBe(`复制${inputLabel()}`)
      expect(writeText).not.toHaveBeenCalled()
      dispatchCatalogEvent(copyInput(), 'onClick')
      await vi.waitFor(() => expect(mounted.root.textContent).toContain(`${inputLabel()}已复制。`))
      expect(writeText).toHaveBeenCalledExactlyOnceWith(props.drawer.input)

      props.drawer = {
        ...props.drawer,
        id: 'drawer:2',
        kind: kind === 'search' ? 'import-url' : 'search',
        input: kind === 'search' ? 'https://example.com/music/456?next=1' : '新搜索词',
      }
      await nextTick()
      expect(mounted.root.textContent).not.toContain('已复制。')
      expect(copyInput().props.title).toBe(`复制${inputLabel()}`)
      dispatchCatalogEvent(copyInput(), 'onClick')
      await vi.waitFor(() => expect(mounted.root.textContent).toContain(`${inputLabel()}已复制。`))
      expect(writeText).toHaveBeenLastCalledWith(props.drawer.input)
      expect(onRefresh).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
      mounted.unmount()
    },
  )

  it('blocks import-link copying while suspended and allows retry after clipboard failure', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const props = reactive({
      open: true,
      suspended: true,
      drawer: { ...drawer, kind: 'import-url', input: 'https://example.com/music/123' },
      favoriteTrackIds: new Set<string>(),
    })
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, props)
    const copyInput = () =>
      findCatalogElement(mounted.root, (node) => node.props['aria-label'] === '复制导入链接')
    expect(copyInput().props.disabled).toBe(true)
    dispatchCatalogEvent(copyInput(), 'onClick')
    expect(writeText).not.toHaveBeenCalled()

    props.suspended = false
    await nextTick()
    dispatchCatalogEvent(copyInput(), 'onClick')
    dispatchCatalogEvent(copyInput(), 'onClick')
    await vi.waitFor(() => expect(mounted.root.textContent).toContain('复制失败'))
    expect(writeText).toHaveBeenCalledOnce()
    expect(copyInput().props.disabled).toBe(false)
    dispatchCatalogEvent(copyInput(), 'onClick')
    await vi.waitFor(() => expect(mounted.root.textContent).toContain('导入链接已复制。'))
    expect(mounted.root.textContent).not.toContain('复制失败')
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenLastCalledWith(props.drawer.input)
    mounted.unmount()
  })
  it('shows the list account name and custom name, and clears them when the list changes', async () => {
    const props = reactive({
      open: true,
      drawer: {
        ...drawer,
        account: { id: 'account:a', name: '平台用户名', customName: '常用账号' },
      },
      favoriteTrackIds: new Set<string>(),
    })
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, props)
    expect(mounted.root.textContent).toContain('平台用户名')
    expect(mounted.root.textContent).toContain('常用账号')
    props.drawer.account = { id: 'account:b', name: '另一用户', customName: '备用账号' }
    await nextTick()
    expect(mounted.root.textContent).toContain('另一用户')
    expect(mounted.root.textContent).toContain('备用账号')
    expect(mounted.root.textContent).not.toContain('平台用户名')
    expect(mounted.root.textContent).not.toContain('常用账号')
    mounted.unmount()
  })
  it.each(['search', 'import-url'] as const)(
    'requests refresh of the original %s list and leaves confirmation to the workbench',
    (kind) => {
      const onRefresh = vi.fn()
      const onClose = vi.fn()
      const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, {
        open: true,
        drawer: { ...drawer, kind },
        favoriteTrackIds: new Set(),
        onRefresh,
        onClose,
      })
      const button = findCatalogElement(
        mounted.root,
        (node) => node.tag === 'button' && node.textContent.includes('清空当前结果'),
      )
      expect(button.props.disabled).toBe(false)
      dispatchCatalogEvent(button, 'onClick')
      expect(onRefresh).toHaveBeenCalledExactlyOnceWith(drawer.id)
      expect(onClose).not.toHaveBeenCalled()
      mounted.unmount()
    },
  )

  it.each([
    { isSourceEnabled: false },
    { status: 'disconnected' },
    { status: 'missing' },
    { status: 'paused' },
    { status: 'restoring' },
    { isLoading: true },
    { isVerifying: true },
  ] as const)('blocks refresh while unavailable or busy: %j', (state) => {
    const onRefresh = vi.fn()
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, {
      open: true,
      drawer: { ...drawer, ...state },
      favoriteTrackIds: new Set(),
      onRefresh,
    })
    const button = findCatalogElement(
      mounted.root,
      (node) => node.tag === 'button' && node.textContent.includes('清空当前结果'),
    )
    expect(button.props.disabled).toBe(true)
    dispatchCatalogEvent(button, 'onClick')
    expect(onRefresh).not.toHaveBeenCalled()
    mounted.unmount()
  })

  it.each(['search', 'import-url'] as const)(
    'shows complete %s card information and follows the current drawer without triggering actions',
    async (kind) => {
      const createdAtMs = new Date(2026, 8, 30, 23, 45).getTime()
      const originalInput =
        kind === 'search'
          ? '完整搜索词，包含卡片单行放不下的内容\n以及第二行'
          : `https://example.com/music/${'very-long-resource-'.repeat(20)}?page=1`
      const fullTitle = '重命名后的列表名称'.repeat(8)
      const fullPluginName = '完整的音乐来源名称'.repeat(6)
      const onFavoriteAll = vi.fn()
      const onRename = vi.fn()
      const onTogglePinned = vi.fn()
      const props = reactive({
        open: true,
        drawer: {
          ...drawer,
          kind,
          title: fullTitle,
          input: originalInput,
          pluginName: fullPluginName,
          createdAtMs,
          total: 120,
          hasMore: true,
          isPinned: true,
        },
        favoriteTrackIds: new Set<string>(),
        onFavoriteAll,
        onRename,
        onTogglePinned,
      })
      const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, props)
      const value = (label: string) => {
        const item = findCatalogElement(mounted.root, (node) =>
          node.children.some((child) => child.tag === 'dt' && child.textContent === label),
        )
        const detail = findCatalogElement(item, (node) => node.tag === 'dd')
        return (
          detail.children
            .filter((node) => node.tag !== '#comment')
            .map((node) => node.textContent)
            .join('')
            .trim() || detail.text.trim()
        )
      }
      expect(value('列表名称')).toBe(fullTitle)
      expect(value('音乐源')).toBe(fullPluginName)
      expect(value('请求方式')).toBe(kind === 'search' ? '搜索' : '链接导入')
      expect(value(kind === 'search' ? '原始搜索词' : '导入链接')).toBe(originalInput)
      expect(value(kind === 'search' ? '搜索时间' : '导入时间')).toBe('2026-09-30 23:45')
      expect(value('列表状态')).toBe('1 / 120 首')
      expect(value('加载概况')).toContain('1 首已加载 · 1 页内容')
      expect(value('加载概况')).toContain('还有更多')
      expect(value('置顶状态')).toBe('已置顶')
      const time = findCatalogElement(mounted.root, (node) => node.tag === 'time')
      expect(time.props.datetime).toBe(new Date(createdAtMs).toISOString())

      props.drawer = {
        ...props.drawer,
        id: 'drawer:2',
        title: '另一个列表',
        input: '新的原始请求',
        pluginName: '另一音乐源',
        isPinned: false,
        hasMore: false,
      }
      await nextTick()
      expect(value('列表名称')).toBe('另一个列表')
      expect(value('音乐源')).toBe('另一音乐源')
      expect(value(kind === 'search' ? '原始搜索词' : '导入链接')).toBe('新的原始请求')
      expect(value('加载概况')).toContain('已到末尾')
      expect(value('置顶状态')).toBe('未置顶')
      expect(mounted.root.textContent).not.toContain(fullTitle)
      expect(onFavoriteAll).not.toHaveBeenCalled()
      expect(onRename).not.toHaveBeenCalled()
      expect(onTogglePinned).not.toHaveBeenCalled()
      props.open = false
      await nextTick()
      expect(mounted.root.textContent).toBe('')
      mounted.unmount()
    },
  )

  it('keeps unknown request time and disconnected pagination explicit in the full information', () => {
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, {
      open: true,
      drawer: { ...drawer, isSourceEnabled: false, status: 'missing', hasMore: true },
      favoriteTrackIds: new Set<string>(),
    })
    expect(mounted.root.textContent).toContain('时间未知')
    expect(mounted.root.textContent).toContain('音乐源已卸载')
    expect(mounted.root.textContent).toContain('暂不加载新歌曲')
    expect(mounted.root.textContent).not.toContain('还有更多')
    expect(mounted.root.textContent).not.toContain('已到末尾')
    mounted.unmount()
  })

  it('keeps favorite confirmation separate and closes when handing off reversible pin actions', async () => {
    const events: string[] = []
    const onTogglePinned = vi.fn(() => events.push('pin'))
    const onFavoriteAll = vi.fn(() => events.push('favorite'))
    const props = reactive({
      open: true,
      drawer,
      favoriteTrackIds: new Set<string>(),
      onClose: () => events.push('close'),
      onTogglePinned,
      onFavoriteAll,
    })
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, props)
    const button = (text: string) =>
      findCatalogElement(
        mounted.root,
        (node) => node.tag === 'button' && node.textContent.includes(text),
      )
    dispatchCatalogEvent(button('全部喜欢'), 'onClick')
    expect(onFavoriteAll).toHaveBeenCalledExactlyOnceWith(drawer.id)
    expect(events).toEqual(['favorite'])
    dispatchCatalogEvent(button('置顶'), 'onClick')
    expect(onTogglePinned).toHaveBeenCalledExactlyOnceWith(drawer.id)
    expect(events.slice(-2)).toEqual(['close', 'pin'])
    props.drawer = { ...drawer, isPinned: true }
    props.favoriteTrackIds = new Set(['track:1'])
    await nextTick()
    expect(mounted.root.textContent).toContain('取消置顶')
    expect(button('已全部喜欢').props.disabled).toBe(true)
    // 即使程序派发事件，已全部喜欢的列表也不能再次发出写入请求。
    dispatchCatalogEvent(button('已全部喜欢'), 'onClick')
    expect(onFavoriteAll).toHaveBeenCalledTimes(1)
    mounted.unmount()
  })

  it.each(['search', 'import-url'] as const)(
    'slides into the %s name editor, preserves the original input and returns after saving',
    async (kind) => {
      const onRename = vi.fn()
      const onClose = vi.fn()
      const inputText =
        kind === 'search' ? '完整搜索词\n第二行' : 'https://example.com/list?id=1&key=a%2Bb'
      const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, {
        open: true,
        drawer: { ...drawer, kind, input: inputText },
        favoriteTrackIds: new Set(),
        onRename,
        onClose,
      })
      const button = (text: string) =>
        findCatalogElement(
          mounted.root,
          (node) => node.tag === 'button' && node.textContent.includes(text),
        )
      dispatchCatalogEvent(button('重命名'), 'onClick')
      await nextTick()
      const input = () => findCatalogElement(mounted.root, (node) => node.tag === 'input')
      expect(input().value).toBe(drawer.title)
      expect(button('保存名称').props.disabled).toBe(true)
      expect(mounted.root.textContent).toContain('自定义名称')
      expect(mounted.root.textContent).toContain(kind === 'search' ? '搜索原名' : '导入来源')
      expect(mounted.root.textContent).toContain(inputText)
      expect(mounted.root.textContent).not.toContain('来源原名')
      expect(
        findCatalogElement(mounted.root, (node) => node.props['data-dialog-page'] === 'name'),
      ).toBeDefined()
      // v-model 的宿主读写契约与原生 input 一致。
      Object.assign(input(), { value: '   ' })
      // 编译后的原生 input 监听器负责从 event.target.value 读取草稿。
      dispatchCatalogEvent(input(), 'onInput')
      await nextTick()
      expect(button('保存名称').props.disabled).toBe(true)
      dispatchCatalogEvent(
        findCatalogElement(mounted.root, (node) => node.tag === 'form'),
        'onSubmit',
      )
      expect(onRename).not.toHaveBeenCalled()
      input().value = '名'.repeat(81)
      dispatchCatalogEvent(input(), 'onInput')
      await nextTick()
      expect(input().props['aria-invalid']).toBe(true)
      dispatchCatalogEvent(
        findCatalogElement(mounted.root, (node) => node.tag === 'form'),
        'onSubmit',
      )
      expect(onRename).not.toHaveBeenCalled()
      dispatchCatalogEvent(button('返回'), 'onClick')
      await nextTick()
      expect(mounted.root.textContent).toContain('重命名')
      expect(onClose).not.toHaveBeenCalled()
      dispatchCatalogEvent(button('重命名'), 'onClick')
      await nextTick()
      expect(input().value).toBe(drawer.title)
      Object.assign(input(), { value: '  我的华语  ' })
      dispatchCatalogEvent(input(), 'onInput')
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(mounted.root, (node) => node.tag === 'form'),
        'onSubmit',
      )
      expect(onRename).toHaveBeenCalledExactlyOnceWith(drawer.id, '我的华语')
      await nextTick()
      expect(mounted.root.textContent).toContain('重命名')
      expect(onClose).not.toHaveBeenCalled()
      mounted.unmount()
    },
  )

  it('rejects suspended edits and discards the draft when the target changes or the dialog closes', async () => {
    const onRename = vi.fn()
    const props = reactive({
      open: true,
      suspended: false,
      drawer: { ...drawer },
      favoriteTrackIds: new Set<string>(),
      onRename,
    })
    const mounted = mountCatalogComponent(CatalogDrawerActionsDialog, props)
    const rename = () =>
      findCatalogElement(mounted.root, (node) => 'data-catalog-rename' in node.props)
    const input = () =>
      findCatalogElement(mounted.root, (node) => node.props.name === 'catalog-title')
    const edit = async () => {
      dispatchCatalogEvent(rename(), 'onClick')
      await nextTick()
      input().value = '未保存名称'
      dispatchCatalogEvent(input(), 'onInput')
      await nextTick()
    }
    await edit()
    props.suspended = true
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(mounted.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    expect(onRename).not.toHaveBeenCalled()
    props.suspended = false
    props.drawer = { ...drawer, id: 'other', title: '另一列表' }
    await nextTick()
    expect(rename).not.toThrow()
    dispatchCatalogEvent(rename(), 'onClick')
    await nextTick()
    expect(input().value).toBe('另一列表')
    input().value = '丢弃草稿'
    dispatchCatalogEvent(input(), 'onInput')
    props.open = false
    await nextTick()
    props.open = true
    await nextTick()
    dispatchCatalogEvent(rename(), 'onClick')
    await nextTick()
    expect(input().value).toBe('另一列表')
    expect(onRename).not.toHaveBeenCalled()
    mounted.unmount()
  })
})
