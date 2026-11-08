/* eslint-disable no-await-in-loop -- Finish each presentation replacement before its assertions. */
import type { MusicSourceDescriptor, Track } from '@any-music/core'
import {
  cloneCatalogTrackFilterState,
  createCatalogTrackFilterState,
  createEditingSession,
  filterCatalogTracks,
  provideEditingSession,
  provideConfirmationDialog,
} from '@any-music/ui/catalog'
import type {
  CatalogDrawerView,
  CatalogRequestKind,
  CatalogTrackFilterState,
} from '@any-music/ui/catalog'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, reactive, shallowRef } from 'vue'

import ClassicCatalog from '../../../src/components/music-sources/ClassicCatalog.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// Execute real controls in Node; overlay focus/animation requires separately authorized live acceptance.
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  const transition = vue.defineComponent({
    inheritAttrs: false,
    setup(_props, { slots, attrs }) {
      let previousKey: unknown
      return () => {
        const children = slots.default?.()
        const key = children?.[0]?.key
        if (previousKey !== undefined && key !== previousKey)
          (attrs.onAfterLeave as (() => void) | undefined)?.()
        previousKey = key
        return children
      }
    },
  })
  return { ...vue, Teleport: passthrough, Transition: transition, TransitionGroup: passthrough }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open', 'title'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? renderOverlay('section', { 'aria-label': props.title }, [
                slots.default?.(),
                slots.footer?.(),
              ])
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open', 'title'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? renderOverlay('section', { 'aria-label': props.title }, [
                slots.default?.(),
                slots.footer?.(),
              ])
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? vue.h('aside', { 'aria-label': props.title }, slots.default?.()) : null,
    }),
  }
})
beforeEach(() => {
  vi.stubGlobal('Element', CatalogTestElement)
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())

const track = (id: string): Track => ({
  id,
  title: id,
  artists: [],
  source: { pluginId: 'source', mediaKind: 'audio', resourceId: id },
})
const source: MusicSourceDescriptor & { enabled: boolean } = {
  id: 'source',
  name: '来源标签',
  enabled: true,
  provenance: 'built-in',
  capabilities: { search: true, importUrl: true, session: false },
  importUrlScopes: [{ origin: 'https://example.com', pathnamePrefix: '/' }],
}
function mountPage(mobileLayout = true) {
  const initialTracks = [track('one'), track('two')]
  const drawer: CatalogDrawerView = {
    id: 'request:stable',
    pluginId: 'source',
    pluginName: '历史来源标签',
    account: { id: 'account:original', name: '原请求账号' },
    kind: 'search',
    input: 'submitted',
    title: '来源结果',
    isExpanded: true,
    isSourceEnabled: true,
    tracks: initialTracks,
    loadedPageCount: 1,
    hasMore: true,
    isLoading: false,
    status: 'ready',
    errorMessage: '',
    invalidReason: '',
  }
  const state = reactive({
    tracks: initialTracks,
    selectedTrackIds: [] as string[],
    invalidTrackIds: [] as string[],
    favoriteTrackIds: [] as string[],
    queuedTrackIds: [] as string[],
    downloadedTrackIds: [] as string[],
    platformNames: new Map([['source', '来源标签']]),
    customNamesByTrackId: new Map<string, string>(),
    customTagsByTrackId: new Map<string, readonly string[]>(),
    addedAtMsByTrackId: new Map<string, number>(),
    displayMode: 'standard' as const,
    mobileColumns: 1 as const,
    filters: createCatalogTrackFilterState(),
    filterDraft: null as CatalogTrackFilterState | null,
    sources: [source],
    sourceId: 'source',
    requestKind: 'search' as CatalogRequestKind,
    accountMissing: false,
    searchQuery: 'unfinished query',
    importUrl: 'https://example.com/draft',
    drawers: [drawer],
    activeDrawerId: drawer.id as string | null,
    playlists: [],
  })
  const actions: UiThemeFeatureMap['catalog']['actions'] = {
    play: vi.fn(),
    download: vi.fn(),
    toggleFavorite: vi.fn(),
    select: vi.fn((ids) => {
      state.selectedTrackIds = [...ids]
    }),
    setFilterDraft: vi.fn((value) => {
      state.filterDraft = value
    }),
    applyFilters: vi.fn(() => {
      state.filters = cloneCatalogTrackFilterState(state.filterDraft!)
      state.filterDraft = null
      state.tracks = [
        ...filterCatalogTracks(state.drawers[0]!.tracks, state.customTagsByTrackId, state.filters),
      ]
    }),
    cancelFilters: vi.fn(() => {
      state.filterDraft = null
    }),
    showTrackActions: vi.fn(),
    enqueue: vi.fn(),
    rename: vi.fn(),
    addToPlaylist: vi.fn(),
    useAsMaterial: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setDisplayMode: vi.fn(),
    setMobileColumns: vi.fn(),
    selectSource: vi.fn(),
    notifyMissingAccount: vi.fn(),
    setSearchQuery: vi.fn((value) => {
      state.searchQuery = value
    }),
    setImportUrl: vi.fn((value) => {
      state.importUrl = value
    }),
    setRequestKind: vi.fn((value) => {
      state.requestKind = value
    }),
    submit: vi.fn(),
    clear: vi.fn(() => {
      state.searchQuery = ''
      state.importUrl = ''
    }),
    openDrawer: vi.fn((id) => {
      state.activeDrawerId = id
    }),
    closeDrawer: vi.fn(() => {
      state.activeDrawerId = null
    }),
    favoriteDrawer: vi.fn(),
    moveDrawer: vi.fn(),
    restoreDrawerNames: vi.fn(),
    restoreTrackNames: vi.fn(),
    verify: vi.fn(),
    cancelVerification: vi.fn(),
    openSourceSettings: vi.fn(),
    toggleQueue: vi.fn(),
    requestCreatePlaylist: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    removeDrawer: vi.fn(),
    renameDrawer: vi.fn(),
    pinDrawer: vi.fn(),
  }
  const feature: UiThemeFeatureMap['catalog'] = {
    state,
    actions,
    availability: { status: 'available' },
    status: { status: 'ready' },
  }
  const editing = createEditingSession()
  const selection = shallowRef<'A' | 'B'>('A')
  const page = () =>
    h(
      ClassicCatalog,
      { feature, mobileLayout },
      {
        'source-identity': () => h('span', { 'data-source-account': true }, '当前账号'),
        'request-account': ({ drawerId }: { drawerId: string }) =>
          h('span', { 'data-request-account': drawerId }, '原请求账号'),
      },
    )
  const A = defineComponent({ setup: () => () => h('main', page()) })
  const B = defineComponent({ setup: () => () => h('article', [h('aside', '替代测试根'), page()]) })
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        provideConfirmationDialog()
        const root = computed(() => (selection.value === 'A' ? A : B))
        return () => h(root.value)
      },
    }),
    {},
  )
  return {
    ...view,
    state,
    actions,
    selection,
    dispose() {
      view.unmount()
      editing.dispose()
    },
  }
}
function click(root: CatalogTestElement, text: string) {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.tag === 'button' && node.textContent.includes(text)),
    'onClick',
  )
}

