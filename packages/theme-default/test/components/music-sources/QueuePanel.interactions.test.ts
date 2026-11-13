import type { Track } from '@any-music/core'
import type { TrackPlaybackState } from '@any-music/ui'
import { provideConfirmationDialog, provideActionFeedback } from '@any-music/ui/library'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import {
  defineComponent as defineQueueTestComponent,
  h as renderQueueTestComponent,
  KeepAlive,
  nextTick,
  reactive,
  watch,
} from 'vue'

import FavoritePanel from '../../../src/components/library/FavoritePanel.vue'
import QueuePanel from '../../../src/components/music-sources/QueuePanel.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const { confirmation, feedback } = vi.hoisted(() => ({ confirmation: vi.fn(), feedback: vi.fn() }))
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
    TransitionGroup: vue.defineComponent({
      props: ['tag'],
      setup:
        (props, { slots }) =>
        () =>
          vue.h(props.tag ?? 'div', slots.default?.()),
    }),
  }
})
// 真实组件与事件在 Node 渲染器运行，模态 DOM 和 FLIP 交给独立契约/输入测试。
vi.mock('@any-music/ui/components/music-sources/TrackCardGrid.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
    }),
  }
})
vi.mock('../../../src/components/music-sources/CatalogOperatorActions.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('div', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? h('div', slots.default?.()) : null,
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
          props.open ? h('div', slots.default?.()) : null,
    }),
  }
})
vi.mock('../../../src/components/music-sources/CatalogTrackFilterPanel.vue', async () => {
  const { defineComponent, h, shallowRef } = await import('vue')
  return {
    default: defineComponent({
      props: ['filters', 'filterContext', 'historyScope'],
      emits: ['update:filters', 'previewChange'],
      setup(props, { emit }) {
        const edits = shallowRef(0)
        return () =>
          h(
            'button',
            {
              'data-filter-edits': edits.value,
              'data-filter-query': props.filters.searchFilters[0]?.query,
              onClick: () => {
                edits.value += 1
                const filters = { ...props.filters, searchFilters: [{ query: '匹配' }] }
                emit('update:filters', filters)
                emit('previewChange', filters)
              },
            },
            '设置文本筛选',
          )
      },
    }),
  }
})

async function settle() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

