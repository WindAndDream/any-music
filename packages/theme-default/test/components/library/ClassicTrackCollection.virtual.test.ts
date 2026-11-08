import type { Track } from '@any-music/core'
import { UI_CONTRIBUTIONS, createCatalogTrackFilterState } from '@any-music/ui'
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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowReactive, shallowRef } from 'vue'
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
} from '../../helpers/test-renderer'
import { mountMeasuredThemeGrid } from '../../helpers/virtual-grid-renderer'

// Compile the real collection/rows and lazy virtual adapters. Geometry/focus is injected;
// these checks never launch a product or establish GM/WebView/native-input acceptance.
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
    setup:
      (_, { attrs, slots }) =>
      () =>
        vue.h(
          'div',
          {
            'data-test-transition': attrs.name,
            onBeforeEnter: attrs.onBeforeEnter,
            onAfterEnter: attrs.onAfterEnter,
          },
          slots.default?.(),
        ),
  })
  return { ...vue, Teleport: passthrough, Transition: transition, TransitionGroup: passthrough }
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

async function settle() {
  for (let index = 0; index < 8; index++) {
    // eslint-disable-next-line no-await-in-loop -- Resolve actual lazy imports and measurements.
    await nextTick()
    // eslint-disable-next-line no-await-in-loop -- Lazy module resolution needs a task turn.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}
beforeAll(async () => {
  // Production laziness is checked by the throwing-loader admission suite. Preload the
  // test modules so compilation time cannot be mistaken for a mounted-window failure.
  await Promise.all([
    import('../../../src/components/music-sources/VirtualQueueTrackGrid.vue'),
    import('../../../src/components/music-sources/VirtualQueuePlatformGrid.vue'),
  ])
})
beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('HTMLElement', CatalogTestElement)
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  })
})
afterEach(() => vi.unstubAllGlobals())

function createTracks(count: number): Track[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `track:${index}`,
    title: `歌曲 ${index}`,
    artists: [],
    source: {
      pluginId: index % 2 ? 'second' : 'first',
      resourceId: String(index),
      mediaKind: 'audio',
    },
  }))
}
function setup(context: 'favorites' | 'queue' | 'playlists', tracks = createTracks(1_000)) {
  const ids = tracks.map(({ id }) => id)
  const playlist = (id: string) => ({
    id,
    name: `歌单 ${id}`,
    trackIds: ids,
    createdAtMs: 1,
    updatedAtMs: 1,
    coverId: `cover:${id}`,
  })
  const state = shallowReactive({
    tracks,
    selectedTrackIds: [] as readonly string[],
    invalidTrackIds: [] as string[],
    favoriteTrackIds: [],
    queuedTrackIds: ids,
    downloadedTrackIds: [],
    currentTrackId: 'track:0',
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
    platformOrder: ['second', 'first'],
    totalCount: tracks.length,
    platformTrackCounts: new Map([
      ['first', Math.ceil(tracks.length / 2)],
      ['second', Math.floor(tracks.length / 2)],
    ]),
    playlists: [playlist('one'), playlist('two')],
    activePlaylistId: context === 'playlists' ? 'one' : null,
    nameDraft: '',
    query: '',
    coverUrls: { 'cover:one': 'fixture:one', 'cover:two': 'fixture:two' },
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
    setArrangementMode: vi.fn((mode: 'flat' | 'platform') => {
      state.arrangementMode = mode
    }),
    moveTrack: vi.fn<UiThemeCollectionActions['moveTrack']>(),
    movePlatform: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    clear: vi.fn(),
    open: vi.fn((id: string | null) => {
      state.activePlaylistId = id
    }),
    setNameDraft: vi.fn(),
    create: vi.fn(),
    saveDetails: vi.fn(),
    removeTracks: vi.fn(),
    reorderTracks: vi.fn(),
    reorderPlaylists: vi.fn(),
    setQuery: vi.fn(),
  } satisfies UiThemeTrackListActions & UiThemeCollectionActions & Record<string, unknown>
  const feature = shallowRef({
    state,
    actions: commands,
    availability: { status: 'available' },
    status: { status: 'ready' },
  })
  const editing = createEditingSession()
  const generation = shallowRef(0)
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const view = mountMeasuredThemeGrid(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        confirmation = provideConfirmationDialog()
        provide(UI_CONTRIBUTIONS, { resolve: () => [], accepts: () => false })
        provide(
          context === 'favorites'
            ? classicVirtualFavoritesCanaryKey
            : context === 'queue'
              ? classicVirtualQueueCanaryKey
              : classicVirtualPlaylistCanaryKey,
          true,
        )
        return () =>
          h(
            (context === 'favorites'
              ? ClassicFavorites
              : context === 'queue'
                ? ClassicQueue
                : ClassicPlaylists) as Component,
            {
              key: generation.value,
              feature: feature.value,
            },
          )
      },
    }),
    () => 3,
    144,
  )
  view.app.config.warnHandler = (message) => {
    if (!message.startsWith('Non-function value encountered for default slot'))
      throw new Error(message)
  }
  const button = (label: string) =>
    findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === label,
    )
  const region = () =>
    findCatalogElement(
      view.root,
      (node) => typeof node.props['data-am-continuity-key'] === 'string',
    )
  return {
    ...view,
    state,
    commands,
    replaceTracks(nextTracks: readonly Track[]) {
      feature.value = {
        ...feature.value,
        state: { ...feature.value.state, tracks: [...nextTracks] },
      }
    },
    confirmation,
    generation,
    button,
    region,
    adapter: () => getPresentationContinuity(region() as unknown as Element)!,
    cells: (kind = 'track') => view.root.querySelectorAll(`[data-queue-drop-kind="${kind}"]`),
    close() {
      view.unmount()
      editing.dispose()
    },
  }
}
function shift(cell: CatalogTestElement, direction: 'ArrowUp' | 'ArrowDown') {
  const handle = findCatalogElement(cell, (node) => 'data-queue-handle' in node.props)
  const handlers = handle.props.onKeydown as ((event: unknown) => void)[]
  handlers.forEach((handler) =>
    handler({ key: direction, preventDefault() {}, stopPropagation() {} }),
  )
}

