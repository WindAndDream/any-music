import type { DownloadHistoryItem, PlaybackHistoryEntry, Track } from '@any-music/core'
import { createCatalogTrackFilterState, UI_CONTRIBUTIONS } from '@any-music/ui'
import {
  createEditingSession,
  provideConfirmationDialog,
  provideEditingSession,
} from '@any-music/ui/library'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowRef } from 'vue'
import type { Component, ShallowRef } from 'vue'

import ClassicDownloads from '../../../src/components/downloads/ClassicDownloads.vue'
import ClassicHistory from '../../../src/components/library/ClassicHistory.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
} from '../../helpers/test-renderer'
import { mountMeasuredThemeGrid } from '../../helpers/virtual-grid-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const transition = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { attrs, slots }) =>
      () =>
        vue.h('div', { onAfterLeave: attrs.onAfterLeave }, slots.default?.()),
  })
  return { ...vue, Teleport: vue.Fragment, Transition: transition, TransitionGroup: transition }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? vue.h('aside', slots.default?.()) : null,
    }),
  }
})

beforeEach(() => {
  vi.stubEnv('MODE', 'dev')
  vi.stubGlobal('HTMLElement', CatalogTestElement)
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', EventTarget)
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      matchMedia: () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    }),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const tracks: Track[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: `track-${index}`,
  title: `歌曲 ${index}`,
  artists: [],
  source: {
    pluginId: index % 2 ? 'second' : 'first',
    resourceId: String(index),
    mediaKind: 'audio',
  },
}))
const ids = tracks.map((_, index) => `task-${index}`)
const commonState = {
  tracks,
  mobileLayout: false,
  invalidTrackIds: [],
  favoriteTrackIds: [],
  queuedTrackIds: [],
  platformNames: new Map([
    ['first', '第一音乐源'],
    ['second', '第二音乐源'],
  ]),
  customNamesByTrackId: new Map(),
  customTagsByTrackId: new Map(),
}
function commonActions() {
  return {
    play: vi.fn(),
    toggleFavorite: vi.fn(),
    enqueue: vi.fn(),
    rename: vi.fn(),
    addToPlaylist: vi.fn(),
    useAsMaterial: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
  }
}
const ready = { availability: { status: 'available' }, status: { status: 'ready' } } as const

