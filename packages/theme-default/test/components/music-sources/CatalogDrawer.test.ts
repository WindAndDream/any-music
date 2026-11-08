import type { Track } from '@any-music/core'
import {
  provideCatalogFilterHistory,
  provideConfirmationDialog,
  provideTrackNames,
} from '@any-music/ui'
import type { CatalogDrawerView } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CatalogDrawer from '../../../src/components/music-sources/CatalogDrawer.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// 真实筛选和选择交互在 Node 宿主执行；只替换需要浏览器的浮层与转场。
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_props, { slots }) =>
      () =>
        slots.default?.(),
  })
  const group = vue.defineComponent({
    props: ['tag'],
    setup:
      (props, { slots }) =>
      () =>
        vue.h(props.tag ?? 'div', slots.default?.()),
  })
  return { ...vue, Transition: passthrough, TransitionGroup: group, Teleport: passthrough }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      inheritAttrs: false,
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? vue.h('section', { 'aria-label': props.title }, [slots.default?.(), slots.footer?.()])
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      inheritAttrs: false,
      setup:
        (props, { slots }) =>
        () =>
          props.open ? vue.h('aside', { 'aria-label': props.title }, slots.default?.()) : null,
    }),
  }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open'],
      inheritAttrs: false,
      setup:
        (props, { slots }) =>
        () =>
          props.open ? slots.default?.() : null,
    }),
  }
})
beforeEach(() => {
  vi.stubGlobal('Element', CatalogTestElement)
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())

function createTrack(id: string, title: string): Track {
  return {
    id,
    title,
    artists: [],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: id },
  }
}

function mountDrawer(operatorOpen = true) {
  const drawer = shallowRef<CatalogDrawerView>({
    id: 'drawer:1',
    pluginId: 'test',
    pluginName: '测试源',
    kind: 'search',
    input: '音乐',
    title: '音乐',
    isExpanded: true,
    isSourceEnabled: true,
    tracks: [createTrack('morning', '晨间'), createTrack('night', '夜曲')],
    total: 100,
    loadedPageCount: 1,
    hasMore: true,
    isLoading: false,
    status: 'ready',
    errorMessage: '',
    invalidReason: '',
  })
  const filterOpen = shallowRef(false)
  const active = shallowRef(true)
  const onSummaryChange = vi.fn()
  const onDownloadSelected = vi.fn()
  const onAddSelectedToQueue = vi.fn()
  const onLoadMore = vi.fn()
  const onRestoreNames = vi.fn()
  const onToggleAllVisible = vi.fn()
  const customNames = shallowRef<ReadonlyMap<string, string>>(new Map())
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const host = defineComponent({
    setup() {
      confirmation = provideConfirmationDialog()
      provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
      provideTrackNames(customNames)
      return () =>
        h(CatalogDrawer, {
          key: drawer.value.id,
          drawer: drawer.value,
          active: active.value,
          invalidTrackIds: new Set<string>(),
          favoriteTrackIds: new Set<string>(),
          customTagsByTrackId: new Map<string, readonly string[]>(),
          playlists: [],
          displayMode: 'standard',
          mobileColumns: 1,
          filterOpen: filterOpen.value,
          operatorOpen,
          overlayTarget: new CatalogTestElement('overlay') as unknown as HTMLElement,
          operatorOverlayTarget: new CatalogTestElement('operator') as unknown as HTMLElement,
          onCloseFilter: () => {
            filterOpen.value = false
          },
          onSummaryChange,
          onDownloadSelected,
          onAddSelectedToQueue,
          onLoadMore,
          onRestoreNames,
          onToggleAllVisible,
        })
    },
  })
  return {
    ...mountCatalogComponent(host, {}),
    drawer,
    filterOpen,
    active,
    confirmation,
    onSummaryChange,
    onDownloadSelected,
    onAddSelectedToQueue,
    onLoadMore,
    onRestoreNames,
    onToggleAllVisible,
    customNames,
  }
}

function clickText(root: CatalogTestElement, text: string): void {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.tag === 'button' && node.textContent.includes(text)),
    'onClick',
  )
}

function toggleAll(root: CatalogTestElement, visibleCount: number): void {
  dispatchCatalogEvent(
    findCatalogElement(
      root,
      (node) => node.props['aria-label'] === `全选当前 ${visibleCount} 首匹配歌曲`,
    ),
    'onChange',
  )
}