function finishPlatformTransition(root: CatalogTestElement) {
  const view = findCatalogElement(
    root,
    (node) =>
      String(node.props.class).includes('listen-queue__view') &&
      typeof node.props['data-collection-view'] === 'string' &&
      node.parent?.props.onAfterEnter !== undefined,
  )
  let transition = view.parent
  while (transition && !transition.props.onAfterEnter) transition = transition.parent
  expect(transition).not.toBeNull()
  ;(transition!.props.onBeforeEnter as (element: unknown) => void)(view)
  ;(transition!.props.onAfterEnter as (element: unknown) => void)(view)
}

function activeTrack(cell: CatalogTestElement) {
  return findCatalogElement(cell, (node) => String(node.props.class).includes('track--active'))
}

describe.each(['favorites', 'queue', 'playlists'] as const)(
  'virtual %s committed snapshot handoff',
  (context) => {
    it('keeps the mounted adapter and keyboard focus through an immutable controlled reorder', async () => {
      const tracks = createTracks(80)
      const test = setup(context, tracks)
      try {
        await settle()
        const source = test.cells()[0]!
        const handle = findCatalogElement(source, (node) => 'data-queue-handle' in node.props)
        handle.focus()
        test.commands.moveTrack.mockImplementation((id, target, ids) => {
          const next = [...ids]
          next.splice(next.indexOf(target), 0, ...next.splice(next.indexOf(id), 1))
          const byId = new Map(tracks.map((track) => [track.id, track]))
          test.replaceTracks(next.map((key) => byId.get(key)!))
        })
        shift(source, 'ArrowDown')
        await settle()
        expect(test.commands.moveTrack).toHaveBeenCalledOnce()
        expect(test.cells()[1]).toBe(source)
        expect(test.document.activeElement).toBe(handle)
      } finally {
        test.close()
      }
    })
  },
)

