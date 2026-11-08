import { provideCardPresentation } from '@any-music/card-styles/vue'
import type { Track } from '@any-music/core'
import { createCatalogTrackFilterState, filterCatalogTracks } from '@any-music/ui/catalog'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, nextTick, reactive, shallowRef } from 'vue'

import VirtualQueueTrackGrid from '../../../src/components/music-sources/VirtualQueueTrackGrid.vue'
import type { ClassicVirtualTrackGridAdapter } from '../../../src/composables/classic-virtual-favorites-canary'
import { provideClassicOverlays } from '../../../src/composables/use-classic-overlays'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  type CatalogTestElement,
} from '../../helpers/test-renderer'
import { mountMeasuredThemeGrid } from '../../helpers/virtual-grid-renderer'

async function settle() {
  for (let flush = 0; flush < 6; flush++) {
    // eslint-disable-next-line no-await-in-loop -- Flush bounded render/measurement handoffs.
    await nextTick()
  }
}
afterEach(() => vi.unstubAllGlobals())

function setup(
  count: number,
  skin: 'default' | 'minimal' = 'default',
  naturalHeight = 100,
  inputTracks?: readonly Track[],
) {
  const tracks = shallowRef<readonly Track[]>(
    inputTracks ??
      Array.from({ length: count }, (_, index) => ({
        id: String(index),
        title: `歌曲 ${index}`,
        artists: [{ name: '作者' }],
        source: { pluginId: 'fixture', resourceId: String(index), mediaKind: 'audio' },
      })),
  )
  const displayMode = shallowRef<'standard' | 'compact' | 'comfortable'>('standard')
  const filters = shallowRef(createCatalogTrackFilterState())
  const filteredTracks = computed(() => filterCatalogTracks(tracks.value, new Map(), filters.value))
  const itemStyle = shallowRef(skin)
  const columns = shallowRef(3)
  const customTags = shallowRef<ReadonlyMap<string, readonly string[]>>(new Map())
  const play = vi.fn(),
    select = vi.fn(),
    showActions = vi.fn(),
    releaseAdapter = vi.fn()
  let adapter: ClassicVirtualTrackGridAdapter | undefined
  let overlays!: ReturnType<typeof provideClassicOverlays>
  const register = (value: ClassicVirtualTrackGridAdapter) => {
    adapter = value
    return () => {
      if (adapter === value) adapter = undefined
      releaseAdapter()
    }
  }
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const view = mountMeasuredThemeGrid(
    defineComponent({
      props: ['scroll'],
      setup(props) {
        overlays = provideClassicOverlays()
        provideCardPresentation({
          itemStyle: () => itemStyle.value,
          player: () => ({ track: null, playing: false, positionMs: 0, durationMs: 0 }),
          actions: { play: vi.fn(), pause: vi.fn() },
        })
        return () =>
          h(VirtualQueueTrackGrid, {
            tracks: filteredTracks.value,
            positions: new Map<string, number>(),
            selectedIds: new Set<string>(),
            platformNames: new Map([['fixture', '测试音乐源']]),
            addedAtMsByTrackId: new Map(),
            customTagsByTrackId: customTags.value,
            favoriteTrackIds: new Set<string>(),
            invalidTrackIds: new Set<string>(),
            getReorderStyle: () => undefined,
            downloadBusy: false,
            displayMode: displayMode.value,
            mobileColumns: 1,
            virtual: {
              scrollElement: props.scroll as HTMLElement,
              resetKey: 'overview',
              layoutGeneration: itemStyle.value,
              register,
            },
            onPlay: play,
            onSelect: select,
            onShowActions: showActions,
          })
      },
    }),
    () => columns.value,
    naturalHeight,
  )
  return {
    ...view,
    tracks,
    filters,
    filteredTracks,
    displayMode,
    itemStyle,
    columns,
    customTags,
    play,
    select,
    showActions,
    releaseAdapter,
    adapter: () => adapter!,
    overlays: () => overlays,
    cells: () => view.root.querySelectorAll('[data-queue-drop-kind="track"]'),
  }
}

