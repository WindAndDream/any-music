import type { Track } from '@any-music/core'
import { definition as classic } from '@any-music/theme-default/vue'
import {
  createDefaultAppShellPreferences,
  PRODUCT_DESTINATIONS,
  provideConfirmationDialog,
  UI_CONTRIBUTIONS,
} from '@any-music/ui'
import type { UiContributionHost } from '@any-music/ui'
import { createEditingSession, provideEditingSession } from '@any-music/ui/catalog'
import type { UiPluginCenterItem, UiThemeFeatureMap, UiThemeViews } from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, reactive, shallowRef } from 'vue'

import { alternateDefinition as alternate } from '../../fixtures/alternate-theme'
import { createThemeFeatures } from '../../fixtures/theme-features'
import { createSemanticThemeRenderer } from '../../helpers/semantic-theme-renderer'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
} from '../../helpers/test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Transition: passthrough, TransitionGroup: passthrough }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('section', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('section', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
beforeEach(() => {
  vi.stubGlobal('document', {
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  for (const name of ['Document', 'Element', 'HTMLElement', 'HTMLInputElement', 'ShadowRoot'])
    vi.stubGlobal(name, CatalogTestElement)
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose())
  vi.unstubAllGlobals()
})
const track: Track = {
  id: 'song',
  title: '测试歌曲',
  artists: [],
  durationMs: 20000,
  source: { pluginId: 'source', resourceId: 'song', mediaKind: 'audio' },
}

function mountTheme(
  initial: typeof classic | typeof alternate,
  contributions?: UiContributionHost,
) {
  const base = createThemeFeatures(vi.fn())
  const catalog = reactive({
    ...base.catalog.state,
    tracks: [track],
    sourceId: 'source',
    sources: [
      {
        id: 'source',
        name: '测试来源',
        provenance: 'built-in' as const,
        enabled: true,
        importUrlScopes: [],
        capabilities: { search: true, importUrl: true, session: false },
      },
    ],
    activeDrawerId: 'request' as string | null,
    drawers: [
      {
        id: 'request',
        title: '测试结果',
        pluginName: '测试来源',
        pluginId: 'source',
        kind: 'search' as const,
        input: 'submitted',
        isExpanded: true,
        isSourceEnabled: true,
        loadedPageCount: 1,
        tracks: [track],
        hasMore: true,
        isLoading: false,
        status: 'ready' as const,
        errorMessage: '',
        invalidReason: '',
      },
    ],
  })
  const player = reactive({
    ...base.player.state,
    track,
    durationMs: 20000,
    canSeek: true,
    canDownload: true,
  })
  const shell = reactive({ ...base.shell.state, destinations: PRODUCT_DESTINATIONS, canHide: true })
  const actions = {
    ...base.catalog.actions,
    select: vi.fn((ids: readonly string[]) => {
      catalog.selectedTrackIds = [...ids]
    }),
    setSearchQuery: vi.fn((query: string) => {
      catalog.searchQuery = query
    }),
    setImportUrl: vi.fn((url: string) => {
      catalog.importUrl = url
    }),
    setRequestKind: vi.fn((kind: 'search' | 'import-url') => {
      catalog.requestKind = kind
    }),
    submit: vi.fn(),
    clear: vi.fn(() => {
      catalog.searchQuery = ''
      catalog.importUrl = ''
    }),
    setFilterDraft: vi.fn((value: UiThemeFeatureMap['catalog']['state']['filterDraft']) => {
      catalog.filterDraft = value
    }),
    applyFilters: vi.fn(),
    cancelFilters: vi.fn(() => {
      catalog.filterDraft = null
    }),
    loadMore: vi.fn(),
    play: vi.fn(),
    enqueue: vi.fn(),
    download: vi.fn(),
    addToPlaylist: vi.fn(),
  }
  const playerActions = {
    ...base.player.actions,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    download: vi.fn(),
  }
  const navigate = vi.fn((id: typeof shell.activeViewId) => {
    shell.activeViewId = id
  })
  const features: UiThemeFeatureMap = {
    ...base,
    shell: {
      ...base.shell,
      state: shell,
      actions: {
        ...base.shell.actions,
        navigate,
        hide: () => {
          shell.hidden = true
        },
        show: () => {
          shell.hidden = false
        },
      },
    },
    navigation: {
      ...base.navigation,
      state: {
        get activeViewId() {
          return shell.activeViewId
        },
        destinations: PRODUCT_DESTINATIONS,
        preferences: createDefaultAppShellPreferences(),
      },
      actions: { ...base.navigation.actions, navigate },
    },
    catalog: { ...base.catalog, state: catalog, actions },
    player: {
      ...base.player,
      availability: { status: 'available' },
      status: { status: 'ready' },
      state: player,
      actions: playerActions,
    },
  }
  const selection = shallowRef(initial)
  const editing = createEditingSession()
  const { renderer, root, view } = createSemanticThemeRenderer()
  vi.stubGlobal('getComputedStyle', view.getComputedStyle)
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const app = renderer.createApp(
    defineComponent({
      setup() {
        if (contributions) provide(UI_CONTRIBUTIONS, contributions)
        provideEditingSession(editing)
        confirmation = provideConfirmationDialog()
        return () =>
          h(
            selection.value.Root,
            {
              key: selection.value.id,
              features,
              views: selection.value.views as UiThemeViews,
              form: 'desktop',
            },
            {
              'source-identity': () => h('span', '宿主身份'),
              'request-account': () => h('span', '请求账号'),
            },
          )
      },
    }),
  )
  app.mount(root)
  cleanup.push(() => {
    app.unmount()
    editing.dispose()
  })
  return {
    root,
    selection,
    catalog,
    player,
    features,
    shell,
    actions,
    playerActions,
    navigate,
    confirmation,
  }
}
function clickText(root: CatalogTestElement, text: string) {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.tag === 'button' && node.textContent.includes(text)),
    'onClick',
  )
}

