import type { Track } from '@any-music/core'
import { createCatalogTrackFilterState, UI_CONTRIBUTIONS } from '@any-music/ui'
import {
  createEditingSession,
  provideConfirmationDialog,
  provideEditingSession,
} from '@any-music/ui/library'
import { getPresentationContinuity } from '@any-music/ui/theme'
import type {
  UiThemeCollectionActions,
  UiThemeCollectionState,
  UiThemeTrackListActions,
  UiThemeTrackListState,
} from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowReactive } from 'vue'
import type { Component } from 'vue'

import ClassicFavorites from '../../../src/components/library/ClassicFavorites.vue'
import ClassicPlaylists from '../../../src/components/library/ClassicPlaylists.vue'
import ClassicQueue from '../../../src/components/library/ClassicQueue.vue'
import {
  classicVirtualFavoritesCanaryKey,
  classicVirtualPlaylistCanaryKey,
  classicVirtualQueueCanaryKey,
} from '../../../src/composables/classic-virtual-favorites-canary'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

// Exercise real rows and their public actions. Node cannot establish layout, native focus,
// browser Find/text selection, or the P03/Userscript/Tauri admission gates.
vi.mock('../../../src/components/music-sources/VirtualQueueTrackGrid.vue', () => {
  throw new Error('An unadmitted production collection executed the virtual canary')
})
vi.mock('../../../src/components/music-sources/VirtualQueuePlatformGrid.vue', () => {
  throw new Error('An unadmitted production collection executed the virtual overview canary')
})
vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Teleport: passthrough, Transition: passthrough, TransitionGroup: passthrough }
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
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
afterEach(() => vi.unstubAllGlobals())

function createTracks(count = 80): Track[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `admission:${index}`,
    title: `歌曲 ${index}`,
    artists: [],
    source: {
      pluginId: index % 2 === 0 ? 'first' : 'second',
      resourceId: String(index),
      mediaKind: 'audio',
    },
  }))
}