describe('C00 real-row candidate (injected geometry; no production admission)', () => {
  it('reuses semantic content generations through repeated measurements and window changes', async () => {
    const serialized = vi.fn(() => 'Unrendered track metadata')
    const tracks = reactive<Track[]>(
      Array.from({ length: 1_000 }, (_, index) => ({
        id: String(index),
        title: `歌曲 ${index}`,
        artists: [{ name: '作者' }],
        source: { pluginId: 'fixture', resourceId: String(index), mediaKind: 'audio' },
        get description() {
          return serialized()
        },
      })),
    )
    const test = setup(tracks.length, 'default', 100, tracks)
    await settle()
    try {
      expect(serialized).toHaveBeenCalledTimes(tracks.length)
      const initialReads = serialized.mock.calls.length
      const content = test.cells()[0]!.children[0]! as unknown as HTMLElement
      content.dispatchEvent(new Event('load'))
      await settle()
      expect(serialized).toHaveBeenCalledTimes(initialReads)
      test.scroll.scrollTop = 15_000
      test.scroll.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.cells().some((cell) => cell.dataset.queueDropId === '0')).toBe(false)
      test.scroll.scrollTop = 25_000
      test.scroll.dispatchEvent(new Event('scroll'))
      await settle()
      expect(serialized).toHaveBeenCalledTimes(initialReads)
      expect(test.cells().length).toBeLessThan(30)
    } finally {
      test.unmount()
    }
  })

  it.each(['title', 'artist', 'source-tags'] as const)(
    'invalidates remembered offscreen heights immediately after an in-place %s edit',
    async (field) => {
      const serialized = vi.fn(() => 'Unrendered track metadata')
      const tracks = reactive<Track[]>(
        Array.from({ length: 80 }, (_, index) => ({
          id: String(index),
          title: `歌曲 ${index}`,
          artists: [{ name: '作者' }],
          sourceTags: ['来源标签'],
          source: { pluginId: 'fixture', resourceId: String(index), mediaKind: 'audio' },
          get description() {
            return serialized()
          },
        })),
      )
      const test = setup(tracks.length, 'minimal', 100, tracks)
      await settle()
      try {
        test.scroll.scrollTop = 3_000
        test.scroll.dispatchEvent(new Event('scroll'))
        await settle()
        expect(test.cells().some((cell) => cell.dataset.queueDropId === '0')).toBe(false)
        const ids = tracks.map(({ id }) => id)
        const session = test.adapter().createGeometry({
          kind: 'track',
          sourceId: test.cells()[0]!.dataset.queueDropId!,
          ids,
          eligibleIds: new Set(ids),
          container: test.root as unknown as HTMLElement,
          bounds: { top: 0, left: 0, width: 1000, height: 300 } as DOMRect,
          initialScrollTop: test.scroll.scrollTop,
        })!
        expect(session.findSlot(0, -1_000_000)).toMatchObject({ id: '0', height: 100 })
        const initialReads = serialized.mock.calls.length
        if (field === 'title') tracks[0]!.title = '原地修改标题'
        else if (field === 'artist') tracks[0]!.artists[0]!.name = '原地修改作者'
        else (tracks[0]!.sourceTags as string[]).push('新增来源标签')
        // No render tick or remount may revive a height measured for old offscreen content.
        expect(session.findSlot(0, -1_000_000)).toMatchObject({ id: '0', height: 144 })
        expect(serialized.mock.calls.length).toBeGreaterThan(initialReads)
        await settle()
        test.customTags.value = new Map([['0', ['新增自定义标签']]])
        await settle()
        test.scroll.scrollTop = 0
        test.scroll.dispatchEvent(new Event('scroll'))
        await settle()
        const first = test.cells().find((cell) => cell.dataset.queueDropId === '0')!
        expect(first.textContent).toContain(field === 'title' ? '原地修改标题' : '歌曲 0')
        expect(first.textContent).toContain(field === 'artist' ? '原地修改作者' : '作者')
        expect(first.textContent).toContain('新增自定义标签')
        expect(test.play).not.toHaveBeenCalled()
        expect(test.select).not.toHaveBeenCalled()
      } finally {
        test.unmount()
      }
    },
  )

  it.each([0, 1, 80, 1_000, 10_000])(
    'bounds real card mounting for %i tracks and cleans its adapter',
    async (count) => {
      const test = setup(count)
      await settle()
      try {
        const cells = test.cells()
        expect(cells.length).toBe(count < 2 ? count : Math.min(count, 15))
        for (const cell of cells) {
          expect(cell.props.role).toBe('listitem')
          expect(cell.props['aria-setsize']).toBe(count)
          expect(cell.querySelectorAll('[data-queue-drop-kind]')).toHaveLength(0)
          expect(cell.querySelectorAll('[data-am-grid-motion]')).toHaveLength(1)
        }
        if (count > 80) {
          test.scroll.scrollTop = 15_000
          test.scroll.dispatchEvent(new Event('scroll'))
          await settle()
          expect(test.cells().length).toBeLessThanOrEqual(24)
          expect(test.cells().some((cell) => cell.dataset.queueDropId === '0')).toBe(false)
        }
        expect(test.play).not.toHaveBeenCalled()
        expect(test.select).not.toHaveBeenCalled()
      } finally {
        test.unmount()
      }
      expect(test.releaseAdapter).toHaveBeenCalledOnce()
      expect(test.adapter()).toBeUndefined()
    },
  )

  it('mounts previously offscreen filter matches and keeps broad and cleared results virtual', async () => {
    const test = setup(1_000)
    await settle()
    try {
      expect(test.cells().some((cell) => cell.dataset.queueDropId === '900')).toBe(false)
      test.filters.value = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '歌曲 900' }],
      }
      await settle()
      expect(test.cells().map((cell) => cell.dataset.queueDropId)).toEqual(['900'])
      expect(test.cells()[0]!.props['aria-setsize']).toBe(1)
      dispatchCatalogEvent(
        findCatalogElement(
          test.cells()[0]!,
          (node) => node.props['data-am-focus-key'] === 'track:900:play',
        ),
        'onClick',
        false,
      )
      expect(test.play).toHaveBeenCalledExactlyOnceWith('900')

      test.filters.value = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '歌曲 9' }],
      }
      await settle()
      expect(test.filteredTracks.value).toHaveLength(111)
      expect(test.cells().length).toBeGreaterThan(0)
      expect(test.cells().length).toBeLessThanOrEqual(24)
      for (const cell of test.cells()) {
        expect(cell.props['aria-setsize']).toBe(111)
        expect(cell.textContent).toContain(`歌曲 ${cell.dataset.queueDropId}`)
        expect(cell.dataset.queueDropId?.startsWith('9')).toBe(true)
      }

      test.filters.value = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '不存在的歌曲' }],
      }
      await settle()
      expect(test.cells()).toHaveLength(0)

      test.filters.value = createCatalogTrackFilterState()
      await settle()
      expect(test.cells().length).toBeGreaterThan(0)
      expect(test.cells().length).toBeLessThanOrEqual(24)
      expect(test.cells()[0]!.props['aria-setsize']).toBe(1_000)
      expect(test.cells().some((cell) => cell.dataset.queueDropId === '900')).toBe(false)
      expect(test.select).not.toHaveBeenCalled()
    } finally {
      test.unmount()
    }
  })

  it.each(['default', 'minimal'] as const)(
    'keeps %s rows, intents and stable keys across densities and columns',
    async (skin) => {
      const test = setup(80, skin)
      await settle()
      try {
        const first = test.cells()[0]!
        for (const [mode, columns] of [
          ['compact', 4],
          ['comfortable', 2],
          ['standard', 3],
        ] as const) {
          test.displayMode.value = mode
          test.columns.value = columns
          test.view.dispatchEvent(new Event('resize'))
          // eslint-disable-next-line no-await-in-loop -- Verify every committed density.
          await settle()
          expect(test.cells().find((cell) => cell.dataset.queueDropId === '0')).toBe(first)
          expect(first.querySelectorAll('[data-am-grid-motion]')).toHaveLength(1)
        }
        const play = findCatalogElement(
          first,
          (node) => node.props['data-am-focus-key'] === 'track:0:play',
        )
        dispatchCatalogEvent(play, 'onClick', false)
        expect(test.play).toHaveBeenCalledExactlyOnceWith('0')
        const menu = findCatalogElement(
          first,
          (node) => node.props['data-am-focus-key'] === 'track:0:actions',
        )
        dispatchCatalogEvent(menu, 'onClick', false)
        expect(test.showActions).toHaveBeenCalledExactlyOnceWith('0')
        test.customTags.value = new Map([['0', ['新增标签']]])
        test.tracks.value = test.tracks.value.map((track) =>
          track.id === '0' ? { ...track, title: '更新标题' } : track,
        )
        await settle()
        expect(first.textContent).toContain('更新标题')
        if (skin === 'minimal') expect(first.textContent).toContain('新增标签')
        expect(test.cells()[0]).toBe(first)
      } finally {
        test.unmount()
      }
    },
  )

  it('preserves a remote opener until its actual dialog lifetime ends, then unmounts it', async () => {
    const test = setup(1_000)
    await settle()
    try {
      const first = test.cells()[0]!
      test.overlays().trackActionId.value = '0'
      await settle()
      test.scroll.scrollTop = 15_000
      test.scroll.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.cells()).toContain(first)
      expect(test.cells().length).toBeLessThan(30)
      test.overlays().trackActionId.value = undefined
      await settle()
      expect(test.cells()).not.toContain(first)
    } finally {
      test.unmount()
    }
  })

  it('creates full offscreen destinations while only mounted slots receive offsets', async () => {
    // Match the estimate so window ingress alone changes no spatial geometry.
    const test = setup(1_000, 'default', 144)
    await settle()
    try {
      const grid = test.cells()[0]!.parent! as unknown as HTMLElement
      const bounds = grid.getBoundingClientRect.bind(grid)
      grid.getBoundingClientRect = () => ({ ...bounds(), top: bounds().top + 0.3 })
      test.view.dispatchEvent(new Event('resize'))
      await settle()
      const container = test.root as unknown as HTMLElement
      const ids = test.tracks.value.map(({ id }) => id)
      const session = test.adapter().createGeometry({
        kind: 'track',
        sourceId: '0',
        ids,
        eligibleIds: new Set(ids),
        container,
        bounds: { top: 0, left: 0, width: 1000, height: 300 } as DOMRect,
        initialScrollTop: 0,
      })!
      expect(session.sourceElement).toBe(test.cells()[0])
      expect(session.findSlot(500, 500_000)?.id).toBe('999')
      expect(session.getOffsets('998').size).toBeLessThan(24)
      const release = test.adapter().retainItem('track', '0')!
      test.scroll.scrollTop = 15_000.3
      test.scroll.dispatchEvent(new Event('scroll'))
      await settle()
      expect(test.cells()).toContain(session.sourceElement as unknown as CatalogTestElement)
      expect(session.isValid?.()).toBe(true)
      release()
    } finally {
      test.unmount()
    }
  })

  it('mounts and focuses a distant handle by key and rejects aborted navigation', async () => {
    const test = setup(1_000)
    await settle()
    try {
      const controller = new AbortController()
      expect(await test.adapter().focusItem('track', '900', controller.signal)).toBe(true)
      expect(
        (test.document.activeElement as unknown as CatalogTestElement).props['data-queue-handle'],
      ).toBeDefined()
      expect(test.cells().some((cell) => cell.dataset.queueDropId === '900')).toBe(true)
      expect(test.cells().length).toBeLessThan(30)
      controller.abort()
      expect(await test.adapter().focusItem('track', '1', controller.signal)).toBe(false)
    } finally {
      test.unmount()
    }
  })

  it('refreshes destinations when newly measured rows differ from their estimates', async () => {
    const test = setup(1_000)
    await settle()
    try {
      const ids = test.tracks.value.map(({ id }) => id)
      const session = test.adapter().createGeometry({
        kind: 'track',
        sourceId: '0',
        ids,
        eligibleIds: new Set(ids),
        container: test.root as unknown as HTMLElement,
        bounds: { top: 0, left: 0, width: 1000, height: 300 } as DOMRect,
        initialScrollTop: 0,
      })!
      const release = test.adapter().retainItem('track', '0')!
      expect(session.isValid?.()).toBe(true)
      test.scroll.scrollTop = 15_000
      test.scroll.dispatchEvent(new Event('scroll'))
      await settle()
      expect(session.isValid?.()).toBe(true)
      expect(session.allowsHeightChanges).toBe(true)
      expect(session.findSlot(500, 500_000)?.id).toBe('999')
      expect(session.getOffsets('999').size).toBeLessThan(30)
      test.displayMode.value = 'compact'
      await settle()
      expect(session.isValid?.()).toBe(false)
      release()
    } finally {
      test.unmount()
    }
  })

  it.each(['list-origin', 'direction'] as const)(
    'invalidates measured drag when structural %s changes',
    async (change) => {
      const test = setup(1_000)
      await settle()
      try {
        const ids = test.tracks.value.map(({ id }) => id)
        const session = test.adapter().createGeometry({
          kind: 'track',
          sourceId: '0',
          ids,
          eligibleIds: new Set(ids),
          container: test.root as unknown as HTMLElement,
          bounds: { top: 0, left: 0, width: 1000, height: 300 } as DOMRect,
          initialScrollTop: 0,
        })!
        expect(session.isValid?.()).toBe(true)
        if (change === 'list-origin') {
          const element = (session.sourceElement as unknown as CatalogTestElement)
            .parent! as unknown as HTMLElement
          const original = element.getBoundingClientRect.bind(element)
          element.getBoundingClientRect = () => ({ ...original(), top: 80 })
        } else {
          const original = test.view.getComputedStyle
          test.view.getComputedStyle = () => ({ ...original(), direction: 'rtl' })
        }
        expect(session.isValid?.()).toBe(false)
        test.view.dispatchEvent(new Event('resize'))
        await settle()
        expect(session.isValid?.()).toBe(false)
      } finally {
        test.unmount()
      }
    },
  )
})