it('moves classic plugin counts into the mobile top bar and restores the desktop heading', async () => {
  const f = mountTheme(classic)
  const items: UiPluginCenterItem[] = [
    {
      id: 'source',
      name: '音乐来源',
      description: '发现音乐',
      origin: 'builtin',
      category: '音乐源',
      enabled: true,
      status: { status: 'ready' },
    },
  ]
  const plugins = reactive({ ...f.features.plugins.state, items })
  f.features.plugins = { ...f.features.plugins, state: plugins }
  f.shell.mobileLayout = true
  f.shell.activeViewId = 'plugins'
  await nextTick()
  const topBar = () =>
    findCatalogElement(
      f.root,
      (node) =>
        node.tag === 'header' && String(node.props.class).split(' ').includes('product-top-bar'),
    )
  const page = () =>
    findCatalogElement(
      f.root,
      (node) => node.tag === 'section' && node.props['aria-label'] === '插件中心',
    )
  expect(control(topBar(), '插件数量').textContent).toBe('内置 1 个·外置 0 个')
  expect(() => findCatalogElement(page(), (node) => node.tag === 'h2')).toThrow()
  expect(page().textContent).toContain('全部 1')
  plugins.items.push({ ...items[0]!, id: 'external', name: '外置来源', origin: 'external' })
  await nextTick()
  expect(control(topBar(), '插件数量').textContent).toBe('内置 1 个·外置 1 个')
  f.shell.mobileLayout = false
  await nextTick()
  expect(() => control(topBar(), '插件数量')).toThrow()
  expect(findCatalogElement(page(), (node) => node.tag === 'h2').textContent).toContain('插件中心')
  expect(control(page(), '插件数量').textContent).toBe('内置 1 个·外置 1 个')
})
function control(root: CatalogTestElement, label: string) {
  return findCatalogElement(root, (node) => node.props['aria-label'] === label)
}
function openDiscovery(root: CatalogTestElement) {
  dispatchCatalogEvent(
    findCatalogElement(
      root,
      (node) =>
        node.tag === 'button' &&
        node.props['aria-haspopup'] === 'dialog' &&
        node.textContent.includes('发现'),
    ),
    'onClick',
  )
}