describe('CatalogDrawer track summary', () => {
  it('enqueues in selection order, appends select-all additions and clears the selection', async () => {
    const view = mountDrawer()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'input' && node.props['aria-label'] === '选择歌曲 夜曲',
      ),
      'onChange',
    )
    await nextTick()
    toggleAll(view.root, 2)
    await nextTick()
    clickText(view.root, '添加待听')
    expect(view.confirmation.activeRequest.value).toMatchObject({
      title: '添加到待听',
      confirmLabel: '添加 2 首',
    })
    expect(view.onAddSelectedToQueue).not.toHaveBeenCalled()
    view.confirmation.cancel()
    await nextTick()
    expect(view.onSummaryChange.mock.lastCall?.[0].selectedCount).toBe(2)
    clickText(view.root, '添加待听')
    view.confirmation.accept()
    await nextTick()
    expect(view.onAddSelectedToQueue).toHaveBeenCalledExactlyOnceWith([
      view.drawer.value.tracks[1],
      view.drawer.value.tracks[0],
    ])
    await nextTick()
    expect(view.onSummaryChange.mock.lastCall?.[0].selectedCount).toBe(0)
    view.unmount()
  })
  it('moves a deselected and reselected track to the end of the batch', async () => {
    const view = mountDrawer()
    toggleAll(view.root, 2)
    await nextTick()
    const toggleMorning = (label: string) => {
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'input' && node.props['aria-label'] === label,
        ),
        'onChange',
      )
    }
    toggleMorning('取消选择歌曲 晨间')
    await nextTick()
    toggleMorning('选择歌曲 晨间')
    await nextTick()
    clickText(view.root, '添加待听')
    view.confirmation.accept()
    await nextTick()
    expect(view.onAddSelectedToQueue.mock.lastCall?.[0].map((track: Track) => track.id)).toEqual([
      'night',
      'morning',
    ])
    view.unmount()
  })
  it('downloads a single row with its list origin without changing selection', async () => {
    const view = mountDrawer(false)
    clickText(view.root, '下载')
    expect(view.onDownloadSelected).toHaveBeenCalledExactlyOnceWith(
      [view.drawer.value.tracks[0]],
      view.drawer.value.id,
    )
    expect(view.onSummaryChange.mock.lastCall?.[0].selectedCount).toBe(0)
    view.unmount()
  })
  it('reports operator select-all and deselect-all separately from row selection', async () => {
    const view = mountDrawer()
    toggleAll(view.root, 2)
    await nextTick()
    toggleAll(view.root, 2)
    await nextTick()
    expect(view.onToggleAllVisible.mock.calls).toEqual([[2], [0]])
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 0,
      visibleCount: 2,
      totalCount: 2,
    })
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '选择歌曲 晨间'),
      'onChange',
    )
    await nextTick()
    expect(view.onToggleAllVisible).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('keeps an empty source page with further pages distinct from exhausted results', async () => {
    const view = mountDrawer()
    view.drawer.value = { ...view.drawer.value, tracks: [], total: undefined }
    await nextTick()
    expect(view.root.textContent).toContain('当前页没有可用歌曲，请滚动继续加载。')
    expect(view.onLoadMore).not.toHaveBeenCalled()
    expect(view.root.textContent).not.toContain('加载更多歌曲')
    view.drawer.value = { ...view.drawer.value, hasMore: false }
    await nextTick()
    expect(view.root.textContent).toContain('当前结果中没有可用歌曲。')
    expect(view.root.textContent).not.toContain('加载更多歌曲')
    view.unmount()
  })

  it('shows restore only while the selection contains a custom name, including live name changes', async () => {
    const view = mountDrawer()
    expect(view.root.textContent).not.toContain('恢复原名')
    toggleAll(view.root, 2)
    await nextTick()
    expect(view.root.textContent).not.toContain('恢复原名')
    view.customNames.value = new Map([['morning', '通勤音乐']])
    await nextTick()
    expect(view.root.textContent).toContain('恢复原名')
    view.customNames.value = new Map()
    await nextTick()
    expect(view.root.textContent).not.toContain('恢复原名')
    view.customNames.value = new Map([['morning', '通勤音乐']])
    await nextTick()
    clickText(view.root, '恢复原名')
    expect(view.onRestoreNames).toHaveBeenCalledExactlyOnceWith(['morning'])
    await nextTick()
    expect(view.root.textContent).not.toContain('恢复原名')
    view.unmount()
  })
  it('filters custom naming through an isolated draft and restores only renamed selections', async () => {
    const view = mountDrawer()
    view.customNames.value = new Map([['morning', '通勤音乐']])
    view.filterOpen.value = true
    await nextTick()
    clickText(view.root, '命名筛选')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'input' && node.props.value === 'custom',
      ),
      'onChange',
    )
    await nextTick()
    clickText(view.root, '确定')
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 0,
      visibleCount: 2,
      totalCount: 2,
    })
    clickText(view.root, '应用筛选')
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 0,
      visibleCount: 1,
      totalCount: 2,
    })
    toggleAll(view.root, 1)
    await nextTick()
    view.active.value = false
    await nextTick()
    expect(view.root.textContent).not.toContain('继续查找匹配歌曲')
    expect(view.onLoadMore).not.toHaveBeenCalled()
    view.active.value = true
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 1,
      visibleCount: 1,
      totalCount: 2,
    })
    expect(view.root.textContent).not.toContain('继续查找匹配歌曲')
    expect(view.onLoadMore).not.toHaveBeenCalled()
    clickText(view.root, '恢复原名')
    expect(view.onRestoreNames).toHaveBeenCalledExactlyOnceWith(['morning'])
    view.customNames.value = new Map()
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 0,
      visibleCount: 0,
      totalCount: 2,
    })
    view.unmount()
  })
  it('keeps disconnected tracks visible and selectable without a manual pagination action', async () => {
    const view = mountDrawer()
    view.drawer.value = {
      ...view.drawer.value,
      status: 'disconnected',
      isSourceEnabled: false,
      errorCode: 'network-error',
      errorMessage: '旧错误',
    }
    await nextTick()
    expect(view.root.textContent).toContain('晨间')
    expect(view.root.textContent).toContain('夜曲')
    expect(view.root.textContent).toContain('已保留 2 首歌曲供查看')
    expect(view.root.textContent).not.toContain('加载更多歌曲')
    expect(view.root.textContent).not.toContain('旧错误')
    toggleAll(view.root, 2)
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 2,
      visibleCount: 2,
      totalCount: 2,
    })
    expect(view.onLoadMore).not.toHaveBeenCalled()
    view.unmount()
  })

  it('counts applied matches and selections, excluding drafts and unloaded source totals', async () => {
    const view = mountDrawer()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 0,
      visibleCount: 2,
      totalCount: 2,
    })
    toggleAll(view.root, 2)
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 2,
      visibleCount: 2,
      totalCount: 2,
    })

    async function enterFilter(query: string): Promise<void> {
      view.filterOpen.value = true
      await nextTick()
      clickText(view.root, '搜索筛选')
      await nextTick()
      const input = findCatalogElement(
        view.root,
        (node) => node.tag === 'input' && node.props.type === 'search',
      )
      input.value = query
      input.dispatchListeners('input', { target: input })
      await nextTick()
      clickText(view.root, '确定')
      await nextTick()
    }

    await enterFilter('夜曲')
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 2,
      visibleCount: 2,
      totalCount: 2,
    })
    clickText(view.root, '取消')
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 2,
      visibleCount: 2,
      totalCount: 2,
    })

    await enterFilter('夜曲')
    clickText(view.root, '应用筛选')
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 1,
      visibleCount: 1,
      totalCount: 2,
    })

    view.drawer.value = {
      ...view.drawer.value,
      tracks: [...view.drawer.value.tracks, createTrack('night:2', '夜曲现场')],
    }
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 1,
      visibleCount: 2,
      totalCount: 3,
    })

    view.drawer.value = {
      ...view.drawer.value,
      id: 'drawer:2',
      tracks: [createTrack('new', '新歌曲')],
    }
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 0,
      visibleCount: 1,
      totalCount: 1,
    })
    view.unmount()
  })

  it('preserves selection on cancelled download and clears the summary only after confirmation', async () => {
    const view = mountDrawer()
    toggleAll(view.root, 2)
    await nextTick()
    clickText(view.root, '下载已选')
    expect(view.onDownloadSelected).not.toHaveBeenCalled()
    view.confirmation.cancel()
    await nextTick()
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 2,
      visibleCount: 2,
      totalCount: 2,
    })
    clickText(view.root, '下载已选')
    view.confirmation.accept()
    await Promise.resolve()
    await nextTick()
    expect(view.onDownloadSelected).toHaveBeenCalledExactlyOnceWith(
      view.drawer.value.tracks,
      'drawer:1',
    )
    expect(view.onSummaryChange).toHaveBeenLastCalledWith({
      selectedCount: 0,
      visibleCount: 2,
      totalCount: 2,
    })
    view.unmount()
  })
})