function mountCollection(
  context: 'favorites' | 'queue' | 'playlists',
  tracks: readonly Track[] = createTracks(),
  canary?: boolean,
  gate: 'favorites' | 'queue' | 'playlists' = 'favorites',
) {
  const ids = tracks.map(({ id }) => id)
  const state = shallowReactive({
    tracks,
    selectedTrackIds: [] as readonly string[],
    invalidTrackIds: [],
    favoriteTrackIds: ids,
    queuedTrackIds: [],
    downloadedTrackIds: [],
    currentTrackId: null,
    platformNames: new Map([
      ['first', '第一音乐源'],
      ['second', '第二音乐源'],
    ]),
    customNamesByTrackId: new Map(),
    customTagsByTrackId: new Map(),
    addedAtMsByTrackId: new Map(),
    displayMode: 'standard' as const,
    mobileColumns: 1 as const,
    filters: createCatalogTrackFilterState(),
    filterDraft: null,
    arrangementMode: 'flat' as 'flat' | 'platform',
    mobileLayout: false,
    platformOrder: ['first', 'second'],
    totalCount: tracks.length,
    platformTrackCounts: new Map([
      ['first', tracks.filter((track) => track.source.pluginId === 'first').length],
      ['second', tracks.filter((track) => track.source.pluginId === 'second').length],
    ]),
    playlists: [{ id: 'mix', name: '完整歌单', trackIds: ids, createdAtMs: 1, updatedAtMs: 1 }],
    activePlaylistId: context === 'playlists' ? 'mix' : null,
    nameDraft: '',
    query: '',
    coverUrls: {},
  } satisfies UiThemeTrackListState & UiThemeCollectionState & Record<string, unknown>)
  const commands = {
    select: vi.fn((selected: readonly string[]) => {
      state.selectedTrackIds = selected
    }),
    play: vi.fn(),
    download: vi.fn(),
    toggleFavorite: vi.fn(),
    setFilterDraft: vi.fn(),
    applyFilters: vi.fn(),
    cancelFilters: vi.fn(),
    showTrackActions: vi.fn(),
    enqueue: vi.fn(),
    rename: vi.fn(),
    addToPlaylist: vi.fn(),
    useAsMaterial: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setDisplayMode: vi.fn(),
    setMobileColumns: vi.fn(),
    setArrangementMode: vi.fn(),
    moveTrack: vi.fn(),
    movePlatform: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    clear: vi.fn(),
    open: vi.fn(),
    setNameDraft: vi.fn(),
    create: vi.fn(),
    saveDetails: vi.fn(),
    removeTracks: vi.fn(),
    reorderTracks: vi.fn(),
    reorderPlaylists: vi.fn(),
    setQuery: vi.fn(),
  } satisfies UiThemeTrackListActions & UiThemeCollectionActions & Record<string, unknown>
  const feature = {
    state,
    actions: commands,
    availability: { status: 'available' },
    status: { status: 'ready' },
  }
  const editing = createEditingSession()
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const component = {
    favorites: ClassicFavorites,
    queue: ClassicQueue,
    playlists: ClassicPlaylists,
  }[context]
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        confirmation = provideConfirmationDialog()
        provide(UI_CONTRIBUTIONS, { resolve: () => [], accepts: () => false })
        if (canary !== undefined)
          provide(
            {
              favorites: classicVirtualFavoritesCanaryKey,
              queue: classicVirtualQueueCanaryKey,
              playlists: classicVirtualPlaylistCanaryKey,
            }[gate],
            canary,
          )
        return () => h(component as Component, { feature })
      },
    }),
    {},
  )
  return {
    ...view,
    state,
    commands,
    confirmation,
    rows: () => view.root.querySelectorAll('[data-queue-drop-kind="track"]'),
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

function assertProductionRendering(root: CatalogTestElement, count: number) {
  const virtualCells: CatalogTestElement[] = []
  const visit = (node: CatalogTestElement) => {
    if (String(node.props.class).includes('virtual-track-list')) virtualCells.push(node)
    node.children.forEach(visit)
  }
  visit(root)
  expect(virtualCells).toHaveLength(0)
  expect(root.querySelectorAll('[data-queue-drop-kind="track"]')).toHaveLength(count)
}

describe('C00–C02 production admission remains independently closed', () => {
  it.each([
    { context: 'queue', gate: 'queue', canary: false },
    { context: 'playlists', gate: 'playlists', canary: false },
    { context: 'queue', gate: 'playlists', canary: true },
    { context: 'playlists', gate: 'queue', canary: true },
    { context: 'favorites', gate: 'queue', canary: true },
    { context: 'favorites', gate: 'playlists', canary: true },
  ] as const)('keeps $context on the production path with $gate=$canary', (input) => {
    const view = mountCollection(input.context, createTracks(), input.canary, input.gate)
    try {
      assertProductionRendering(view.root, 80)
    } finally {
      view.close()
    }
  })
  it.each(['flat', 'platform'] as const)(
    'settles restoration into an empty %s candidate without awaiting a nonexistent grid',
    async (arrangement) => {
      const document = {
        defaultView: { getComputedStyle: () => ({ visibility: 'visible' }) },
      }
      const root = Object.assign(new EventTarget(), {
        ownerDocument: document,
        isConnected: true,
        scrollTop: 0,
        scrollLeft: 0,
        closest: () => null,
        getRootNode: () => document,
      })
      const closest = CatalogTestElement.prototype.closest
      const scrollRoot = vi
        .spyOn(CatalogTestElement.prototype, 'closest')
        .mockImplementation(function (this: CatalogTestElement, selector) {
          return selector === '.music-app-shell__content'
            ? (root as unknown as CatalogTestElement)
            : closest.call(this, selector)
        })
      const view = mountCollection('favorites', [], true)
      const controller = new AbortController()
      try {
        view.state.arrangementMode = arrangement
        // A nonzero total also covers an empty result from the existing host filter.
        view.state.totalCount = 80
        await nextTick()
        const section = findCatalogElement(
          view.root,
          (node) => node.tag === 'section' && node.props['aria-label'] === '我的喜欢',
        )
        Object.assign(section, { ownerDocument: document, isConnected: true })
        const adapter = getPresentationContinuity(section as unknown as Element)!
        expect(adapter).toBeDefined()
        expect(view.root.textContent).toContain('没有匹配的喜欢歌曲')
        let result: boolean | undefined
        const pending = adapter
          .restore({ anchor: { key: 'admission:900', offset: 37 } }, controller.signal)
          .then((restored) => {
            result = restored
          })
        await nextTick()
        await nextTick()
        expect(result).toBe(false)
        await pending

        // A host filter can remove the result while lazy restoration is waiting.
        // The next render stays empty; a grid adapter cannot resolve that operation.
        view.state.tracks = createTracks(1)
        result = undefined
        const waiting = adapter
          .restore({ anchor: { key: 'admission:0', offset: 0 } }, controller.signal)
          .then((restored) => {
            result = restored
          })
        view.state.tracks = []
        await nextTick()
        await nextTick()
        expect(result).toBe(false)
        await waiting
        expect(
          Object.values(view.commands).every((command) => command.mock.calls.length === 0),
        ).toBe(true)
      } finally {
        controller.abort()
        view.close()
        scrollRoot.mockRestore()
      }
    },
  )

  it('uses the existing filter action without adding a collection Find control', async () => {
    const view = mountCollection('favorites')
    try {
      await nextTick()
      expect(view.root.querySelectorAll('[aria-label="查找歌曲"]')).toHaveLength(0)
      expect(view.root.querySelectorAll('[role="search"]')).toHaveLength(0)
      dispatchCatalogEvent(view.button('筛选歌曲'), 'onClick', false)
      expect(view.commands.setFilterDraft).toHaveBeenCalledExactlyOnceWith(
        createCatalogTrackFilterState(),
      )
      expect(view.commands.play).not.toHaveBeenCalled()
      expect(view.commands.select).not.toHaveBeenCalled()
    } finally {
      view.close()
    }
  })

  it.each(
    (['favorites', 'queue', 'playlists'] as const).flatMap((context) =>
      (context === 'favorites' ? [undefined, false] : [undefined, false, true]).map((canary) => ({
        context,
        canary,
      })),
    ),
  )(
    'keeps every $context row without executing the canary (provided: $canary)',
    ({ context, canary }) => {
      const view = mountCollection(context, createTracks(), canary)
      try {
        assertProductionRendering(view.root, 80)
        expect(view.rows().map((row) => row.dataset.queueDropId)).toEqual(
          view.state.tracks.map(({ id }) => id),
        )
        expect(view.root.textContent).toContain('歌曲 79')
        expect(
          Object.values(view.commands).every((command) => command.mock.calls.length === 0),
        ).toBe(true)
      } finally {
        view.close()
      }
    },
  )

  it('plays the full host-filtered favorite order and selects all matches without clearing outside selection', async () => {
    // Filtering belongs to the host. The page receives its complete ordered result,
    // including items far beyond the first viewport rather than an artificial DOM window.
    const tracks = createTracks(160)
      .filter((_, index) => index % 2 === 0)
      .toReversed()
    const view = mountCollection('favorites', tracks)
    try {
      const ids = tracks.map(({ id }) => id)
      const last = ids.at(-1)!
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === `track:${last}:play`,
        ),
        'onClick',
        false,
      )
      expect(view.commands.play).toHaveBeenCalledExactlyOnceWith(last, ids)
      view.state.selectedTrackIds = ['outside-current-filter']
      await nextTick()
      dispatchCatalogEvent(view.button('操作器 已选 0'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['aria-label'] === '全选当前 80 首匹配歌曲',
        ),
        'onChange',
        false,
      )
      await nextTick()
      expect(view.commands.select).toHaveBeenCalledExactlyOnceWith([
        'outside-current-filter',
        ...ids,
      ])
      dispatchCatalogEvent(view.button('按勾选顺序添加已选歌曲到待听'), 'onClick', false)
      expect(view.commands.enqueue).toHaveBeenCalledExactlyOnceWith(ids)
      assertProductionRendering(view.root, 80)
    } finally {
      view.close()
    }
  })

  it.each(['favorites', 'queue', 'playlists'] as const)(
    'keeps the growing %s overview on its production path without a canary provider',
    async (context) => {
      const tracks = createTracks()
      tracks.forEach((track, index) =>
        Object.assign(track.source, { pluginId: `platform:${index}` }),
      )
      const view = mountCollection(context, tracks)
      try {
        view.state.arrangementMode = 'platform'
        await nextTick()
        expect(view.root.querySelectorAll('[data-queue-drop-kind="platform"]')).toHaveLength(80)
        assertProductionRendering(view.root, 0)
        expect(view.root.textContent).toContain('platform:79')
      } finally {
        view.close()
      }
    },
  )

  it('keeps keyboard reorder scoped to the complete host-filtered platform subset', async () => {
    const tracks = createTracks().filter((_, index) => index % 3 !== 0)
    const view = mountCollection('favorites', tracks)
    try {
      view.state.arrangementMode = 'platform'
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-collection-entry'] === 'second'),
        'onClick',
        false,
      )
      await nextTick()
      const ids = tracks.filter((track) => track.source.pluginId === 'second').map(({ id }) => id)
      expect(view.rows().map((row) => row.dataset.queueDropId)).toEqual(ids)
      const row = view.rows().at(-1)!
      const handle = findCatalogElement(row, (node) => 'data-queue-handle' in node.props)
      const handlers = handle.props.onKeydown as ((event: unknown) => void)[]
      const scans = vi.spyOn(tracks, 'find')
      try {
        handlers.forEach((handler) =>
          handler({ key: 'ArrowUp', preventDefault() {}, stopPropagation() {} }),
        )
        expect(view.commands.moveTrack).toHaveBeenCalledExactlyOnceWith(ids.at(-1), ids.at(-2), ids)
        expect(scans).not.toHaveBeenCalled()
      } finally {
        scans.mockRestore()
      }
      expect(view.commands.movePlatform).not.toHaveBeenCalled()
      assertProductionRendering(view.root, ids.length)
    } finally {
      view.close()
    }
  })

  it('keeps platform reorder and group selection on the complete host-filtered overview', async () => {
    const tracks = createTracks(160)
    tracks.forEach((track, index) =>
      Object.assign(track.source, { pluginId: `platform:${Math.floor(index / 2)}` }),
    )
    const view = mountCollection('favorites', tracks)
    try {
      const order = Array.from({ length: 80 }, (_, index) => `platform:${79 - index}`)
      view.state.platformOrder = order
      view.state.arrangementMode = 'platform'
      view.state.selectedTrackIds = ['outside-current-filter', tracks[0]!.id]
      await nextTick()
      const groups = view.root.querySelectorAll('[data-queue-drop-kind="platform"]')
      expect(groups.map((group) => group.dataset.queueDropId)).toEqual(order)
      const last = groups.at(-1)!
      const handlers = last.props.onKeydown as ((event: unknown) => void)[]
      handlers.forEach((handler) =>
        handler({ key: 'ArrowUp', preventDefault() {}, stopPropagation() {} }),
      )
      expect(view.commands.movePlatform).toHaveBeenCalledExactlyOnceWith(
        'platform:0',
        'platform:1',
        order,
      )
      dispatchCatalogEvent(view.button('操作器 已选 1'), 'onClick', false)
      await nextTick()
      const checkbox = findCatalogElement(last, (node) => node.tag === 'input')
      expect(checkbox.props.indeterminate).toBe(true)
      dispatchCatalogEvent(checkbox, 'onChange', false)
      expect(view.commands.select).toHaveBeenLastCalledWith([
        'outside-current-filter',
        tracks[0]!.id,
        tracks[1]!.id,
      ])
      await nextTick()
      dispatchCatalogEvent(checkbox, 'onChange', false)
      expect(view.commands.select).toHaveBeenLastCalledWith(['outside-current-filter'])
      expect(view.commands.moveTrack).not.toHaveBeenCalled()
    } finally {
      view.close()
    }
  })

  it('preserves explicit and first-seen platform order, mixed custom status and unknown counts', async () => {
    const sources = ['beta', 'a', 'beta', 'custom', 'a', 'custom']
    const tracks = createTracks(6)
    tracks.forEach((track, index) =>
      Object.assign(track.source, {
        pluginId: sources[index]!,
        mediaKind: index === 5 ? 'custom' : 'audio',
      }),
    )
    const view = mountCollection('favorites', tracks)
    try {
      view.state.platformOrder = ['unknown', 'custom', 'custom', 'a']
      view.state.platformTrackCounts = new Map([
        ['custom', 10],
        ['a', 20],
      ])
      view.state.arrangementMode = 'platform'
      await nextTick()
      const groups = view.root.querySelectorAll('[data-queue-drop-kind="platform"]')
      expect(groups.map((group) => group.dataset.queueDropId)).toEqual(['custom', 'a', 'beta'])
      expect(groups[0]!.props['aria-label']).toContain('（本地拼接）')
      expect(groups[1]!.props['aria-label']).not.toContain('（本地拼接）')
      expect(groups[0]!.textContent).toContain('10 首歌曲')
      expect(groups[1]!.textContent).toContain('20 首歌曲')
      expect(groups[2]!.textContent).toContain('0 首歌曲')
      dispatchCatalogEvent(
        findCatalogElement(groups[0]!, (node) => node.props['data-collection-entry'] === 'custom'),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.rows().map((row) => row.dataset.queueDropId)).toEqual([
        tracks[3]!.id,
        tracks[5]!.id,
      ])
    } finally {
      view.close()
    }
  })
})
