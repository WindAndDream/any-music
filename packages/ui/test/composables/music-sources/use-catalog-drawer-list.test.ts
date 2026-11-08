import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import {
  filterCatalogDrawers,
  useCatalogDrawerList,
} from '../../../src/composables/music-sources/use-catalog-drawer-list'
import { createCatalogTrackFilterState } from '../../../src/composables/music-sources/use-catalog-track-filters'
import type { CatalogDrawerView } from '../../../src/product/catalog-drawer'

function createDrawer(id: string, overrides: Partial<CatalogDrawerView> = {}): CatalogDrawerView {
  return {
    id,
    title: id,
    input: '原始词',
    pluginId: 'test',
    pluginName: '测试源',
    kind: 'search',
    createdAtMs: new Date(2026, 8, 30, 12).getTime(),
    isExpanded: false,
    isSourceEnabled: true,
    loadedPageCount: 0,
    tracks: [],
    hasMore: false,
    isLoading: false,
    status: 'idle',
    errorMessage: '',
    invalidReason: '',
    ...overrides,
  }
}

describe('catalog drawer filtering and selection', () => {
  it('unions platforms and intersects naming, text and dates without changing source order', () => {
    const drawers = [
      createDrawer('A', { pluginId: 'bilibili', isCustomNamed: true }),
      createDrawer('B', { pluginId: 'douyin', isCustomNamed: true }),
      createDrawer('C', { pluginId: 'bilibili', isCustomNamed: false }),
      createDrawer('D', { pluginId: 'other', isCustomNamed: true }),
    ]
    const filters = {
      ...createCatalogTrackFilterState(),
      platformIds: ['douyin', 'bilibili'],
      naming: 'custom' as const,
      searchFilters: [{ query: '原始词' }],
      publishedRanges: [{ from: '2026-09-30', to: '2026-09-30' }],
    }
    expect(filterCatalogDrawers(drawers, filters)).toEqual(drawers.slice(0, 2))
    expect(filterCatalogDrawers(drawers, { ...filters, naming: 'original' })).toEqual([drawers[2]])
    expect(filterCatalogDrawers(drawers, { ...filters, platformIds: ['missing'] })).toEqual([])
  })

  it('restores only selected custom names and ignores requests after disposal', () => {
    const scope = effectScope()
    const restoreNames = vi.fn()
    const state = scope.run(() =>
      useCatalogDrawerList({
        drawers: [createDrawer('A', { isCustomNamed: true }), createDrawer('B')],
        invalidTrackIds: new Set(),
        filterOpen: false,
        confirm: vi.fn(),
        removeMany: vi.fn(),
        restoreNames,
      }),
    )!
    state.controls.toggleAllVisible()
    state.requestRestoreSelectedNames()
    expect(restoreNames).toHaveBeenCalledExactlyOnceWith(['A'])
    expect(state.controls.selectedCount.value).toBe(0)
    state.controls.toggleItem('B')
    state.requestRestoreSelectedNames()
    expect(restoreNames).toHaveBeenLastCalledWith([])
    scope.stop()
    state.requestRestoreSelectedNames()
    expect(restoreNames).toHaveBeenCalledTimes(2)
  })
  it('groups disconnected lists separately from actual failures and updates when their source returns', () => {
    const scope = effectScope()
    const drawers = shallowRef([
      createDrawer('ready', { status: 'ready' }),
      createDrawer('disabled', { status: 'disconnected', isSourceEnabled: false }),
      createDrawer('removed', { status: 'missing', isSourceEnabled: false }),
      createDrawer('old-error', {
        status: 'error',
        isSourceEnabled: false,
        tracks: [{ id: 'invalid' }] as never,
      }),
      createDrawer('error', { status: 'error' }),
      createDrawer('invalid-source', { status: 'paused' }),
      createDrawer('invalid-track', { tracks: [{ id: 'invalid' }] as never }),
    ])
    const state = scope.run(() =>
      useCatalogDrawerList({
        drawers,
        invalidTrackIds: new Set(['invalid']),
        filterOpen: false,
        confirm: vi.fn(),
        removeMany: vi.fn(),
      }),
    )!
    expect([
      state.availableCount.value,
      state.unavailableCount.value,
      state.attentionCount.value,
    ]).toEqual([1, 3, 3])
    state.stateFilter.value = 'unavailable'
    expect(state.stateFilteredDrawers.value.map((drawer) => drawer.id)).toEqual([
      'disabled',
      'removed',
      'old-error',
    ])
    state.stateFilter.value = 'attention'
    expect(state.stateFilteredDrawers.value.map((drawer) => drawer.id)).toEqual([
      'error',
      'invalid-source',
      'invalid-track',
    ])
    state.stateFilter.value = 'available'
    expect(state.stateFilteredDrawers.value.map((drawer) => drawer.id)).toEqual(['ready'])
    drawers.value = drawers.value.map((drawer) =>
      drawer.id === 'disabled' ? createDrawer(drawer.id, { status: 'ready' }) : drawer,
    )
    expect(state.stateFilteredDrawers.value.map((drawer) => drawer.id)).toEqual([
      'ready',
      'disabled',
    ])
    expect([
      state.availableCount.value,
      state.unavailableCount.value,
      state.attentionCount.value,
    ]).toEqual([2, 2, 3])
    scope.stop()
  })

  it('matches normalized title, request and source while preserving pinned/input order', () => {
    const drawers = [
      createDrawer('Live', { isPinned: true }),
      createDrawer('B', { input: 'LIVE现场' }),
      createDrawer('C', { pluginName: 'Live平台' }),
    ]
    const filters = { ...createCatalogTrackFilterState(), searchFilters: [{ query: ' ＬＩＶＥ ' }] }
    expect(filterCatalogDrawers(drawers, filters).map((drawer) => drawer.id)).toEqual([
      'Live',
      'B',
      'C',
    ])
  })

  it('unions local date ranges, includes the entire last day and intersects text', () => {
    const drawers = [
      createDrawer('A', { createdAtMs: new Date(2026, 8, 30, 23, 59, 59, 999).getTime() }),
      createDrawer('B', { createdAtMs: new Date(2026, 9, 1).getTime() }),
      createDrawer('C', { createdAtMs: new Date(2026, 9, 3).getTime() }),
      createDrawer('unknown', { createdAtMs: undefined }),
      createDrawer('invalid', { createdAtMs: NaN }),
    ]
    const filters = {
      ...createCatalogTrackFilterState(),
      publishedRanges: [
        { from: '2026-09-30', to: '2026-09-30' },
        { from: '2026-10-03', to: '2026-10-03' },
      ],
    }
    expect(filterCatalogDrawers(drawers, filters).map((drawer) => drawer.id)).toEqual(['A', 'C'])
    expect(
      filterCatalogDrawers(drawers, { ...filters, searchFilters: [{ query: 'C' }] }).map(
        (drawer) => drawer.id,
      ),
    ).toEqual(['C'])
    expect(
      filterCatalogDrawers(drawers, {
        ...filters,
        publishedRanges: [{ from: '', to: '2026-09-30' }],
      }).map((drawer) => drawer.id),
    ).toEqual(['A'])
    expect(filterCatalogDrawers(drawers, createCatalogTrackFilterState())).toHaveLength(5)
  })

  it('previews without applying, discards cancelled drafts and only selects matches', async () => {
    const scope = effectScope()
    const drawers = shallowRef([createDrawer('A'), createDrawer('B')])
    const filterOpen = shallowRef(false)
    const state = scope.run(() =>
      useCatalogDrawerList({
        drawers,
        invalidTrackIds: new Set(),
        filterOpen,
        confirm: vi.fn(),
        removeMany: vi.fn(),
      }),
    )!
    filterOpen.value = true
    await nextTick()
    state.filterDraft.value = {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: 'A' }],
    }
    state.filterPreview.value = state.filterDraft.value
    expect(state.previewDrawers.value).toHaveLength(1)
    expect(state.summary.value.visibleCount).toBe(2)
    filterOpen.value = false
    await nextTick()
    expect(state.filterDraft.value.searchFilters).toEqual([])
    filterOpen.value = true
    await nextTick()
    state.filterDraft.value = {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: 'A' }],
    }
    state.applyFilterDraft()
    state.controls.toggleAllVisible()
    expect(state.summary.value).toEqual({
      selectedCount: 1,
      visibleCount: 1,
      totalCount: 2,
      filterCount: 1,
    })
    expect([...state.controls.selectedIds.value]).toEqual(['A'])
    drawers.value = [createDrawer('B')]
    expect(state.controls.selectedCount.value).toBe(0)
    scope.stop()
  })

  it('requires delete confirmation, prunes removed targets and ignores confirmation after disposal', async () => {
    const scope = effectScope()
    const drawers = shallowRef([createDrawer('A'), createDrawer('B', { status: 'error' })])
    const confirm = vi.fn().mockResolvedValueOnce(false)
    const removeMany = vi.fn()
    const state = scope.run(() =>
      useCatalogDrawerList({
        drawers,
        invalidTrackIds: new Set(),
        filterOpen: false,
        confirm,
        removeMany,
      }),
    )!
    state.stateFilter.value = 'attention'
    state.controls.toggleAllVisible()
    await state.requestRemoveSelectedDrawers()
    expect(removeMany).not.toHaveBeenCalled()
    expect(state.summary.value.selectedCount).toBe(1)
    state.stateFilter.value = 'all'
    state.controls.toggleAllVisible()
    let resolveConfirmation!: (confirmed: boolean) => void
    confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirmation = resolve
        }),
    )
    const pending = state.requestRemoveSelectedDrawers()
    drawers.value = [createDrawer('A')]
    resolveConfirmation(true)
    await pending
    expect(removeMany).toHaveBeenCalledExactlyOnceWith(['A'])
    state.controls.toggleAllVisible()
    const disposedRequest = state.requestRemoveSelectedDrawers()
    scope.stop()
    resolveConfirmation(true)
    await disposedRequest
    expect(removeMany).toHaveBeenCalledTimes(1)
  })
})
