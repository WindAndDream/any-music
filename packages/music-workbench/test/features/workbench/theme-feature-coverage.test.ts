/* Sequential root replacement is the behavior under test. */
/* eslint-disable no-await-in-loop */
import { createAppErrorState } from '@any-music/core'
import type { DownloadHistoryBatch, Track } from '@any-music/core'
import { definition as classic } from '@any-music/theme-default/vue'
import { definition as studio } from '@any-music/theme-studio/vue'
import {
  createEditingSession,
  provideEditingSession,
  provideConfirmationDialog,
  PRODUCT_DESTINATIONS,
  FILTER_HISTORY_SETTINGS_GROUPS,
} from '@any-music/ui'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import type { UiThemeDefinition, UiThemeFeatureMap } from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, shallowReactive, shallowRef } from 'vue'

import { createThemeFeatures } from '../../fixtures/theme-features'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  renderer,
} from '../../helpers/test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const pass = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Transition: pass, TransitionGroup: pass }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title', 'suspended'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? vue.h(
                'section',
                { 'aria-label': props.title, inert: props.suspended ? true : undefined },
                [slots.default?.(), slots.footer?.()],
              )
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title', 'suspended'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? vue.h(
                'section',
                { 'aria-label': props.title, inert: props.suspended ? true : undefined },
                [slots.default?.(), slots.footer?.()],
              )
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
const cleanup: (() => void)[] = []
beforeEach(() => {
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
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose())
  vi.unstubAllGlobals()
})
const track: Track = {
  id: 'one',
  title: 'one',
  artists: [],
  source: { pluginId: 'source', resourceId: 'one', mediaKind: 'audio' },
}
function mount(initial: UiThemeDefinition, form: 'desktop' | 'mobile' = 'desktop') {
  const base = createThemeFeatures(vi.fn())
  const shell = reactive({ ...base.shell.state, destinations: PRODUCT_DESTINATIONS })
  const queue = reactive({ ...base.queue.state, tracks: [track] })
  const settings = reactive({ ...base.settings.state, creatorDisplayName: '原名称' })
  const overlays = reactive({ ...base.overlays.state })
  const actions = {
    ...base.queue.actions,
    play: vi.fn(),
    select: vi.fn((ids: readonly string[]) => {
      queue.selectedTrackIds = [...ids]
    }),
    setFilterDraft: vi.fn((draft: CatalogTrackFilterState | null) => {
      queue.filterDraft = draft
    }),
    cancelFilters: vi.fn(() => {
      queue.filterDraft = null
    }),
    reorder: vi.fn(),
    moveTrack: vi.fn(),
    clear: vi.fn(),
    download: vi.fn(),
    showTrackActions: vi.fn((trackId: string) => {
      overlays.active = { kind: 'track-actions', trackId }
    }),
  }
  const saves = { name: vi.fn(), appearance: vi.fn(), theme: vi.fn() }
  const features = shallowReactive<UiThemeFeatureMap>({
    ...base,
    shell: { ...base.shell, state: shell },
    queue: { ...base.queue, state: queue, actions },
    overlays: {
      ...base.overlays,
      state: overlays,
      actions: { ...base.overlays.actions, close: () => (overlays.active = null) },
    },
    settings: {
      ...base.settings,
      state: settings,
      actions: {
        ...base.settings.actions,
        setCreatorDisplayName: saves.name,
        setAppearance: saves.appearance,
        selectTheme: saves.theme,
        selectSection: (section) => {
          settings.section = section
        },
      },
    },
  })
  const choice = shallowRef<UiThemeDefinition>(initial)
  const editing = createEditingSession()
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const root = new CatalogTestElement('root')
  const app = renderer.createApp(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        confirmation = provideConfirmationDialog()
        return () =>
          h(
            choice.value.Root,
            { features, views: choice.value.views, form },
            {
              'account-settings': () => h('p', '固定宿主账号'),
              'network-settings': () => h('p', '固定宿主网络'),
              'download-settings': () => h('p', '固定宿主保存'),
              'external-source-settings': () => h('p', '固定宿主安装'),
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
  const button = (text: string) =>
    findCatalogElement(
      root,
      (node) =>
        node.tag === 'button' &&
        (node.textContent.trim() === text || node.props['aria-label'] === text),
    )
  const click = (text: string) =>
    dispatchCatalogEvent(
      button(
        choice.value.id === 'default' && text === '暂停已选'
          ? '暂停下载'
          : choice.value.id === 'default' && text === '下载已选'
            ? '下载已选歌曲'
            : text,
      ),
      'onClick',
    )
  async function openOperator() {
    if (choice.value.id !== 'default') return
    const launcher = findCatalogElement(
      root,
      (node) => node.tag === 'button' && node.textContent.trim().startsWith('操作器'),
    )
    if (!launcher.props['aria-expanded']) {
      dispatchCatalogEvent(launcher, 'onClick')
      await nextTick()
    }
  }
  return {
    root,
    shell,
    queue,
    settings,
    overlays,
    features,
    actions,
    saves,
    choice,
    confirmation,
    editing,
    button,
    click,
    openOperator,
  }
}

describe.each([
  ['classic', classic],
  ['studio', studio],
] as const)('%s complete feature contract', (_name, initial) => {
  it('shows host theme failures in appearance settings and clears them after recovery', async () => {
    const f = mount(initial)
    f.settings.open = true
    f.settings.section = 'appearance'
    f.settings.themeError = '界面主题不可用，已使用默认主题。可重新选择主题以重试。'
    await nextTick()
    expect(
      findCatalogElement(
        f.root,
        (node) => node.props.role === 'alert' && node.textContent.includes('界面主题不可用'),
      ),
    ).toBeDefined()
    f.settings.themeError = ''
    await nextTick()
    expect(f.root.textContent).not.toContain('界面主题不可用')
  })

  it.each(['desktop', 'mobile'] as const)(
    'switches bidirectionally from every major page without a source on %s',
    async (form) => {
      const f = mount(initial, form)
      for (const destination of PRODUCT_DESTINATIONS) {
        f.shell.activeViewId = destination.id
        f.features.tags = {
          ...f.features.tags,
          availability: { status: 'disabled', reason: '标签已停用，数据保留' },
        }
        f.features.composer = {
          ...f.features.composer,
          availability: { status: 'disabled', reason: '创作已停用，数据保留' },
        }
        await nextTick()
        const text = f.root.textContent
        expect(text).not.toContain('尚未迁移')
        const labels: Partial<Record<typeof destination.id, readonly string[]>> = {
          catalog: ['音乐列表', '发现音乐'],
          queue: ['待听'],
          favorites: ['我的喜欢'],
          playlists: ['我的歌单'],
          'custom-tracks': ['全部自定义音乐列表'],
          history: ['播放历史'],
          downloads: ['下载任务'],
          plugins: ['插件中心'],
        }
        const assertPage = () => {
          const expected = labels[destination.id]
          if (expected)
            expect(
              findCatalogElement(
                f.root,
                (node) =>
                  node.tag === 'section' && expected.includes(String(node.props['aria-label'])),
              ),
            ).toBeDefined()
        }
        assertPage()
        const scrollKey = findCatalogElement(f.root, (node) => node.tag === 'main').props[
          'data-am-scroll-key'
        ]
        expect(scrollKey).toBeTruthy()
        if (destination.id === 'tags') expect(text).toContain('标签已停用，数据保留')
        if (destination.id === 'composer') expect(text).toContain('创作已停用，数据保留')
        f.choice.value = initial === classic ? studio : classic
        await nextTick()
        expect(f.shell.activeViewId).toBe(destination.id)
        expect(f.root.textContent).not.toContain('尚未迁移')
        assertPage()
        expect(
          findCatalogElement(f.root, (node) => node.tag === 'main').props['data-am-scroll-key'],
        ).toBe(scrollKey)
        f.choice.value = initial
        await nextTick()
      }
      expect(f.actions.select).not.toHaveBeenCalled()
      expect(f.actions.download).not.toHaveBeenCalled()
      expect(f.saves.name).not.toHaveBeenCalled()
    },
  )

  it('keeps queue selection and rejects confirmation from the replaced root', async () => {
    const f = mount(initial)
    f.shell.activeViewId = 'queue'
    await nextTick()
    if (initial === classic) {
      dispatchCatalogEvent(
        findCatalogElement(
          f.root,
          (node) => node.tag === 'button' && node.textContent.trim().startsWith('操作器'),
        ),
        'onClick',
      )
      await nextTick()
    }
    dispatchCatalogEvent(
      findCatalogElement(f.root, (node) => node.tag === 'input' && node.props.type === 'checkbox'),
      'onChange',
    )
    expect(f.actions.select).toHaveBeenCalledWith(['one'])
    await nextTick()
    f.click('下载已选')
    expect(f.confirmation.activeRequest.value?.title).toMatch(/下载/)
    f.choice.value = initial === classic ? studio : classic
    await nextTick()
    f.confirmation.accept()
    await nextTick()
    expect(f.actions.download).not.toHaveBeenCalled()
    expect(f.queue.selectedTrackIds).toEqual(['one'])
  })

  it('retains the shared unsaved settings cell and blocks an old save callback', async () => {
    const f = mount(initial)
    f.settings.open = true
    f.settings.section = 'creator-profile'
    await vi.waitFor(() => expect(f.root.textContent).toContain('保存创作者名称'))
    const input = findCatalogElement(
      f.root,
      (node) => node.props['data-am-focus-key'] === 'settings:creator-profile:name',
    )
    ;(input.props['onUpdate:modelValue'] as (value: string) => void)('未提交名称')
    const saveForm = findCatalogElement(
      f.root,
      (node) => node.tag === 'form' && node.textContent.includes('保存创作者名称'),
    )
    f.choice.value = initial === classic ? studio : classic
    await vi.waitFor(() =>
      expect(
        findCatalogElement(
          f.root,
          (node) => node.props['data-am-focus-key'] === 'settings:creator-profile:name',
        ).value,
      ).toBe('未提交名称'),
    )
    dispatchCatalogEvent(saveForm, 'onSubmit')
    expect(f.saves.name).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(
        f.root,
        (node) => node.tag === 'form' && node.textContent.includes('保存创作者名称'),
      ),
      'onSubmit',
    )
    expect(f.saves.name).toHaveBeenCalledExactlyOnceWith('未提交名称')
  })

  it('preserves task item identities and forwards task commands across roots', async () => {
    const f = mount(initial)
    const batch: DownloadHistoryBatch = {
      id: 'batch',
      origin: { kind: 'queue', label: '待听' },
      status: 'running',
      startedAtMs: 1,
      concurrency: 1,
      items: [
        {
          id: 'attempt-one',
          track,
          status: 'downloading',
          requestedAtMs: 1,
          attempts: [],
          maxRetryCount: 0,
          progressMessage: '读取 42%',
        },
      ],
    }
    const state = reactive({
      ...f.features.downloads.state,
      batches: [batch],
      selectedItemIds: ['attempt-one'],
    })
    const pause = vi.fn()
    f.features.downloads = {
      ...f.features.downloads,
      state,
      actions: { ...f.features.downloads.actions, pause },
    }
    f.shell.activeViewId = 'downloads'
    await vi.waitFor(() => expect(f.root.textContent).toContain('读取 42%'))
    await f.openOperator()
    f.click('暂停已选')
    expect(pause).toHaveBeenCalledExactlyOnceWith(['attempt-one'])
    f.choice.value = initial === classic ? studio : classic
    await vi.waitFor(() => expect(f.root.textContent).toContain('读取 42%'))
    expect(state.selectedItemIds).toEqual(['attempt-one'])
    expect(pause).toHaveBeenCalledOnce()
    await f.openOperator()
    f.click('暂停已选')
    expect(pause).toHaveBeenLastCalledWith(['attempt-one'])
  })

  it('shows errors and protected settings slots without enabling native authority', async () => {
    const f = mount(initial)
    f.features.queue = {
      ...f.features.queue,
      status: { status: 'partial', errors: [createAppErrorState('network-error', '部分加载失败')] },
    }
    f.shell.activeViewId = 'queue'
    await nextTick()
    expect(f.root.textContent).toContain('部分加载失败')
    expect(f.root.textContent).toContain('one')
    f.settings.open = true
    for (const [section, text] of [
      ['accounts', '固定宿主账号'],
      ['proxy', '固定宿主网络'],
      ['downloads', '固定宿主保存'],
    ] as const) {
      f.settings.section = section
      await vi.waitFor(() => expect(f.root.textContent).toContain(text))
    }
    expect(f.saves.name).not.toHaveBeenCalled()
    expect(f.saves.theme).not.toHaveBeenCalled()
  })

  it('requires explicit download confirmation and ignores the replaced selection', async () => {
    const f = mount(initial)
    f.shell.activeViewId = 'queue'
    f.queue.selectedTrackIds = ['one']
    await nextTick()
    await f.openOperator()
    f.click('下载已选')
    expect(f.actions.download).not.toHaveBeenCalled()
    f.choice.value = initial === classic ? studio : classic
    await nextTick()
    f.confirmation.accept()
    await nextTick()
    expect(f.actions.download).not.toHaveBeenCalled()
    await f.openOperator()
    f.click('下载已选')
    f.confirmation.accept()
    await nextTick()
    expect(f.actions.download).toHaveBeenCalledExactlyOnceWith(['one'])
  })

  it('provides ordering without a drag gesture', async () => {
    const f = mount(initial)
    f.shell.activeViewId = 'queue'
    f.queue.tracks = [track, { ...track, id: 'two', title: 'two' }]
    await nextTick()
    if (initial === classic) {
      const cover = findCatalogElement(f.root, (node) =>
        String(node.props['aria-label']).includes('歌曲 one；'),
      )
      const handlers = cover.props.onKeydown as ((event: unknown) => void)[]
      handlers.forEach((handler) =>
        handler({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} }),
      )
      expect(f.actions.moveTrack).toHaveBeenCalledExactlyOnceWith('one', 'two', ['one', 'two'])
    } else {
      dispatchCatalogEvent(
        findCatalogElement(f.root, (node) => node.props['aria-label'] === '下移《one》'),
        'onClick',
      )
      expect(f.actions.reorder).toHaveBeenCalledExactlyOnceWith(['two', 'one'])
    }
  })

  it('keeps invalid numeric settings and unfinished input across both roots until explicit save', async () => {
    const f = mount(initial)
    const save = vi.fn()
    f.features.settings = {
      ...f.features.settings,
      actions: { ...f.features.settings.actions, setPlaybackHistoryLimit: save },
    }
    f.settings.open = true
    f.settings.section = 'playback-history'
    const field = () =>
      findCatalogElement(f.root, (node) => node.tag === 'input' && node.props.type === 'number')
    await vi.waitFor(() => expect(field().value).toBe(100))
    ;(field().props['onUpdate:modelValue'] as (value: string) => void)('')
    const submit = () =>
      dispatchCatalogEvent(
        findCatalogElement(
          f.root,
          (node) =>
            node.tag === 'form' &&
            node.textContent.includes('保存') &&
            node.textContent.includes('数量'),
        ),
        'onSubmit',
      )
    submit()
    await nextTick()
    expect(save).not.toHaveBeenCalled()
    expect(f.root.textContent).toContain('历史记录数量须为')
    f.choice.value = initial === classic ? studio : classic
    await vi.waitFor(() => expect(field().value).toBe(''))
    expect(f.root.textContent).toContain('历史记录数量须为')
    ;(field().props['onUpdate:modelValue'] as (value: string) => void)('27')
    submit()
    expect(save).toHaveBeenCalledExactlyOnceWith(27)
  })

  it('forwards module enable and retry from the full root', async () => {
    const f = mount(initial)
    const setEnabled = vi.fn(),
      retry = vi.fn()
    f.features.plugins = {
      ...f.features.plugins,
      state: {
        ...f.features.plugins.state,
        items: [
          {
            id: 'feature.tags',
            name: '标签管理',
            description: '整理音乐标签',
            origin: 'builtin',
            category: '资料整理',
            enabled: false,
            status: { status: 'error', error: createAppErrorState('conflict', '加载失败') },
          },
        ],
      },
      actions: { ...f.features.plugins.actions, setEnabled, retry },
    }
    f.shell.activeViewId = 'plugins'
    await nextTick()
    const checkbox = findCatalogElement(
      f.root,
      (node) => node.tag === 'input' && node.props.type === 'checkbox',
    )
    ;(checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } })
    f.click('重试')
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith('feature.tags', true)
    expect(retry).toHaveBeenCalledExactlyOnceWith('feature.tags')
    expect(f.root.textContent).toContain('加载失败')
  })
})