const tracks: Track[] = ['one', 'two', 'three'].map((id) => ({
  id,
  title: id === 'two' ? '其他歌曲' : `匹配歌曲 ${id}`,
  artists: [{ name: '作者' }],
  source: { pluginId: 'a', mediaKind: 'audio', resourceId: id },
}))
beforeEach(() => {
  feedback.mockReset()
  confirmation.mockReset()
  confirmation.mockResolvedValue(true)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('Document', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())
function mountQueue(items: readonly Track[] = tracks, context: 'queue' | 'favorites' = 'queue') {
  const overlays = new CatalogTestElement('overlays')
  const state = reactive({
    active: true,
    items,
    filterOpen: false,
    operatorOpen: true,
    downloadBusy: false,
    favoriteTrackIds: new Set<string>(),
    queuedTrackIds: new Set<string>(),
    downloadedTrackIds: new Set<string>(),
    displayMode: 'standard' as 'standard' | 'comfortable' | 'compact',
    mobileColumns: 1 as 1 | 2,
    arrangementMode: 'flat' as 'flat' | 'platform',
    playbackState: undefined as TrackPlaybackState | undefined,
  })
  const queueMany = vi.fn()
  const queue = vi.fn()
  const addToPlaylist = vi.fn()
  const playCollection = vi.fn()
  const download = vi.fn()
  const remove = vi.fn()
  const move = vi.fn()
  const movePlatform = vi.fn()
  const play = vi.fn()
  const summary = vi.fn()
  const operatorAvailable = vi.fn()
  const favorite = vi.fn()
  const favoriteMany = vi.fn()
  const requestCreatePlaylist = vi.fn()
  const pin = vi.fn()
  const compose = vi.fn()
  const rename = vi.fn()
  const addTag = vi.fn()
  const arrangement = vi.fn()
  const app = mountCatalogComponent(
    defineQueueTestComponent({
      setup() {
        const controller = provideConfirmationDialog()
        watch(
          controller.activeRequest,
          async (request) => {
            if (!request) return
            const accepted = await confirmation(request)
            if (controller.activeRequest.value?.id !== request.id) return
            if (accepted) controller.accept()
            else controller.cancel()
          },
          { flush: 'sync' },
        )
        const notices = provideActionFeedback()
        watch(
          notices.notice,
          (notice) => {
            if (notice) feedback({ status: notice.tone, message: notice.message })
          },
          { flush: 'sync' },
        )
        return () =>
          renderQueueTestComponent(KeepAlive, { max: 1 }, () =>
            state.active
              ? renderQueueTestComponent(
                  (context === 'favorites' ? FavoritePanel : QueuePanel) as Component,
                  {
                    ...state,
                    records: state.items.map((track) => ({
                      track,
                      customTags: [],
                      addedAtMs: 0,
                      updatedAtMs: 0,
                      favoritedAtMs: 1,
                    })),
                    playlists: [
                      {
                        id: 'playlist',
                        name: '测试歌单',
                        trackIds: [],
                        createdAtMs: 0,
                        updatedAtMs: 0,
                      },
                    ],
                    onQueueMany: queueMany,
                    onQueue: queue,
                    onAddToPlaylist: addToPlaylist,
                    onPlay: playCollection,
                    onUnfavoriteMany: remove,
                    onUnfavorite: (id: string) => remove([id]),
                    platformNames: new Map([
                      ['a', '平台 A'],
                      ['b', '平台 B'],
                    ]),
                    errorMessage: '',
                    overlayTarget: overlays as unknown as HTMLElement,
                    operatorOverlayTarget: overlays as unknown as HTMLElement,
                    onCloseFilter: () => {
                      state.filterOpen = false
                    },
                    onDownload: download,
                    onRemoveMany: context === 'queue' ? remove : undefined,
                    onMove: move,
                    onMovePlatform: movePlatform,
                    onSelect: play,
                    onSummaryChange: summary,
                    onOperatorAvailableChange: operatorAvailable,
                    onFavorite: favorite,
                    onFavoriteMany: favoriteMany,
                    onRequestCreatePlaylist: requestCreatePlaylist,
                    onPin: pin,
                    onCompose: compose,
                    onRename: rename,
                    onAddTag: addTag,
                    'onUpdate:arrangementMode': (mode: typeof state.arrangementMode) => {
                      arrangement(mode)
                      state.arrangementMode = mode
                    },
                    onUpdateDisplayMode: (mode: typeof state.displayMode) => {
                      state.displayMode = mode
                    },
                    onUpdateMobileColumns: (columns: 1 | 2) => {
                      state.mobileColumns = columns
                    },
                  },
                )
              : null,
          )
      },
    }),
    {},
  )
  const find = (text: string) =>
    findCatalogElement(
      overlays,
      (node) => node.tag === 'button' && node.textContent.replace(/\s+/g, '') === text,
    )
  const select = (id: string) => {
    const row = findCatalogElement(app.root, (node) => node.props['data-queue-drop-id'] === id)
    dispatchCatalogEvent(
      findCatalogElement(row, (node) => node.tag === 'input'),
      'onChange',
    )
  }
  const openActions = async (id: string) => {
    dispatchCatalogEvent(
      findCatalogElement(
        app.root,
        (node) =>
          node.props['aria-label'] ===
          `打开《${items.find((track) => track.id === id)!.title}》的操作`,
      ),
      'onClick',
    )
    await settle()
  }
  return {
    ...app,
    overlays,
    state,
    find,
    select,
    download,
    queueMany,
    queue,
    addToPlaylist,
    playCollection,
    remove,
    move,
    movePlatform,
    play,
    summary,
    operatorAvailable,
    favorite,
    favoriteMany,
    requestCreatePlaylist,
    pin,
    compose,
    rename,
    addTag,
    arrangement,
    openActions,
  }
}
describe('QueuePanel controlled interactions', () => {
  it.each(['queue', 'favorites'] as const)(
    'reports select all and deselect all at the top of %s',
    async (context) => {
      const test = mountQueue(tracks, context)
      await settle()
      const checkbox = findCatalogElement(
        test.overlays,
        (node) => node.props['aria-label'] === '全选当前 3 首匹配歌曲',
      )
      dispatchCatalogEvent(checkbox, 'onChange')
      await settle()
      expect(feedback).toHaveBeenLastCalledWith({ status: 'success', message: '已选择 3 首歌曲。' })
      expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(3)
      dispatchCatalogEvent(checkbox, 'onChange')
      await settle()
      expect(feedback).toHaveBeenLastCalledWith({ status: 'success', message: '已取消选择。' })
      expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(0)
      test.unmount()
    },
  )

  it.each(['queue', 'favorites'] as const)(
    'confirms batch removal from %s and preserves selection on cancel',
    async (context) => {
      const test = mountQueue(tracks, context)
      await settle()
      const label = context === 'favorites' ? '移出喜欢移出喜欢' : '移出待听移出待听'
      expect(test.find(label).props.disabled).toBe(true)
      test.select('one')
      test.select('three')
      await settle()
      confirmation.mockResolvedValueOnce(false)
      dispatchCatalogEvent(test.find(label), 'onClick')
      await settle()
      expect(confirmation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: context === 'favorites' ? '取消喜欢' : '移出待听',
          tone: 'danger',
          message: expect.stringContaining('已选的 2 首歌曲'),
        }),
      )
      expect(test.remove).not.toHaveBeenCalled()
      expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(2)
      dispatchCatalogEvent(test.find(label), 'onClick')
      await settle()
      expect(test.remove).toHaveBeenCalledExactlyOnceWith(['one', 'three'])
      await settle()
      expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(0)
      test.unmount()
    },
  )

  it.each(['queue', 'favorites'] as const)(
    'ignores pending %s removal when its cached view is inactive',
    async (context) => {
      const test = mountQueue(tracks, context)
      test.select('one')
      await settle()
      let resolve!: (value: boolean) => void
      confirmation.mockReturnValueOnce(
        new Promise<boolean>((done) => {
          resolve = done
        }),
      )
      dispatchCatalogEvent(
        test.find(context === 'favorites' ? '移出喜欢移出喜欢' : '移出待听移出待听'),
        'onClick',
      )
      test.state.active = false
      await settle()
      resolve(true)
      await settle()
      expect(test.remove).not.toHaveBeenCalled()
      test.unmount()
    },
  )
  it.each(['queue', 'favorites'] as const)(
    'retains cached %s selection until explicit closing and preserves unfinished filters',
    async (context) => {
      const view = mountQueue(tracks, context)
      await settle()
      view.select('one')
      await settle()
      expect(view.summary).toHaveBeenLastCalledWith(expect.objectContaining({ selectedCount: 1 }))
      expect(view.overlays.textContent).toContain('全选')
      view.state.active = false
      await settle()
      expect(view.overlays.textContent).toBe('')
      view.state.active = true
      await settle()
      expect(view.overlays.textContent).toContain('全选')

      view.state.operatorOpen = false
      view.state.filterOpen = true
      await settle()
      dispatchCatalogEvent(view.find('设置文本筛选'), 'onClick')
      await settle()
      view.state.active = false
      await settle()
      expect(view.overlays.textContent).toBe('')
      expect(view.state.filterOpen).toBe(true)
      view.state.active = true
      await settle()
      const editor = view.find('设置文本筛选')
      expect(editor.props['data-filter-edits']).toBe(1)
      expect(editor.props['data-filter-query']).toBe('匹配')
      expect(view.state.operatorOpen).toBe(false)
      expect(view.overlays.textContent).not.toContain('全选')
      dispatchCatalogEvent(view.find('应用筛选'), 'onClick')
      await settle()
      expect(view.summary).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedCount: 0,
          visibleCount: 2,
          filterCount: 1,
        }),
      )
      view.state.active = false
      await settle()
      view.state.active = true
      await settle()
      expect(view.overlays.textContent).toBe('')
      const row = findCatalogElement(
        view.root,
        (node) => node.props['data-queue-drop-id'] === 'one',
      )
      expect(() => findCatalogElement(row, (node) => node.tag === 'input')).toThrow()
      view.unmount()
    },
  )

  it('selects matching platform tracks, shares partial state across views, and restores bulk actions', async () => {
    const otherTrack: Track = {
      ...tracks[1]!,
      id: 'other-platform',
      source: { ...tracks[1]!.source, pluginId: 'b' },
    }
    const test = mountQueue([...tracks, otherTrack])
    test.select('one')
    test.state.arrangementMode = 'platform'
    await settle()
    const platformCheckbox = (id: string) =>
      findCatalogElement(
        findCatalogElement(test.root, (node) => node.props['data-queue-drop-id'] === id),
        (node) => node.tag === 'input',
      )
    expect(test.operatorAvailable).toHaveBeenLastCalledWith(true)
    expect(test.overlays.textContent).toContain('下载已选')
    expect(platformCheckbox('a').props.indeterminate).toBe(true)
    dispatchCatalogEvent(platformCheckbox('a'), 'onChange')
    await settle()
    expect(platformCheckbox('a').props.checked).toBe(true)
    expect(platformCheckbox('b').props.checked).toBe(false)
    expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(3)
    dispatchCatalogEvent(platformCheckbox('a'), 'onChange')
    await settle()
    expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(0)
    // 平台勾选只操作应用筛选后的歌曲，隐藏歌曲保留在待听中。
    test.state.filterOpen = true
    await settle()
    dispatchCatalogEvent(test.find('设置文本筛选'), 'onClick')
    await settle()
    dispatchCatalogEvent(test.find('应用筛选'), 'onClick')
    await settle()
    dispatchCatalogEvent(platformCheckbox('a'), 'onChange')
    await settle()
    expect(test.summary.mock.lastCall?.[0]).toMatchObject({ selectedCount: 2, visibleCount: 2 })
    expect(test.play).not.toHaveBeenCalled()
    expect(test.movePlatform).not.toHaveBeenCalled()
    dispatchCatalogEvent(test.find('下载已选下载'), 'onClick')
    await settle()
    expect(test.download).toHaveBeenCalledExactlyOnceWith([tracks[0], tracks[2]])
    await settle()
    expect(platformCheckbox('a').props.checked).toBe(false)
    dispatchCatalogEvent(platformCheckbox('a'), 'onChange')
    await settle()
    dispatchCatalogEvent(test.find('添加喜欢添加喜欢'), 'onClick')
    await settle()
    expect(test.favoriteMany).toHaveBeenCalledExactlyOnceWith([tracks[0], tracks[2]])
    expect(test.remove).not.toHaveBeenCalled()
    test.unmount()
  })
  it.each(['flat', 'platform'] as const)(
    'keeps short artwork presses and the independent checkbox selecting once in %s view',
    async (mode) => {
      const test = mountQueue()
      if (mode === 'platform') {
        test.state.arrangementMode = mode
        await settle()
        dispatchCatalogEvent(
          findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'a'),
          'onClick',
        )
        await settle()
      }
      const row = findCatalogElement(
        test.root,
        (node) => node.props['data-queue-drop-id'] === 'one',
      )
      const cover = findCatalogElement(row, (node) => 'data-queue-handle' in node.props)
      expect(cover.textContent).toBe('')
      expect(cover.props.title).toContain('长按封面拖动排序')
      dispatchCatalogEvent(cover, 'onClick')
      await settle()
      expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(1)
      const checkbox = findCatalogElement(row, (node) => node.tag === 'input')
      expect(checkbox.props.checked).toBe(true)
      dispatchCatalogEvent(checkbox, 'onChange')
      await settle()
      expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(0)
      expect(test.play).not.toHaveBeenCalled()
      expect(test.move).not.toHaveBeenCalled()
      test.unmount()
    },
  )
  it('opens only the chosen source, scopes bulk actions, and returns through the shared heading', async () => {
    const otherTrack: Track = {
      ...tracks[1]!,
      id: 'other-platform',
      source: { ...tracks[1]!.source, pluginId: 'b' },
    }
    const test = mountQueue([...tracks, otherTrack])
    expect(test.operatorAvailable).toHaveBeenLastCalledWith(true)
    test.select(otherTrack.id)
    await settle()
    test.state.arrangementMode = 'platform'
    await settle()
    expect(test.operatorAvailable).toHaveBeenLastCalledWith(true)
    expect(test.overlays.textContent).toContain('下载已选')
    const entry = findCatalogElement(
      test.root,
      (node) => node.props['data-collection-entry'] === 'a',
    )
    dispatchCatalogEvent(entry, 'onClick')
    await settle()
    expect(test.operatorAvailable).toHaveBeenLastCalledWith(true)
    const view = findCatalogElement(
      test.root,
      (node) => node.props['data-queue-platform-view'] === 'a',
    )
    expect(view.textContent).toContain('匹配歌曲 one')
    expect(view.textContent).toContain('其他歌曲')
    expect(view.textContent).not.toContain('平台 B')
    expect(test.play).not.toHaveBeenCalled()
    expect(test.summary.mock.lastCall?.[0]).toMatchObject({
      selectedCount: 0,
      visibleCount: 3,
      totalCount: 3,
    })
    const heading = findCatalogElement(test.root, (node) =>
      String(node.props.class).includes('queue-platform-heading'),
    )
    expect(heading.textContent).toContain('待听')
    expect(heading.textContent).toContain('共 3 首')
    expect(heading.textContent).toContain('平台 A')
    expect(heading.textContent).toContain('展示方式')
    expect(view.textContent).not.toContain('平台切换')
    expect(view.textContent).not.toContain('把喜欢的音乐排进下一段时光')
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.props['aria-label'] === '全选当前 3 首匹配歌曲',
      ),
      'onChange',
    )
    await settle()
    expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(3)
    dispatchCatalogEvent(test.find('下载已选下载'), 'onClick')
    await settle()
    expect(test.download).toHaveBeenCalledExactlyOnceWith(tracks)
    await settle()
    await test.openActions('three')
    dispatchCatalogEvent(test.find('组内置顶'), 'onClick')
    expect(test.pin).toHaveBeenCalledExactlyOnceWith('three', ['one', 'two', 'three'])
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(heading, (node) => node.props['aria-label'] === '返回按平台'),
      'onClick',
    )
    await settle()
    expect(
      findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'b'),
    ).toBeDefined()
    expect(test.summary.mock.lastCall?.[0]).toMatchObject({ visibleCount: 4, totalCount: 4 })
    expect(test.operatorAvailable).toHaveBeenLastCalledWith(true)
    expect(test.overlays.textContent).toContain('下载已选')
    test.unmount()
  })
  it('keeps an empty filtered source detail navigable and leaves after its final track is removed', async () => {
    const test = mountQueue([
      tracks[1]!,
      { ...tracks[0]!, source: { ...tracks[0]!.source, pluginId: 'b' } },
    ])
    test.state.arrangementMode = 'platform'
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'a'),
      'onClick',
    )
    await settle()
    test.state.filterOpen = true
    await settle()
    dispatchCatalogEvent(test.find('设置文本筛选'), 'onClick')
    await settle()
    dispatchCatalogEvent(test.find('应用筛选'), 'onClick')
    await settle()
    expect(test.root.textContent).toContain('没有匹配的待听歌曲')
    expect(test.root.textContent).toContain('返回按平台查看其他音乐源')
    expect(
      findCatalogElement(test.root, (node) => node.props['aria-label'] === '返回按平台'),
    ).toBeDefined()
    expect(test.summary.mock.lastCall?.[0]).toMatchObject({ visibleCount: 0, totalCount: 1 })
    test.state.items = test.state.items.filter((track) => track.source.pluginId !== 'a')
    await settle()
    expect(
      findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'b'),
    ).toBeDefined()
    test.unmount()
  })
  it('reuses display settings and collapses platform context while keeping return navigation', async () => {
    const test = mountQueue()
    test.state.arrangementMode = 'platform'
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'a'),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(test.root, (node) => node.props['aria-label'] === '选择歌曲展示方式'),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.props['data-display-section'] === 'arrangement',
      ),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(test.overlays, (node) => node.props['data-mode'] === 'density:compact'),
      'onClick',
    )
    await settle()
    expect(test.state.displayMode).toBe('compact')
    expect(test.root.textContent).toContain('共 3 首')
    dispatchCatalogEvent(
      findCatalogElement(test.root, (node) => node.props['aria-label'] === '收起列表信息'),
      'onClick',
    )
    await settle()
    expect(
      findCatalogElement(test.root, (node) => node.props.class === 'catalog-page__context').style
        .display,
    ).toBe('none')
    expect(
      findCatalogElement(test.root, (node) => node.props['aria-label'] === '展开列表信息').props[
        'aria-expanded'
      ],
    ).toBe(false)
    expect(test.root.textContent).toContain('展示方式')
    dispatchCatalogEvent(
      findCatalogElement(test.root, (node) => node.props['aria-label'] === '返回按平台'),
      'onClick',
    )
    await settle()
    expect(
      findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'a'),
    ).toBeDefined()
    expect(test.state.displayMode).toBe('compact')
    test.unmount()
  })
  it('updates playing and paused badges on the overview and the platform detail', async () => {
    const test = mountQueue()
    test.state.arrangementMode = 'platform'
    test.state.playbackState = { trackId: 'one', status: 'playing' }
    await settle()
    const entry = findCatalogElement(
      test.root,
      (node) => node.props['data-collection-entry'] === 'a',
    )
    expect(test.root.textContent).toContain('正在播放')
    dispatchCatalogEvent(entry, 'onClick')
    await settle()
    expect(test.root.textContent).toContain('正在播放')
    test.state.playbackState = { trackId: 'one', status: 'paused' }
    await settle()
    expect(test.root.textContent).toContain('已暂停')
    expect(test.root.textContent).not.toContain('正在播放')
    test.state.playbackState = { trackId: 'one', status: 'playing' }
    await settle()
    expect(test.root.textContent).toContain('正在播放')
    expect(test.root.textContent).not.toContain('已暂停')
    test.state.playbackState = undefined
    await settle()
    expect(test.root.textContent).not.toMatch(/正在播放|已暂停/)
    dispatchCatalogEvent(
      findCatalogElement(test.root, (node) => node.props['aria-label'] === '返回按平台'),
      'onClick',
    )
    await settle()
    expect(test.root.textContent).not.toMatch(/正在播放|已暂停/)
    test.unmount()
  })
  it('offers the same external favorite and download controls as search cards', async () => {
    const test = mountQueue()
    test.state.operatorOpen = false
    test.state.favoriteTrackIds.add('two')
    await settle()
    const row = findCatalogElement(test.root, (node) => node.props['data-queue-drop-id'] === 'two')
    const favorite = findCatalogElement(
      row,
      (node) => node.tag === 'button' && node.props['aria-label'] === '取消喜欢《其他歌曲》',
    )
    expect(favorite.props.disabled).toBe(false)
    expect(favorite.props['aria-pressed']).toBe(true)
    dispatchCatalogEvent(favorite, 'onClick')
    expect(test.favorite).toHaveBeenCalledExactlyOnceWith(tracks[1])
    const download = () =>
      findCatalogElement(row, (node) => node.tag === 'button' && node.textContent.includes('下载'))
    dispatchCatalogEvent(download(), 'onClick')
    expect(test.download).toHaveBeenCalledExactlyOnceWith([tracks[1]])
    test.state.downloadBusy = true
    await settle()
    expect(download().props.disabled).toBe(true)
    test.unmount()
  })
  it('reuses display preferences and switches arrangement directly from the toolbar', async () => {
    const test = mountQueue()
    dispatchCatalogEvent(
      findCatalogElement(
        test.root,
        (node) => node.tag === 'button' && node.textContent.includes('展示方式'),
      ),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.props['data-display-section'] === 'arrangement',
      ),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.tag === 'button' && node.props['data-mode'] === 'density:compact',
      ),
      'onClick',
    )
    await settle()
    expect(test.state.displayMode).toBe('compact')
    dispatchCatalogEvent(
      findCatalogElement(
        test.root,
        (node) => node.tag === 'button' && node.textContent.includes('展示方式'),
      ),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.props['data-display-section'] === 'arrangement',
      ),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.tag === 'button' && node.textContent.includes('一行两个'),
      ),
      'onClick',
    )
    await settle()
    expect(test.state.mobileColumns).toBe(2)
    dispatchCatalogEvent(
      findCatalogElement(
        test.root,
        (node) => node.tag === 'button' && node.textContent.includes('按平台'),
      ),
      'onClick',
    )
    expect(test.arrangement).toHaveBeenCalledExactlyOnceWith('platform')
    test.unmount()
  })
  it('keeps the overview toolbar during arrangement changes and replaces the page for platform navigation', async () => {
    const test = mountQueue()
    test.select('two')
    await settle()
    const overview = () =>
      findCatalogElement(test.root, (node) => node.props['data-collection-view'] === 'overview')
    const displayButton = () =>
      findCatalogElement(
        test.root,
        (node) => node.tag === 'button' && node.textContent.includes('展示方式'),
      )
    const initialOverview = overview()
    const initialDisplayButton = displayButton()
    const choose = async (mode: string) => {
      dispatchCatalogEvent(
        findCatalogElement(
          test.root,
          (node) => node.tag === 'button' && node.textContent.includes(mode),
        ),
        'onClick',
      )
      await settle()
    }
    await choose('按平台')
    expect(overview()).toBe(initialOverview)
    expect(displayButton()).toBe(initialDisplayButton)
    expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(1)
    const entry = findCatalogElement(
      test.root,
      (node) => node.props['data-collection-entry'] === 'a',
    )
    dispatchCatalogEvent(entry, 'onClick')
    await settle()
    const detail = findCatalogElement(
      test.root,
      (node) => node.props['data-queue-platform-view'] === 'a',
    )
    expect(detail).not.toBe(initialOverview)
    expect(displayButton()).not.toBe(initialDisplayButton)
    dispatchCatalogEvent(
      findCatalogElement(test.root, (node) => node.props['aria-label'] === '返回按平台'),
      'onClick',
    )
    await settle()
    const returnedOverview = overview()
    const returnedDisplayButton = displayButton()
    await choose('全部歌曲')
    expect(overview()).toBe(returnedOverview)
    expect(displayButton()).toBe(returnedDisplayButton)
    const row = findCatalogElement(test.root, (node) => node.props['data-queue-drop-id'] === 'two')
    expect(findCatalogElement(row, (node) => node.tag === 'input').props.checked).toBe(true)
    await choose('按平台')
    expect(overview()).toBe(returnedOverview)
    expect(displayButton()).toBe(returnedDisplayButton)
    expect(
      findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'a'),
    ).toBeDefined()
    expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(1)
    test.unmount()
  })
  it.each(['queue', 'favorites'] as const)(
    'keeps pinning last and respects %s boundaries',
    async (context) => {
      const test = mountQueue(tracks, context)
      await test.openActions('one')
      expect(
        findCatalogElement(
          test.overlays,
          (node) =>
            node.props['aria-label'] ===
            (context === 'queue' ? '待听顺序操作' : '喜欢歌曲顺序操作'),
        )
          .children.filter((node) => node.tag === 'button')
          .map((node) => node.textContent.replace(/\s+/g, '')),
      ).toEqual(['后移一首', '前移一首', '置顶'])
      expect(test.find('置顶').props.disabled).toBe(true)
      expect(test.find('前移一首').props.disabled).toBe(true)
      expect(test.find('后移一首').props.disabled).toBe(false)
      await test.openActions('three')
      expect(test.find('置顶').props.disabled).toBe(false)
      expect(test.find('前移一首').props.disabled).toBe(false)
      expect(test.find('后移一首').props.disabled).toBe(true)
      test.unmount()
    },
  )
  it('keeps the catalog primary actions and moves pinning to the ordering group', async () => {
    const test = mountQueue()
    await test.openActions('three')
    expect(test.overlays.textContent).toContain('自定义名称')
    expect(test.overlays.textContent).toContain('管理标签')
    expect(test.overlays.textContent).toContain('截取片段')
    expect(
      findCatalogElement(test.overlays, (node) => node.props['aria-label'] === '歌曲常用操作')
        .textContent,
    ).not.toContain('移出待听')
    expect(
      findCatalogElement(test.overlays, (node) => node.props['aria-label'] === '歌曲常用操作')
        .children.filter((node) => node.tag === 'button')
        .map((node) => node.textContent.replace(/\s+/g, '')),
    ).toEqual(['播放', '已待听', '喜欢', '下载'])
    dispatchCatalogEvent(test.find('置顶'), 'onClick')
    expect(test.pin).toHaveBeenCalledExactlyOnceWith('three', ['one', 'two', 'three'])
    await settle()
    await test.openActions('two')
    dispatchCatalogEvent(test.find('喜欢'), 'onClick')
    expect(test.favorite).toHaveBeenCalledExactlyOnceWith(tracks[1])
    await settle()
    await test.openActions('two')
    dispatchCatalogEvent(test.find('下载'), 'onClick')
    expect(test.download).toHaveBeenCalledExactlyOnceWith([tracks[1]])
    test.unmount()
  })
  it('forwards naming, tags, composition and removal from the shared action dialog', async () => {
    const test = mountQueue()
    await test.openActions('two')
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.tag === 'button' && node.textContent.includes('自定义名称'),
      ),
      'onClick',
    )
    await settle()
    const input = findCatalogElement(
      test.overlays,
      (node) => node.props.name === 'track-custom-name',
    )
    ;(input.props['onUpdate:modelValue'] as (value: string) => void)('通勤')
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(test.overlays, (node) => node.tag === 'form'),
      'onSubmit',
    )
    await settle()
    expect(test.rename).toHaveBeenCalledExactlyOnceWith(tracks[1], '通勤')
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.tag === 'button' && node.textContent.includes('管理标签'),
      ),
      'onClick',
    )
    await settle()
    const tagInput = findCatalogElement(
      test.overlays,
      (node) => node.props.name === 'catalog-track-tag',
    )
    ;(tagInput.props['onUpdate:modelValue'] as (value: string) => void)('通勤')
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(test.overlays, (node) => node.tag === 'form'),
      'onSubmit',
    )
    expect(test.addTag).toHaveBeenCalledExactlyOnceWith(tracks[1], '通勤')
    const back = findCatalogElement(
      test.overlays,
      (node) => node.tag === 'button' && node.textContent.trim() === '返回',
    )
    expect(back.parent?.props.class).toBe('track-actions-dialog__footer')
    expect(back.parent?.parent?.children.at(-1)).toBe(back.parent)
    expect(test.overlays.textContent).not.toContain('返回歌曲操作')
    dispatchCatalogEvent(back, 'onClick')
    await settle()
    expect(test.addTag).toHaveBeenCalledTimes(1)
    expect(test.rename).toHaveBeenCalledTimes(1)
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.tag === 'button' && node.textContent.includes('截取片段'),
      ),
      'onClick',
    )
    expect(test.compose).toHaveBeenCalledExactlyOnceWith(tracks[1])
    await settle()
    await test.openActions('two')
    confirmation.mockResolvedValueOnce(false)
    dispatchCatalogEvent(test.find('已待听'), 'onClick')
    await settle()
    expect(confirmation).toHaveBeenCalledWith(expect.objectContaining({ title: '移出待听' }))
    expect(test.remove).not.toHaveBeenCalled()
    await test.openActions('two')
    dispatchCatalogEvent(test.find('已待听'), 'onClick')
    await settle()
    expect(test.remove).toHaveBeenCalledExactlyOnceWith(['two'])
    expect(test.queue).not.toHaveBeenCalled()
    test.unmount()
  })
  it('offers favorites and playlists, hides existing queue action and respects download busy state', async () => {
    const test = mountQueue()
    test.select('two')
    await settle()
    expect(test.overlays.textContent).toContain('添加喜欢')
    expect(test.overlays.textContent).toContain('加入歌单')
    expect(test.overlays.textContent).not.toContain('添加待听')
    expect(test.overlays.textContent).not.toContain('移出已选')
    test.state.downloadBusy = true
    await settle()
    expect(test.find('下载处理中…处理中…').props.disabled).toBe(true)
    test.state.downloadBusy = false
    await settle()
    dispatchCatalogEvent(test.find('下载已选下载'), 'onClick')
    await settle()
    expect(test.download).toHaveBeenCalledExactlyOnceWith([tracks[1]])
    await settle()
    expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(0)
    test.unmount()
  })
  it('keeps the applied list on cancel, applies filters transactionally, and reorders with visible IDs', async () => {
    const test = mountQueue()
    test.select('two')
    await settle()
    test.state.filterOpen = true
    await settle()
    dispatchCatalogEvent(test.find('设置文本筛选'), 'onClick')
    await settle()
    expect(test.summary.mock.lastCall?.[0].visibleCount).toBe(3)
    dispatchCatalogEvent(test.find('取消'), 'onClick')
    await settle()
    expect(test.summary.mock.lastCall?.[0].visibleCount).toBe(3)
    test.state.filterOpen = true
    await settle()
    dispatchCatalogEvent(test.find('设置文本筛选'), 'onClick')
    await settle()
    dispatchCatalogEvent(test.find('应用筛选'), 'onClick')
    await settle()
    expect(test.summary.mock.lastCall?.[0]).toEqual({
      selectedCount: 0,
      visibleCount: 2,
      totalCount: 3,
      filterCount: 1,
    })
    const handle = findCatalogElement(
      test.root,
      (node) =>
        node.tag === 'button' &&
        String(node.props['aria-label']).includes('选择歌曲 匹配歌曲 three；') &&
        'data-queue-handle' in node.props,
    )
    const handlers = handle.props.onKeydown as ((event: unknown) => void)[]
    handlers.forEach((handler) =>
      handler({ key: 'ArrowUp', preventDefault() {}, stopPropagation() {} }),
    )
    expect(test.move).toHaveBeenCalledExactlyOnceWith('three', 'one', ['one', 'three'])
    test.unmount()
  })
  it('requires download confirmation and ignores a pending confirmation after unmount', async () => {
    const test = mountQueue()
    test.select('one')
    await settle()
    confirmation.mockResolvedValueOnce(false)
    dispatchCatalogEvent(test.find('下载已选下载'), 'onClick')
    await settle()
    expect(test.download).not.toHaveBeenCalled()
    expect(test.summary.mock.lastCall?.[0].selectedCount).toBe(1)
    let resolve: (value: boolean) => void = vi.fn()
    confirmation.mockReturnValueOnce(
      new Promise<boolean>((done) => {
        resolve = done
      }),
    )
    dispatchCatalogEvent(test.find('下载已选下载'), 'onClick')
    test.unmount()
    resolve(true)
    await settle()
    expect(test.download).not.toHaveBeenCalled()
  })
})