describe('classic catalog complete-root contract', () => {
  it('keeps display choices on songs while request cards use the sole default layout', async () => {
    const f = mountPage()
    const displayButton = () =>
      findCatalogElement(
        f.root,
        (node) => node.tag === 'button' && node.textContent.includes('展示方式'),
      )
    try {
      expect(displayButton()).toBeDefined()
      f.state.activeDrawerId = null
      await nextTick()
      expect(() => displayButton()).toThrow()
      expect(
        findCatalogElement(f.root, (node) => node.props.class === 'catalog-card__view').textContent,
      ).toContain('查看歌曲')
      click(f.root, '查看歌曲')
      await nextTick()
      expect(f.actions.openDrawer).toHaveBeenCalledExactlyOnceWith('request:stable')
      expect(displayButton()).toBeDefined()
    } finally {
      f.dispose()
    }
  })

  it.each([false, true])(
    'toggles pinning by stable list identity after closing its dialog (pinned: %s)',
    async (isPinned) => {
      const f = mountPage()
      try {
        f.state.activeDrawerId = null
        f.state.drawers = [{ ...f.state.drawers[0]!, isPinned }]
        await nextTick()
        const openActions = async () => {
          dispatchCatalogEvent(
            findCatalogElement(
              f.root,
              (node) => node.props['aria-label'] === '音乐列表操作 来源结果',
            ),
            'onClick',
          )
          await nextTick()
        }
        await openActions()
        click(f.root, isPinned ? '取消置顶' : '让这个列表优先显示')
        expect(f.actions.pinDrawer).toHaveBeenCalledExactlyOnceWith('request:stable', !isPinned)
        await nextTick()
        expect(() =>
          findCatalogElement(f.root, (node) => node.props['aria-label'] === '音乐列表操作'),
        ).toThrow()
        f.state.drawers = [{ ...f.state.drawers[0]!, isPinned: !isPinned }]
        await nextTick()
        await openActions()
        click(f.root, isPinned ? '让这个列表优先显示' : '取消置顶')
        expect(f.actions.pinDrawer).toHaveBeenCalledTimes(2)
        expect(f.actions.pinDrawer).toHaveBeenLastCalledWith('request:stable', isPinned)
      } finally {
        f.dispose()
      }
    },
  )

  it.each([false, true])(
    'requires the launcher for selection and clears on close (lists: %s)',
    async (lists) => {
      const f = mountPage()
      try {
        if (lists) {
          f.state.activeDrawerId = null
          await nextTick()
        }
        const checkbox = () =>
          findCatalogElement(
            f.root,
            (node) =>
              node.tag === 'input' &&
              (lists
                ? String(node.props['aria-label']).includes('音乐列表 来源结果')
                : node.props['data-am-focus-key'] === 'track:one:select'),
          )
        const operatorButton = () =>
          findCatalogElement(
            f.root,
            (node) =>
              node.tag === 'button' && String(node.props['aria-label']).startsWith('操作器 已选'),
          )
        expect(() => checkbox()).toThrow()
        expect(operatorButton().props['aria-expanded']).toBe(false)
        click(f.root, '操作器')
        await nextTick()
        dispatchCatalogEvent(checkbox(), 'onChange')
        await nextTick()
        expect(checkbox().props.checked).toBe(true)
        f.selection.value = 'B'
        await nextTick()
        expect(checkbox().props.checked).toBe(true)
        dispatchCatalogEvent(checkbox(), 'onChange')
        await nextTick()
        expect(operatorButton().props['aria-expanded']).toBe(true)
        dispatchCatalogEvent(checkbox(), 'onChange')
        await nextTick()
        click(f.root, '操作器')
        await nextTick()
        expect(() => checkbox()).toThrow()
        expect(operatorButton().props['aria-expanded']).toBe(false)
        click(f.root, '操作器')
        await nextTick()
        expect(checkbox().props.checked).toBe(false)
      } finally {
        f.dispose()
      }
    },
  )

  it('delegates loaded favorites to one host batch from both catalog entry points', async () => {
    const f = mountPage()
    click(f.root, '喜欢已加载')
    expect(f.actions.favoriteDrawer).toHaveBeenCalledExactlyOnceWith('request:stable')
    expect(f.actions.toggleFavorite).not.toHaveBeenCalled()
    f.state.activeDrawerId = null
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(f.root, (node) => node.props['aria-label'] === '音乐列表操作 来源结果'),
      'onClick',
    )
    await nextTick()
    click(f.root, '全部喜欢')
    expect(f.actions.favoriteDrawer).toHaveBeenCalledTimes(2)
    expect(f.actions.favoriteDrawer).toHaveBeenLastCalledWith('request:stable')
    expect(f.actions.toggleFavorite).not.toHaveBeenCalled()
    f.dispose()
  })

  it.each([false, true])(
    'keeps the discovery title on desktop and the account in the mobile heading (mobile: %s)',
    async (mobileLayout) => {
      const f = mountPage(mobileLayout)
      f.state.activeDrawerId = null
      await nextTick()
      const heading = findCatalogElement(
        f.root,
        (node) => node.props.class === 'catalog-drawers__heading',
      )
      expect(heading.textContent.replace(/\s+/g, ' ').trim()).toBe(
        mobileLayout ? '当前账号' : '发现 1 个',
      )
      expect(f.actions.submit).not.toHaveBeenCalled()
      expect(f.actions.loadMore).not.toHaveBeenCalled()
      f.dispose()
    },
  )

  it('retains cross-page selection and an unfinished filter across A → B → A without requests or media actions', async () => {
    const f = mountPage()
    click(f.root, '操作器')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        f.root,
        (node) => node.tag === 'input' && node.props['aria-label'] === '选择歌曲 one',
      ),
      'onChange',
    )
    click(f.root, '筛选器')
    await nextTick()
    click(f.root, '搜索筛选')
    await nextTick()
    const input = findCatalogElement(
      f.root,
      (node) => node.tag === 'input' && node.props.type === 'search',
    )
    input.value = 'two'
    input.dispatchListeners('input', { target: input })
    await nextTick()
    f.state.drawers[0]!.isLoading = true
    for (const root of ['B', 'A'] as const) {
      f.selection.value = root
      await nextTick()
      expect(
        findCatalogElement(f.root, (node) => node.tag === 'input' && node.props.type === 'search')
          .value,
      ).toBe('two')
      expect(f.state.selectedTrackIds).toEqual(['one'])
      expect(f.state.searchQuery).toBe('unfinished query')
      expect(f.root.textContent).toContain('历史来源标签')
      expect(f.root.textContent).toContain('原请求账号')
    }
    expect(f.actions.submit).not.toHaveBeenCalled()
    expect(f.actions.loadMore).not.toHaveBeenCalled()
    expect(f.actions.play).not.toHaveBeenCalled()
    expect(f.actions.applyFilters).not.toHaveBeenCalled()
    click(f.root, '确定')
    await nextTick()
    click(f.root, '应用筛选')
    await nextTick()
    expect(f.state.tracks.map(({ id }) => id)).toEqual(['two'])
    expect(f.actions.applyFilters).toHaveBeenCalledTimes(1)
    expect(f.state.selectedTrackIds).toEqual(['one'])
    f.dispose()
  })

  it('collapses and expands track context through the controlled heading handle', async () => {
    const f = mountPage(false)
    const handle = findCatalogElement(f.root, (node) => node.props['aria-label'] === '收起列表信息')
    dispatchCatalogEvent(handle, 'onClick')
    await nextTick()
    expect(handle.props['aria-expanded']).toBe(false)
    expect(handle.props['aria-label']).toBe('展开列表信息')
    dispatchCatalogEvent(handle, 'onClick')
    await nextTick()
    expect(handle.props['aria-expanded']).toBe(true)
    f.dispose()
  })

  it('shows missing-account feedback without opening discovery', async () => {
    const f = mountPage()
    f.state.activeDrawerId = null
    f.state.accountMissing = true
    await nextTick()
    click(f.root, '发现')
    await nextTick()
    expect(f.actions.notifyMissingAccount).toHaveBeenCalledOnce()
    expect(f.root.textContent).not.toContain('搜索音乐')
    expect(f.actions.submit).not.toHaveBeenCalled()
    f.dispose()
  })

  it('submits only explicit search/import and preserves import mode after replacement without extra controls', async () => {
    const f = mountPage()
    expect(f.root.textContent).not.toContain('固定')
    expect(f.root.textContent).not.toContain('发现')
    f.state.activeDrawerId = null
    await nextTick()
    click(f.root, '发现')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(f.root, (node) => node.props.id === 'am-source-search-panel'),
      'onSubmit',
    )
    expect(f.actions.submit).toHaveBeenCalledTimes(1)
    expect(f.actions.setRequestKind).toHaveBeenLastCalledWith('search')
    await nextTick()
    click(f.root, '发现')
    await nextTick()
    click(f.root, '导入链接')
    f.selection.value = 'B'
    await nextTick()
    expect(
      findCatalogElement(f.root, (node) => node.props.id === 'am-source-import-tab').props[
        'aria-selected'
      ],
    ).toBe(true)
    dispatchCatalogEvent(
      findCatalogElement(f.root, (node) => node.props.id === 'am-source-import-panel'),
      'onSubmit',
    )
    expect(f.actions.submit).toHaveBeenCalledTimes(2)
    expect(f.actions.setRequestKind).toHaveBeenLastCalledWith('import-url')
    await nextTick()
    click(f.root, '发现')
    await nextTick()
    expect(f.root.textContent).not.toContain('清空输入')
    expect(f.state.searchQuery).toBe('unfinished query')
    expect(f.state.importUrl).toBe('https://example.com/draft')
    expect(f.actions.clear).not.toHaveBeenCalled()
    expect(f.actions.submit).toHaveBeenCalledTimes(2)
    f.dispose()
  })

  it('routes page cancellation/retry by stable request ID and disables invalid song actions', async () => {
    const f = mountPage()
    f.state.drawers[0]!.isLoading = true
    f.state.invalidTrackIds = ['one']
    await nextTick()
    click(f.root, '取消加载')
    expect(f.actions.cancel).toHaveBeenCalledExactlyOnceWith('request:stable')
    f.state.drawers[0]!.isLoading = false
    await nextTick()
    click(f.root, '刷新')
    expect(f.actions.retry).toHaveBeenCalledExactlyOnceWith('request:stable')
    expect(f.actions.loadMore).not.toHaveBeenCalled()
    expect(
      findCatalogElement(f.root, (node) => node.props['data-am-focus-key'] === 'track:one:play')
        .props.disabled,
    ).toBe(true)
    expect(f.actions.play).not.toHaveBeenCalled()
    click(f.root, '筛选器')
    await nextTick()
    click(f.root, '取消')
    expect(f.actions.cancelFilters).toHaveBeenCalledTimes(1)
    expect(f.actions.applyFilters).not.toHaveBeenCalled()
    f.dispose()
  })

  it('closes error details when viewing retained tracks', async () => {
    const f = mountPage()
    const drawer = f.state.drawers[0]!
    Object.assign(drawer, { status: 'error', errorCode: 'network-error', errorMessage: '连接失败' })
    await nextTick()
    click(f.root, '连接失败')
    await nextTick()
    expect(f.root.textContent).toContain('错误原因')
    click(f.root, '查看已加载歌曲')
    await nextTick()
    expect(f.root.textContent).not.toContain('错误原因')
    expect(f.actions.openDrawer).toHaveBeenCalledExactlyOnceWith(drawer.id)
    expect(f.actions.loadMore).not.toHaveBeenCalled()
    f.dispose()
  })
})