describe.each(['queue', 'playlists'] as const)('C01/C02 %s candidate integration', (context) => {
  it.each([0, 1, 80, 1_000, 10_000])(
    'bounds %i controlled tracks without submitting actions',
    async (count) => {
      const test = setup(context, createTracks(count))
      try {
        await settle()
        if (count < 2) expect(test.cells()).toHaveLength(count)
        else {
          expect(test.cells().length).toBeGreaterThan(0)
          expect(test.cells().length).toBeLessThan(24)
        }
        expect(test.region().props['data-am-continuity-key']).toBe(
          context === 'queue' ? 'queue:tracks' : 'playlist:one:tracks',
        )
        for (const cell of test.cells()) expect(cell.props['aria-setsize']).toBe(count)
        expect(
          Object.values(test.commands).every((command) => command.mock.calls.length === 0),
        ).toBe(true)
      } finally {
        test.close()
      }
    },
  )

  it('keeps complete filtered playback, numbering, selection and batch removal', async () => {
    const tracks = createTracks(2_000)
      .filter((_, index) => index % 2 === 0)
      .toReversed()
    const test = setup(context, tracks)
    try {
      await settle()
      const ids = tracks.map(({ id }) => id)
      const first = test.cells()[0]!
      expect(
        findCatalogElement(first, (node) => 'data-queue-handle' in node.props).props['aria-label'],
      ).toContain('第 1 首')
      dispatchCatalogEvent(
        findCatalogElement(
          first,
          (node) => node.props['data-am-focus-key'] === `track:${ids[0]}:play`,
        ),
        'onClick',
        false,
      )
      expect(test.commands.play).toHaveBeenCalledExactlyOnceWith(ids[0], ids)
      test.state.selectedTrackIds = ['outside-filter']
      await settle()
      dispatchCatalogEvent(test.button('操作器 已选 0'), 'onClick', false)
      await settle()
      dispatchCatalogEvent(
        findCatalogElement(
          test.root,
          (node) => node.props['aria-label'] === '全选当前 1000 首匹配歌曲',
        ),
        'onChange',
        false,
      )
      await settle()
      expect(test.commands.select).toHaveBeenCalledExactlyOnceWith(['outside-filter', ...ids])
      if (context === 'queue')
        dispatchCatalogEvent(test.button('将已选歌曲移出待听'), 'onClick', false)
      else
        dispatchCatalogEvent(
          findCatalogElement(
            test.root,
            (node) => node.tag === 'button' && node.textContent.trim() === '移除已选',
          ),
          'onClick',
          false,
        )
      test.confirmation.accept()
      await settle()
      if (context === 'queue') expect(test.commands.remove).toHaveBeenCalledExactlyOnceWith(ids)
      else expect(test.commands.removeTracks).toHaveBeenCalledExactlyOnceWith('one', ids)
      expect(test.cells().length).toBeLessThan(32)
    } finally {
      test.close()
    }
  })

  it('restores an offscreen occurrence and keeps both keyboard moves on the complete order', async () => {
    const test = setup(context)
    try {
      await settle()
      const snapshot = {
        anchor: { key: 'track:900', offset: 13 },
        focus: { itemKey: 'track:900', controlKey: 'track:track:900:play' },
      }
      expect(await test.adapter().restore(snapshot, new AbortController().signal)).toBe(true)
      expect(
        (test.document.activeElement as unknown as CatalogTestElement).props['data-am-focus-key'],
      ).toBe(snapshot.focus.controlKey)
      expect(test.cells().length).toBeLessThan(32)
      const source = test.cells().find((cell) => cell.dataset.queueDropId === 'track:900')!
      expect(
        findCatalogElement(source, (node) => 'data-queue-handle' in node.props).props['aria-label'],
      ).toContain('第 901 首')
      shift(source, 'ArrowUp')
      expect(test.commands.moveTrack).toHaveBeenLastCalledWith(
        'track:900',
        'track:899',
        test.state.tracks.map(({ id }) => id),
      )
      shift(source, 'ArrowDown')
      expect(test.commands.moveTrack).toHaveBeenLastCalledWith(
        'track:900',
        'track:901',
        test.state.tracks.map(({ id }) => id),
      )
      expect(test.commands.moveTrack).toHaveBeenCalledTimes(2)
      expect(test.commands.play).not.toHaveBeenCalled()
      expect(test.commands.select).not.toHaveBeenCalled()
      const previous = test.adapter()
      test.generation.value++
      await settle()
      expect(await previous.restore(snapshot, new AbortController().signal)).toBe(false)
      expect(await test.adapter().restore(snapshot, new AbortController().signal)).toBe(true)
      expect(test.adapter().capture()?.anchor).toEqual(snapshot.anchor)
      expect(test.cells().length).toBeLessThan(32)
    } finally {
      test.close()
    }
  })

  it('keeps previously offscreen, empty and cleared host filter results on the same bounded path', async () => {
    const tracks = createTracks(1_000)
    const test = setup(context, tracks)
    try {
      await settle()
      expect(test.cells().some((cell) => cell.dataset.queueDropId === 'track:900')).toBe(false)
      test.state.filters = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '歌曲 900' }],
      }
      test.state.tracks = [tracks[900]!]
      await settle()
      expect(test.cells().map((cell) => cell.dataset.queueDropId)).toEqual(['track:900'])
      test.state.tracks = tracks.filter((track) => track.title.startsWith('歌曲 9'))
      await settle()
      expect(test.cells().length).toBeGreaterThan(0)
      expect(test.cells().length).toBeLessThan(24)
      expect(test.cells()[0]!.props['aria-setsize']).toBe(111)
      test.state.tracks = []
      await settle()
      expect(test.cells()).toHaveLength(0)
      expect(
        await test
          .adapter()
          .restore({ anchor: { key: 'track:900', offset: 0 } }, new AbortController().signal),
      ).toBe(false)
      test.state.filters = createCatalogTrackFilterState()
      test.state.tracks = tracks
      await settle()
      expect(test.cells().length).toBeGreaterThan(0)
      expect(test.cells().length).toBeLessThan(24)
      expect(test.cells()[0]!.props['aria-setsize']).toBe(1_000)
      expect(Object.values(test.commands).every((command) => command.mock.calls.length === 0)).toBe(
        true,
      )
    } finally {
      test.close()
    }
  })

  it('returns to a distant platform overview occurrence with bounded cards and no business replay', async () => {
    const tracks = createTracks(1_000)
    tracks.forEach((track, index) => {
      track.source.pluginId = `source:${index}`
    })
    const test = setup(context, tracks)
    try {
      test.state.platformOrder = tracks.map((track) => track.source.pluginId)
      test.state.arrangementMode = 'platform'
      await settle()
      expect(test.cells('platform').length).toBeLessThan(24)
      const snapshot = {
        anchor: { key: 'source:900', offset: 13 },
        focus: { itemKey: 'source:900', controlKey: 'platform:source:900:open' },
      }
      expect(await test.adapter().restore(snapshot, new AbortController().signal)).toBe(true)
      const before = test.adapter().capture()!
      const source = test
        .cells('platform')
        .find((cell) => cell.dataset.queueDropId === 'source:900')!
      shift(source, 'ArrowUp')
      expect(test.commands.movePlatform).toHaveBeenCalledExactlyOnceWith(
        'source:900',
        'source:899',
        test.state.platformOrder,
      )
      dispatchCatalogEvent(
        findCatalogElement(source, (node) => node.props['data-collection-entry'] === 'source:900'),
        'onClick',
        false,
      )
      await settle()
      finishPlatformTransition(test.root)
      await settle()
      expect(test.cells().map((cell) => cell.dataset.queueDropId)).toEqual(['track:900'])
      dispatchCatalogEvent(test.button('返回按平台'), 'onClick', false)
      await settle()
      finishPlatformTransition(test.root)
      await settle()
      expect(test.adapter().capture()?.anchor).toEqual(before.anchor)
      expect(
        (test.document.activeElement as unknown as CatalogTestElement).props['data-am-focus-key'],
      ).toBe(snapshot.focus.controlKey)
      expect(test.cells('platform').length).toBeLessThan(32)
      expect(test.commands.play).not.toHaveBeenCalled()
      expect(test.commands.select).not.toHaveBeenCalled()
      expect(test.commands.moveTrack).not.toHaveBeenCalled()
    } finally {
      test.close()
    }
  })

  it('uses platform-scoped tracks, positions and selection without narrowing reorder to the window', async () => {
    const test = setup(context)
    try {
      test.state.arrangementMode = 'platform'
      await settle()
      expect(test.region().props['data-am-continuity-key']).toBe(
        context === 'queue' ? 'queue:platforms' : 'playlist:one:platforms',
      )
      expect(test.cells('platform').map((cell) => cell.dataset.queueDropId)).toEqual([
        'second',
        'first',
      ])
      dispatchCatalogEvent(
        findCatalogElement(test.root, (node) => node.props['data-collection-entry'] === 'second'),
        'onClick',
        false,
      )
      await settle()
      const ids = test.state.tracks
        .filter((track) => track.source.pluginId === 'second')
        .map(({ id }) => id)
      expect(test.cells().length).toBeLessThan(32)
      expect(test.cells().every((cell) => ids.includes(cell.dataset.queueDropId!))).toBe(true)
      expect(test.region().props['data-am-continuity-key']).toBe(
        context === 'queue' ? 'queue:tracks' : 'playlist:one:tracks',
      )
      const first = test.cells()[0]!
      expect(
        findCatalogElement(first, (node) => 'data-queue-handle' in node.props).props['aria-label'],
      ).toContain('第 2 首')
      shift(first, 'ArrowDown')
      expect(test.commands.moveTrack).toHaveBeenCalledExactlyOnceWith(ids[0], ids[1], ids)
      dispatchCatalogEvent(
        findCatalogElement(
          first,
          (node) => node.props['data-am-focus-key'] === `track:${ids[0]}:play`,
        ),
        'onClick',
        false,
      )
      expect(test.commands.play).toHaveBeenCalledExactlyOnceWith(ids[0], ids)
      expect(test.commands.movePlatform).not.toHaveBeenCalled()
    } finally {
      test.close()
    }
  })
})