const ancestors = (node: CatalogTestElement) => {
  const nodes: CatalogTestElement[] = []
  for (let parent = node.parent; parent; parent = parent.parent) nodes.push(parent)
  return nodes
}

/** Equal dialog tokens paint in tree order; details must escape the suspended settings sheet. */
function expectSettingsDetailAboveSheet(root: CatalogTestElement, title: string) {
  const sheet = findCatalogElement(root, (node) => node.props['aria-label'] === '设置')
  const dialog = findCatalogElement(root, (node) => node.props['aria-label'] === title)
  const layer = [dialog, ...ancestors(dialog)].find((node) => node.parent === sheet.parent)
  expect(sheet.props.inert).toBe(true)
  expect(ancestors(dialog).some((node) => node.props.inert)).toBe(false)
  expect(layer).toBeDefined()
  expect(sheet.parent!.children.indexOf(layer!)).toBeGreaterThan(
    sheet.parent!.children.indexOf(sheet),
  )
}

describe.each(['desktop', 'mobile'] as const)('classic %s settings detail layers', (form) => {
  it.each([
    ['界面主题：经典', '界面主题', 'preference:ui-theme:default'],
    ['主题：跟随系统', '主题', 'preference:theme:system'],
    ['侧栏位置：左侧', '侧栏位置', 'preference:sidebar-side:left'],
  ])('opens %s above settings and resumes the sheet after selection', async (entry, title, key) => {
    const f = mount(classic, form)
    f.settings.open = true
    f.settings.isMobileLayout = form === 'mobile'
    f.settings.section = 'appearance'
    f.settings.themes = [{ id: 'default', title: '经典' }]
    await nextTick()
    f.click(entry)
    await nextTick()
    expectSettingsDetailAboveSheet(f.root, title)
    dispatchCatalogEvent(
      findCatalogElement(f.root, (node) => node.props['data-am-focus-key'] === key),
      'onClick',
    )
    await nextTick()
    expect(
      findCatalogElement(f.root, (node) => node.props['aria-label'] === '设置').props.inert,
    ).toBeUndefined()
  })

  it.each(
    FILTER_HISTORY_SETTINGS_GROUPS.flatMap((group) =>
      group.regions.map((region) => [group.title, region.title] as const),
    ),
  )('opens %s / %s above settings and resumes the sheet on return', async (group, title) => {
    const f = mount(classic, form)
    f.settings.open = true
    f.settings.isMobileLayout = form === 'mobile'
    f.settings.section = 'filter-history'
    await nextTick()
    const groupHeading = findCatalogElement(
      f.root,
      (node) => node.tag === 'button' && node.textContent.trim().startsWith(group),
    )
    dispatchCatalogEvent(groupHeading, 'onClick')
    await nextTick()
    f.click(`配置${title}`)
    await nextTick()
    expectSettingsDetailAboveSheet(f.root, title)
    const dialog = findCatalogElement(f.root, (node) => node.props['aria-label'] === title)
    dispatchCatalogEvent(
      findCatalogElement(
        dialog,
        (node) => node.tag === 'button' && node.textContent.trim() === '返回',
      ),
      'onClick',
    )
    await nextTick()
    expect(
      findCatalogElement(f.root, (node) => node.props['aria-label'] === '设置').props.inert,
    ).toBeUndefined()
  })
})