describe('Classic action contracts', () => {
  it('opens a checkbox playlist picker directly and submits all checked destinations once', async () => {
    const f = mountTheme(classic)
    f.catalog.playlists = ['commute', 'relax'].map((id) => ({
      id,
      name: id,
      trackIds: [],
      createdAtMs: 1,
      updatedAtMs: 1,
    }))
    f.catalog.selectedTrackIds = ['song']
    clickText(f.root, '操作器')
    await nextTick()
    clickText(f.root, '加入歌单')
    await nextTick()
    expect(control(f.root, '选择歌单 commute').props.checked).toBe(false)
    dispatchCatalogEvent(control(f.root, '全选当前歌单'), 'onClick')
    await nextTick()
    expect(control(f.root, '全选当前歌单').props['aria-pressed']).toBe(true)
    f.selection.value = alternate
    await nextTick()
    expect(control(f.root, '全选当前歌单').props['aria-pressed']).toBe(true)
    clickText(f.root, '加入歌单（2）')
    await nextTick()
    expect(f.actions.addToPlaylist.mock.calls).toEqual([
      ['commute', ['song']],
      ['relax', ['song']],
    ])
  })

  it('keeps batch labels inside the confirmation dialog and submits only confirmed choices', async () => {
    const options = shallowRef([
      { value: '通勤', selected: false },
      { value: '夜晚', selected: false },
    ])
    const invoke = vi.fn((_item, _point, _context, value) => {
      options.value = options.value.map((option) => ({
        ...option,
        selected: option.selected || option.value === value,
      }))
    })
    const f = mountTheme(classic, {
      resolve: (_point, context) => [
        {
          id: 'tags',
          implementationId: 'batch-tags',
          title: '添加标签',
          inputLabel: '标签名称',
          revision: 1,
          viewRevision: 1,
          contextKey: JSON.stringify(context),
          inputOptions: options.value,
        },
      ],
      accepts: (item, _point, context) => item.contextKey === JSON.stringify(context),
      invoke,
    })
    f.catalog.selectedTrackIds = ['song']
    clickText(f.root, '操作器')
    await nextTick()
    expect(() =>
      findCatalogElement(f.root, (node) => node.props.name === 'contribution-input'),
    ).toThrow()
    expect(() => control(f.root, '添加标签 通勤')).toThrow()
    expect(() => control(f.root, '添加标签 夜晚')).toThrow()
    clickText(f.root, '添加标签')
    await nextTick()
    const input = findCatalogElement(f.root, (node) => node.props.name === 'contribution-input')
    ;(input.props['onUpdate:modelValue'] as (value: string) => void)('新标签')
    await nextTick()
    for (const name of ['通勤', '夜晚']) {
      const choices = findCatalogElement(f.root, (node) => node.props['aria-label'] === '全部标签')
      dispatchCatalogEvent(control(choices, `添加标签 ${name}`), 'onClick')
      // eslint-disable-next-line no-await-in-loop
      await nextTick()
      const updated = findCatalogElement(f.root, (node) => node.props['aria-label'] === '全部标签')
      expect(control(updated, `添加标签 ${name}`).props['aria-pressed']).toBe(true)
    }
    expect(invoke).not.toHaveBeenCalled()
    clickText(f.root, '取消')
    await nextTick()
    expect(invoke).not.toHaveBeenCalled()
    expect(f.catalog.selectedTrackIds).toEqual(['song'])
    clickText(f.root, '添加标签')
    await nextTick()
    expect(control(f.root, '添加标签 通勤').props['aria-pressed']).toBe(false)
    dispatchCatalogEvent(control(f.root, '添加标签 通勤'), 'onClick')
    dispatchCatalogEvent(control(f.root, '添加标签 夜晚'), 'onClick')
    const newInput = findCatalogElement(f.root, (node) => node.props.name === 'contribution-input')
    ;(newInput.props['onUpdate:modelValue'] as (value: string) => void)('新标签')
    await nextTick()
    clickText(f.root, '确认添加')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke).toHaveBeenLastCalledWith(
      expect.anything(),
      'trackList.operator.actions',
      expect.objectContaining({ selectionCount: 1, selectedTracks: [track] }),
      '新标签',
    )
    await nextTick()
    expect(() => control(f.root, '添加标签 通勤')).toThrow()
    expect(f.catalog.selectedTrackIds).toEqual(['song'])
  })
  it('confirms batch queue additions and preserves the selection on cancellation', async () => {
    const f = mountTheme(classic)
    f.catalog.selectedTrackIds = ['song']
    clickText(f.root, '操作器')
    await nextTick()
    clickText(f.root, '添加待听')
    expect(f.confirmation.activeRequest.value?.title).toBe('添加到待听')
    expect(f.actions.enqueue).not.toHaveBeenCalled()
    f.confirmation.cancel()
    await nextTick()
    expect(f.actions.enqueue).not.toHaveBeenCalled()
    expect(f.catalog.selectedTrackIds).toEqual(['song'])
    clickText(f.root, '添加待听')
    f.confirmation.accept()
    await nextTick()
    expect(f.actions.enqueue).toHaveBeenCalledExactlyOnceWith(['song'])
  })

  it.each(['selection', 'context', 'theme'] as const)(
    'ignores queue confirmation after the %s changes',
    async (change) => {
      const f = mountTheme(classic)
      f.catalog.selectedTrackIds = ['song']
      clickText(f.root, '操作器')
      await nextTick()
      clickText(f.root, '添加待听')
      if (change === 'selection') f.catalog.selectedTrackIds = []
      else if (change === 'context') {
        f.catalog.drawers = [{ ...f.catalog.drawers[0]!, id: 'another-request' }]
        f.catalog.activeDrawerId = 'another-request'
      } else f.selection.value = alternate
      await nextTick()
      f.confirmation.accept()
      await nextTick()
      expect(f.actions.enqueue).not.toHaveBeenCalled()
    },
  )

  it('routes player transport, precise seek and navigation through named host actions', async () => {
    const f = mountTheme(classic)
    dispatchCatalogEvent(control(f.root, '播放'), 'onClick')
    expect(f.playerActions.play).toHaveBeenCalledOnce()
    f.player.playing = true
    await nextTick()
    dispatchCatalogEvent(control(f.root, '暂停'), 'onClick')
    dispatchCatalogEvent(control(f.root, '下一首'), 'onClick')
    dispatchCatalogEvent(control(f.root, '上一首'), 'onClick')
    const seek = control(f.root, '精确播放进度')
    seek.value = '8100'
    dispatchCatalogEvent(seek, 'onChange')
    expect(f.playerActions.pause).toHaveBeenCalledOnce()
    expect(f.playerActions.seek).toHaveBeenCalledExactlyOnceWith(8100)
    expect(f.playerActions.next).toHaveBeenCalledOnce()
    expect(f.playerActions.previous).toHaveBeenCalledOnce()
    clickText(f.root, '我的喜欢')
    expect(f.navigate).toHaveBeenLastCalledWith('favorites')
  })
  it('retains selection and distinct search/import drafts across a root remount without implicit actions', async () => {
    const f = mountTheme(classic)
    f.catalog.activeDrawerId = null
    await nextTick()
    openDiscovery(f.root)
    await nextTick()
    f.catalog.activeDrawerId = 'request'
    await nextTick()
    const input = findCatalogElement(
      f.root,
      (node) => node.tag === 'input' && node.props.type === 'search',
    )
    input.value = 'unfinished'
    dispatchCatalogEvent(input, 'onInput')
    expect(f.catalog.searchQuery).toBe('unfinished')
    f.catalog.importUrl = 'https://example.com/draft'
    clickText(f.root, '操作器')
    await nextTick()
    const trackSelection = () =>
      findCatalogElement(
        f.root,
        (node) => node.tag === 'input' && node.props['data-am-focus-key'] === 'track:song:select',
      )
    dispatchCatalogEvent(await vi.waitFor(trackSelection), 'onChange')
    expect(f.actions.select).toHaveBeenCalledExactlyOnceWith(['song'])

    f.selection.value = alternate
    await nextTick()
    expect(f.catalog.searchQuery).toBe('unfinished')
    expect(f.catalog.importUrl).toBe('https://example.com/draft')
    await vi.waitFor(() => expect(trackSelection().props.checked).toBe(true))
    expect(f.root.textContent).toContain('请求账号')
    expect(f.actions.submit).not.toHaveBeenCalled()
    expect(f.actions.loadMore).not.toHaveBeenCalled()
    expect(f.actions.play).not.toHaveBeenCalled()
  })
  it('submits explicitly and loads another page using the original request identity', async () => {
    const f = mountTheme(classic)
    f.catalog.activeDrawerId = null
    await nextTick()
    openDiscovery(f.root)
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(f.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    expect(f.actions.submit).toHaveBeenCalledOnce()
    f.catalog.activeDrawerId = 'request'
    await nextTick()
    expect(f.root.textContent).not.toContain('加载更多歌曲')
    expect(f.actions.loadMore).not.toHaveBeenCalled()
  })
})