describe.each(['favorites', 'queue', 'playlists'] as const)('%s window lifetime', (context) => {
  it.each([0, 1, 80, 1_000, 10_000])(
    'removes departed DOM cells after bidirectional traversal of %i tracks',
    async (count) => {
      const test = setup(context, createTracks(count))
      try {
        await settle()
        const initial = test.cells().map((cell) => cell.props['data-occurrence'])
        const visited = new Set<CatalogTestElement>()
        const end = Math.max(0, 24 + Math.ceil(count / 3) * 156 - test.scroll.clientHeight)
        for (const fraction of [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]) {
          test.scroll.scrollTop = end * fraction
          test.scroll.dispatchEvent(new Event('scroll'))
          // eslint-disable-next-line no-await-in-loop -- Inspect each committed window, including returning to the head.
          await settle()
          const mounted = test.cells()
          for (const cell of mounted) visited.add(cell)
          expect(mounted.length).toBeLessThanOrEqual(24)
          expect([...visited].filter((cell) => cell.parent !== null)).toEqual(
            expect.arrayContaining(mounted),
          )
          expect([...visited].filter((cell) => cell.parent !== null)).toHaveLength(mounted.length)
        }
        expect(test.cells().map((cell) => cell.props['data-occurrence'])).toEqual(initial)
        if (count >= 80) expect(visited.size).toBeGreaterThan(initial.length)
        expect(test.state.tracks).toHaveLength(count)
        expect(test.commands.play).not.toHaveBeenCalled()
        expect(test.commands.moveTrack).not.toHaveBeenCalled()
      } finally {
        test.close()
      }
    },
  )
})