it('keeps classic toolbars and modal content outside the inert scrolling page', async () => {
  const f = mount(classic)
  f.shell.activeViewId = 'queue'
  await nextTick()
  const filter = f.button('筛选歌曲')

  expect(ancestors(filter).some((node) => node.props.class === 'music-app-shell__player')).toBe(
    true,
  )
  f.click('筛选歌曲')
  await nextTick()
  const modal = findCatalogElement(
    f.root,
    (node) => node.props['aria-label'] === '歌曲筛选器' && node.tag === 'section',
  )
  expect(ancestors(modal).some((node) => node.tag === 'main')).toBe(false)
  expect(findCatalogElement(f.root, (node) => node.tag === 'main').props.inert).toBe(true)
  f.click('取消')
  await nextTick()
  expect(findCatalogElement(f.root, (node) => node.tag === 'main').props.inert).toBeUndefined()
  expect(f.queue.filterDraft).toBeNull()
})

it('opens classic collection song actions outside the inert page and rejects a replaced dialog', async () => {
  const f = mount(classic)
  f.shell.activeViewId = 'queue'
  await nextTick()
  f.click('打开《one》的操作')
  await nextTick()
  const dialog = findCatalogElement(f.root, (node) => node.props['aria-label'] === '歌曲操作')
  expect(ancestors(dialog).some((node) => node.tag === 'main')).toBe(false)
  expect(findCatalogElement(f.root, (node) => node.tag === 'main').props.inert).toBe(true)
  const play = findCatalogElement(
    dialog,
    (node) => node.tag === 'button' && node.textContent.trim() === '播放',
  )
  const oldPlay = play.props.onClick as () => void
  f.choice.value = studio
  await nextTick()
  oldPlay()
  expect(f.actions.play).not.toHaveBeenCalled()
  expect(f.overlays.active).toEqual({ kind: 'track-actions', trackId: 'one' })
  f.choice.value = classic
  await nextTick()
  const currentDialog = findCatalogElement(
    f.root,
    (node) => node.props['aria-label'] === '歌曲操作',
  )
  dispatchCatalogEvent(
    findCatalogElement(
      currentDialog,
      (node) => node.tag === 'button' && node.textContent.trim() === '播放',
    ),
    'onClick',
  )
  expect(f.actions.play).toHaveBeenCalledExactlyOnceWith('one', ['one'])
  await nextTick()
  expect(f.overlays.active).toBeNull()
  expect(findCatalogElement(f.root, (node) => node.tag === 'main').props.inert).toBeUndefined()
})

it('closes the classic mobile navigation drawer after selecting a destination', async () => {
  const f = mount(classic, 'mobile')
  const navigate = vi.fn((id: UiThemeFeatureMap['shell']['state']['activeViewId']) => {
    f.shell.activeViewId = id
  })
  f.features.navigation = {
    ...f.features.navigation,
    state: { ...f.features.navigation.state, destinations: PRODUCT_DESTINATIONS },
    actions: { ...f.features.navigation.actions, navigate },
  }
  f.click('打开功能导航')
  await nextTick()
  const drawer = findCatalogElement(f.root, (node) => node.props['aria-label'] === '功能导航')
  dispatchCatalogEvent(
    findCatalogElement(
      drawer,
      (node) => node.tag === 'button' && node.props['data-am-focus-key'] === 'navigation:queue',
    ),
    'onClick',
  )
  await nextTick()
  expect(navigate).toHaveBeenCalledExactlyOnceWith('queue')
  expect(f.shell.activeViewId).toBe('queue')
  expect(drawer.props['aria-modal']).toBeUndefined()
  expect(drawer.props.inert).toBe(true)
})