describe('FavoritePanel shared collection interactions', () => {
  it('queues selected favorites in selection order and keeps cancellation in individual actions', async () => {
    const test = mountQueue(tracks, 'favorites')
    test.select('three')
    test.select('one')
    await settle()
    dispatchCatalogEvent(test.find('添加待听添加待听'), 'onClick')
    expect(test.queueMany).not.toHaveBeenCalled()
    await settle()
    expect(confirmation).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '添加到待听', confirmLabel: '添加 2 首' }),
    )
    expect(test.queueMany).toHaveBeenCalledExactlyOnceWith([tracks[2], tracks[0]])
    expect(test.remove).not.toHaveBeenCalled()
    await settle()
    test.select('two')
    await settle()
    expect(test.overlays.textContent).not.toContain('添加喜欢')
    expect(test.overlays.textContent).not.toContain('取消喜欢取消喜欢')
    await test.openActions('two')
    dispatchCatalogEvent(test.find('已喜欢'), 'onClick')
    await settle()
    expect(confirmation).toHaveBeenCalledOnce()
    expect(test.remove).toHaveBeenCalledExactlyOnceWith(['two'])
    test.unmount()
  })
  it('queues a favorite, plays the filtered collection and adds selection to a chosen playlist', async () => {
    const test = mountQueue(tracks, 'favorites')
    test.state.filterOpen = true
    await settle()
    dispatchCatalogEvent(test.find('设置文本筛选'), 'onClick')
    await settle()
    dispatchCatalogEvent(test.find('应用筛选'), 'onClick')
    await settle()
    await test.openActions('three')
    dispatchCatalogEvent(test.find('待听'), 'onClick')
    expect(test.queue).toHaveBeenCalledExactlyOnceWith(tracks[2])
    expect(test.remove).not.toHaveBeenCalled()
    expect(confirmation).not.toHaveBeenCalled()
    await settle()
    await test.openActions('three')
    dispatchCatalogEvent(test.find('播放'), 'onClick')
    expect(test.playCollection).toHaveBeenCalledExactlyOnceWith(tracks[2], [tracks[0], tracks[2]])
    expect(test.play).not.toHaveBeenCalled()
    await settle()
    test.select('one')
    await settle()
    expect(test.overlays.textContent).not.toContain('请先创建歌单')
    dispatchCatalogEvent(test.find('加入歌单加入歌单'), 'onClick')
    await settle()
    const target = findCatalogElement(
      test.overlays,
      (node) =>
        node.tag === 'input' && String(node.props['aria-label'] ?? '').startsWith('选择歌单 '),
    )
    dispatchCatalogEvent(target, 'onChange')
    await settle()
    dispatchCatalogEvent(
      findCatalogElement(
        test.overlays,
        (node) => node.tag === 'button' && node.textContent.includes('加入歌单（1）'),
      ),
      'onClick',
    )
    await settle()
    expect(test.addToPlaylist).toHaveBeenCalledExactlyOnceWith('playlist', [tracks[0]])
    test.unmount()
  })
})