describe('consumer-specific state boundaries', () => {
  it('projects the current queue song independently from the mounted window', async () => {
    const test = setup('queue')
    try {
      await settle()
      expect(activeTrack(test.cells()[0]!)).toBeDefined()
      test.state.currentTrackId = 'track:900'
      await settle()
      expect(test.cells().some((cell) => cell.dataset.queueDropId === 'track:900')).toBe(false)
      expect(
        await test
          .adapter()
          .restore({ anchor: { key: 'track:900', offset: 0 } }, new AbortController().signal),
      ).toBe(true)
      expect(
        activeTrack(test.cells().find((cell) => cell.dataset.queueDropId === 'track:900')!),
      ).toBeDefined()
      expect(test.commands.play).not.toHaveBeenCalled()
    } finally {
      test.close()
    }
  })

  it('rejects a pending removal after playlist navigation and isolates restoration regions', async () => {
    const test = setup('playlists')
    try {
      await settle()
      dispatchCatalogEvent(test.button('操作器 已选 0'), 'onClick', false)
      test.state.selectedTrackIds = ['track:900']
      await settle()
      dispatchCatalogEvent(
        findCatalogElement(
          test.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '移除已选',
        ),
        'onClick',
        false,
      )
      test.state.activePlaylistId = 'two'
      await settle()
      test.confirmation.accept()
      await settle()
      expect(test.commands.removeTracks).not.toHaveBeenCalled()
      expect(test.region().props['data-am-continuity-key']).toBe('playlist:two:tracks')
      expect(test.root.querySelectorAll('[aria-label="歌单 two"]')).toHaveLength(1)
      expect(test.root.querySelectorAll('[aria-label="歌单 one"]')).toHaveLength(0)
      dispatchCatalogEvent(test.button('返回我的歌单'), 'onClick', false)
      await settle()
      expect(test.state.activePlaylistId).toBeNull()
      expect(test.root.querySelectorAll('[data-am-continuity-key]')).toHaveLength(0)
      expect(test.state.playlists.map(({ coverId }) => coverId)).toEqual(['cover:one', 'cover:two'])
    } finally {
      test.close()
    }
  })
})