function mount<T>(component: Component, feature: ShallowRef<T>) {
  const editing = createEditingSession()
  const view = mountMeasuredThemeGrid(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        provideConfirmationDialog()
        provide(UI_CONTRIBUTIONS, { resolve: () => [], accepts: () => false })
        return () => h(component, { feature: feature.value })
      },
    }),
    () => 3,
    144,
  )
  vi.stubGlobal(
    'document',
    Object.assign(view.document, {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
  return {
    ...view,
    cells: () => view.root.querySelectorAll('[data-occurrence]'),
    button: (label: string) =>
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.props['aria-label'] === label,
      ),
    close() {
      view.unmount()
      editing.dispose()
    },
  }
}
async function settle() {
  await nextTick()
  await vi.dynamicImportSettled()
  await nextTick()
}

function mountDownloads() {
  type Feature = UiThemeFeatureMap['downloads']
  const items: DownloadHistoryItem[] = tracks.map((track, index) => ({
    id: ids[index]!,
    track,
    status: index % 2 ? 'succeeded' : 'downloading',
    savedAtMs: index % 2 ? 2 : undefined,
    requestedAtMs: 1,
    maxRetryCount: 0,
    attempts: [],
    progressMessage: '正在处理',
  }))
  const actions = {
    ...commonActions(),
    applyFilters: vi.fn(),
    cancelFilters: vi.fn(),
    showTrackActions: vi.fn(),
    setFilterDraft: vi.fn(),
    setDisplayMode: vi.fn(),
    setMobileColumns: vi.fn(),
    select: vi.fn((itemIds: readonly string[]) => update({ selectedItemIds: itemIds })),
    moveItem: vi.fn<Feature['actions']['moveItem']>((id, target, visibleIds) => {
      const order = [...visibleIds]
      order.splice(order.indexOf(target), 0, ...order.splice(order.indexOf(id), 1))
      update({ itemOrder: order })
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    retry: vi.fn(),
    setStatusFilter: vi.fn((statusFilter: Feature['state']['statusFilter']) =>
      update({ statusFilter }),
    ),
  }
  const feature = shallowRef<Feature>({
    ...ready,
    state: {
      ...commonState,
      batches: [
        {
          id: 'batch',
          origin: { kind: 'queue', label: '待听' },
          status: 'running',
          startedAtMs: 1,
          concurrency: 2,
          items,
        },
      ],
      downloadedTrackIds: [],
      itemOrder: ids,
      selectedItemIds: [],
      concurrency: 2,
      statusFilter: 'all',
      displayMode: 'standard',
      mobileColumns: 1,
      filters: createCatalogTrackFilterState(),
      filterDraft: null,
      addedAtMsByTrackId: new Map(),
    },
    actions,
  })
  function update(state: Partial<Feature['state']>) {
    feature.value = { ...feature.value, state: { ...feature.value.state, ...state } }
  }
  return { ...mount(ClassicDownloads, feature), actions, feature, update }
}

it('windows downloads, keeps current progress live, and selects all tasks in the status filter', async () => {
  const test = mountDownloads()
  try {
    await settle()
    expect(test.cells().length).toBeGreaterThan(0)
    expect(test.cells().length).toBeLessThan(30)
    expect(test.cells()[0]!.props['aria-setsize']).toBe(1_000)
    const batch = test.feature.value.state.batches[0]!
    const items = [...batch.items]
    items[0] = { ...items[0]!, progressMessage: '正在编码' }
    test.update({ batches: [{ ...batch, items }] })
    await settle()
    expect(test.cells()[0]!.textContent).toContain('正在编码')
    expect(test.actions.pause).not.toHaveBeenCalled()
    expect(test.actions.resume).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(
        test.root,
        (node) => node.tag === 'button' && node.textContent.startsWith('已下载 500'),
      ),
      'onClick',
    )
    await settle()
    expect(test.cells()[0]!.props['aria-setsize']).toBe(500)
    dispatchCatalogEvent(test.button('操作器 已选 0'), 'onClick')
    await nextTick()
    dispatchCatalogEvent(
      test.root.querySelector('[aria-label="全选当前匹配下载任务"]')!,
      'onChange',
    )
    expect(test.actions.select).toHaveBeenLastCalledWith(ids.filter((_, index) => index % 2))
    expect(test.actions.cancel).not.toHaveBeenCalled()
    expect(test.actions.retry).not.toHaveBeenCalled()
  } finally {
    test.close()
  }
})

it('reorders downloads through immutable snapshots, keeping task identity and keyboard focus', async () => {
  const test = mountDownloads()
  try {
    await settle()
    const source = test.cells()[0]!
    const handle = source.querySelector('[data-queue-handle]')!
    handle.focus()
    function shift(key: 'ArrowDown' | 'ArrowUp') {
      const handlers = handle.props.onKeydown as ((event: unknown) => void)[]
      for (const handler of handlers) handler({ key, preventDefault() {}, stopPropagation() {} })
    }
    shift('ArrowDown')
    await settle()
    expect(test.actions.moveItem).toHaveBeenLastCalledWith(ids[0], ids[1], ids)
    expect(test.cells()[1]).toBe(source)
    expect(test.document.activeElement).toBe(handle)
    shift('ArrowUp')
    await settle()
    expect(test.actions.moveItem).toHaveBeenLastCalledWith(ids[0], ids[1], [
      ids[1],
      ids[0],
      ...ids.slice(2),
    ])
    expect(test.cells()[0]).toBe(source)
    expect(test.document.activeElement).toBe(handle)
  } finally {
    test.close()
  }
})

it('retains an offscreen download action opener until the dialog finishes closing', async () => {
  const test = mountDownloads()
  try {
    await settle()
    const source = test.cells()[0]!
    const mountedIds = () => test.cells().map((cell) => cell.dataset.occurrence)
    dispatchCatalogEvent(source.querySelector('[data-card-menu]')!, 'onClick')
    await settle()
    const dialog = test.root.querySelector('[role="dialog"]')!
    const transition = dialog.parent!.parent!
    test.scroll.scrollTop = 8_000
    test.scroll.dispatchEvent(new Event('scroll'))
    await settle()
    expect(test.cells().includes(source)).toBe(true)
    dispatchCatalogEvent(dialog.querySelector('[aria-label="关闭"]')!, 'onClick')
    await settle()
    expect(test.cells().includes(source)).toBe(true)
    await (transition.props.onAfterLeave as () => Promise<void>)()
    await settle()
    expect(mountedIds()).not.toContain(ids[0])
  } finally {
    test.close()
  }
})

it.each([
  [0, 3],
  [3, 0],
])('drags task %i to %i using virtual placements', async (from, to) => {
  const test = mountDownloads()
  try {
    await settle()
    vi.useFakeTimers()
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const source = test.cells()[from]!
    const handle = source.querySelector('[data-queue-handle]')!
    const section = findCatalogElement(test.root, (node) => node.props['aria-label'] === '下载任务')
    const bounds = (section as unknown as HTMLElement).getBoundingClientRect()
    Object.assign(section, {
      getBoundingClientRect: () => ({ ...bounds, height: 600, bottom: bounds.top + 600 }),
    })
    const pointer = (index: number) => ({
      button: 0,
      pointerId: 1,
      isPrimary: true,
      clientX: 100,
      clientY: 96 + Math.floor(index / 3) * 156,
      target: handle,
      currentTarget: handle,
      preventDefault() {},
      stopPropagation() {},
    })
    ;(handle.props.onPointerdown as (event: unknown) => void)(pointer(from))
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(source.hasAttribute('data-am-grid-source')).toBe(true)
    section.dispatchListeners('pointerup', pointer(to))
    await nextTick()
    expect(test.actions.moveItem).toHaveBeenCalledExactlyOnceWith(ids[from], ids[to], ids)
    expect(test.cells()[to]).toBe(source)
    expect(source.hasAttribute('data-am-grid-source')).toBe(false)
    expect(test.actions.play).not.toHaveBeenCalled()
  } finally {
    test.close()
    vi.useRealTimers()
  }
})

it('windows history by playback occurrence and preserves the complete playback order in a platform', async () => {
  const entries: PlaybackHistoryEntry[] = tracks.map((track, index) => ({
    id: `play-${index}`,
    trackId: index === 1 ? tracks[0]!.id : track.id,
    startedAtMs: index + 1,
    updatedAtMs: index + 1,
    positionMs: 1_000,
    completed: false,
  }))
  const actions = {
    ...commonActions(),
    play: vi.fn(),
    download: vi.fn(),
    clear: vi.fn(),
    setQuery: vi.fn(),
    setPlatform: vi.fn(),
    setStartedAfter: vi.fn(),
    toggleQueue: vi.fn(),
  }
  const feature = shallowRef<UiThemeFeatureMap['history']>({
    ...ready,
    state: { ...commonState, entries, query: '', platformId: 'all', startedAfterMs: null },
    actions,
  })
  const test = mount(ClassicHistory, feature)
  try {
    await settle()
    expect(test.cells().length).toBeGreaterThan(1)
    expect(test.cells().length).toBeLessThan(30)
    expect(
      test
        .cells()
        .slice(0, 2)
        .map((cell) => cell.dataset.occurrence),
    ).toEqual(['play-0', 'play-1'])
    dispatchCatalogEvent(test.button('操作器 已选 0'), 'onClick')
    await nextTick()
    const select = (index: number) =>
      test.cells()[index]!.querySelector(`[data-am-focus-key="track:play-${index}:select"]`)!
    dispatchCatalogEvent(select(1), 'onChange')
    await settle()
    expect(select(1).props.checked).toBe(true)
    expect(select(0).props.checked).toBe(false)
    dispatchCatalogEvent(test.button('操作器 已选 1'), 'onClick')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        test.root,
        (node) => node.tag === 'button' && node.props.title === '按音乐平台查看播放记录',
      ),
      'onClick',
    )
    await settle()
    dispatchCatalogEvent(test.root.querySelector('[data-collection-entry="first"]')!, 'onClick')
    await settle()
    const expected = entries
      .filter((_, index) => index === 1 || index % 2 === 0)
      .map((entry) => entry.trackId)
    expect(test.cells()[0]!.props['aria-setsize']).toBe(expected.length)
    dispatchCatalogEvent(
      test.cells()[0]!.querySelector('[data-am-focus-key="track:play-0:play"]')!,
      'onClick',
    )
    expect(actions.play).toHaveBeenCalledExactlyOnceWith(tracks[0]!.id, expected)
    test.scroll.scrollTop = 8_000
    test.scroll.dispatchEvent(new Event('scroll'))
    await settle()
    expect(test.cells().some((cell) => cell.dataset.occurrence === 'play-0')).toBe(false)
    expect(test.cells().length).toBeLessThan(30)
  } finally {
    test.close()
  }
})
