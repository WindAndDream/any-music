import { describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'

import { normalizeCatalogFilterHistorySettings } from '../../../src/composables/music-sources/catalog-filter-history-settings'
import {
  createCatalogFilterHistory,
  normalizeCatalogFilterHistory,
} from '../../../src/composables/music-sources/use-catalog-filter-history'
import { createCatalogTrackFilterState } from '../../../src/composables/music-sources/use-catalog-track-filters'

describe('catalog filter history', () => {
  it('keeps favorites and queue history and retention preferences independent', () => {
    const store = createCatalogFilterHistory()
    const settings = normalizeCatalogFilterHistorySettings({
      contexts: {
        queue: { limits: { search: 1 } },
        favorites: { limits: { search: 2 } },
      },
    })
    store.setSettings(settings)
    for (const scope of ['queue:tracks', 'favorites:tracks']) {
      for (const query of ['旧条件', '新条件', '最新条件'])
        store
          .forScope(scope)
          .remember('search', { ...createCatalogTrackFilterState(), searchFilters: [{ query }] })
    }
    expect(store.forScope('queue:tracks').entries.value).toHaveLength(1)
    expect(store.forScope('favorites:tracks').entries.value).toHaveLength(2)
    expect(settings.contexts?.favorites?.limits.search).toBe(2)
  })
  it('validates new dimensions and preserves independent scope and stable platform identity', () => {
    const settings = normalizeCatalogFilterHistorySettings({ limits: { search: 3, duration: 2 } })
    expect(settings.limits).toMatchObject({ search: 3, duration: 2, naming: 12, platforms: 12 })
    const history = createCatalogFilterHistory({ load: () => [], save: vi.fn() })
    const tracks = history.forScope('catalog:tracks:one')
    const drawers = history.forScope('catalog:drawers')
    tracks.remember('naming', {
      ...createCatalogTrackFilterState(),
      naming: 'custom',
      tags: ['不应带入'],
    })
    drawers.remember('platforms', {
      ...createCatalogTrackFilterState(),
      platformIds: ['Test', 'test', 'Test'],
    })
    expect(tracks.entries.value[0]?.filters).toEqual({
      ...createCatalogTrackFilterState(),
      naming: 'custom',
    })
    expect(drawers.entries.value[0]?.filters.platformIds).toEqual(['Test', 'test'])
    expect(history.forScope('catalog:tracks:two').entries.value).toEqual([])
    const normalized = normalizeCatalogFilterHistory([
      {
        scopeId: 'catalog:drawers',
        dimension: 'platforms',
        filters: { platformIds: ['test', 123, ''] },
      },
      { scopeId: 'catalog:drawers', dimension: 'naming', filters: { naming: 'unknown' } },
      { scopeId: 'catalog:drawers', dimension: 'naming', filters: { naming: 'original' } },
    ])
    expect(normalized.map(({ dimension }) => dimension)).toEqual(['platforms', 'naming'])
    expect(normalized[0]?.filters.platformIds).toEqual(['test'])
  })
  it('persists deduplicated complete dimension snapshots with most recent first', () => {
    const save = vi.fn()
    const history = createCatalogFilterHistory({ load: () => [], save })
    const filters = {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: '夜曲' }],
      tags: ['现场'],
    }
    history.forScope('test').remember('search', filters)
    history.forScope('test').remember('search', { ...filters, searchFilters: [{ query: '晨光' }] })
    history.forScope('test').remember('search', filters)
    expect(history.entries.value).toHaveLength(2)
    expect(history.entries.value[0]?.filters.tags).toEqual([])
    expect(history.entries.value[0]?.filters.searchFilters).toEqual([{ query: '夜曲' }])
    const restored = createCatalogFilterHistory({ load: () => save.mock.calls.at(-1)?.[0], save })
    expect(restored.entries.value).toEqual(history.entries.value)
  })

  it('keeps only twelve records per dimension and ignores empty or corrupt storage values', () => {
    const history = createCatalogFilterHistory()
    for (let index = 0; index < 20; index += 1)
      history.forScope('test').remember('search', {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: `${index}` }],
      })
    expect(history.entries.value).toHaveLength(12)
    history.forScope('test').remember('search', createCatalogTrackFilterState())
    expect(history.entries.value).toHaveLength(12)
    expect(normalizeCatalogFilterHistory(null)).toEqual([])
    expect(
      normalizeCatalogFilterHistory([
        {
          scopeId: 'test',
          dimension: 'published',
          filters: { publishedRanges: [{ from: '2026-02-30', to: '2026-03-01' }] },
        },
        {
          scopeId: 'test',
          dimension: 'published',
          filters: { publishedRanges: [{ from: '2026-03-02', to: '2026-03-01' }] },
        },
        {
          scopeId: 'test',
          dimension: 'duration',
          filters: { durationRanges: [{ minMs: -1 }, { maxMs: Infinity }, { minMs: 5, maxMs: 1 }] },
        },
        { scopeId: 'test', dimension: 'other', filters: {} },
      ]),
    ).toEqual([])
  })

  it.each(['search', 'tags', 'published', 'duration'] as const)(
    'persistently removes only the complete %s group, including through a reloaded snapshot',
    (dimension) => {
      const save = vi.fn()
      const filters = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '历史关键词' }],
        tags: ['现场', '纯音乐'],
        publishedRanges: [
          { from: '2026-01-01', to: '2026-01-02' },
          { from: '2026-02-01', to: '2026-02-02' },
        ],
        durationRanges: [{ minMs: 60_000, maxMs: 120_000 }, { maxMs: 30_000 }],
      }
      const history = createCatalogFilterHistory({ load: () => [], save })
      for (const value of ['search', 'tags', 'published', 'duration'] as const)
        history.forScope('test').remember(value, filters)
      const otherFilters = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '另一组' }],
        tags: ['独奏'],
        publishedRanges: [{ from: '2026-03-01', to: '2026-03-02' }],
        durationRanges: [{ minMs: 180_000 }],
      }
      history.forScope('test').remember(dimension, otherFilters)
      const reloaded = createCatalogFilterHistory({ load: () => history.entries.value, save })
      const target = reloaded.entries.value.find(
        (entry) =>
          entry.dimension === dimension &&
          JSON.stringify(entry.filters) !== JSON.stringify(history.entries.value[0]!.filters),
      )!
      const remaining = history.entries.value.filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(target),
      )
      save.mockClear()
      history.forScope('test').remove(target)
      expect(history.entries.value).toEqual(remaining)
      expect(save).toHaveBeenCalledExactlyOnceWith(remaining)
      expect(
        createCatalogFilterHistory({ load: () => save.mock.calls[0]?.[0], save }).entries.value,
      ).toEqual(remaining)
      history.forScope('test').remove(target)
      expect(save).toHaveBeenCalledOnce()
      expect(filters.tags).toEqual(['现场', '纯音乐'])
      expect(filters.publishedRanges).toHaveLength(2)
    },
  )

  it('persists independent limits, prunes oldest records immediately, and restores settings', () => {
    const save = vi.fn()
    const saveSettings = vi.fn()
    const history = createCatalogFilterHistory({ load: () => [], save, saveSettings })
    for (let index = 0; index < 5; index += 1) {
      history.forScope('test').remember('search', {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: `${index}` }],
      })
      history.forScope('test').remember('tags', {
        ...createCatalogTrackFilterState(),
        tags: [`标签 ${index}`],
        searchFilters: [{ query: '不保存其他维度' }],
      })
      history.forScope('test').remember('duration', {
        ...createCatalogTrackFilterState(),
        durationRanges: [{ minMs: index + 1 }],
      })
    }
    const settings = {
      limits: { search: 2, tags: 1, published: 12, duration: 0, platforms: 12, naming: 12 },
      collapseAfter: 2,
    }
    history.setSettings(settings)
    expect(
      history.entries.value
        .filter((entry) => entry.dimension === 'search')
        .map((entry) => entry.filters.searchFilters[0]?.query),
    ).toEqual(['4', '3'])
    expect(
      history.entries.value
        .filter((entry) => entry.dimension === 'tags')
        .map((entry) => entry.filters.tags),
    ).toEqual([['标签 4']])
    expect(
      history.entries.value.find((entry) => entry.dimension === 'tags')?.filters.searchFilters,
    ).toEqual([])
    expect(history.entries.value.some((entry) => entry.dimension === 'duration')).toBe(false)
    expect(saveSettings).toHaveBeenLastCalledWith(settings)
    const restored = createCatalogFilterHistory({
      load: () => save.mock.calls.at(-1)?.[0],
      save,
      loadSettings: () => saveSettings.mock.calls.at(-1)?.[0],
    })
    expect(restored.settings.value).toEqual(settings)
    expect(restored.entries.value).toEqual(history.entries.value)
    restored.forScope('test').remember('duration', {
      ...createCatalogTrackFilterState(),
      durationRanges: [{ minMs: 42 }],
    })
    expect(restored.entries.value.some((entry) => entry.dimension === 'duration')).toBe(false)
  })

  it('supports limits above twelve without starving later dimensions while pruning', () => {
    const history = createCatalogFilterHistory()
    history.setSettings({
      limits: { search: 100, tags: 100, published: 100, duration: 100, platforms: 12, naming: 12 },
      collapseAfter: 3,
    })
    history.forScope('test').remember('published', {
      ...createCatalogTrackFilterState(),
      publishedRanges: [{ from: '2026-01-01', to: '2026-01-02' }],
    })
    for (let index = 0; index < 110; index += 1)
      history.forScope('test').remember('search', {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: `${index}` }],
      })
    expect(history.entries.value.filter((entry) => entry.dimension === 'search')).toHaveLength(100)
    history.setSettings({
      limits: { search: 1, tags: 1, published: 1, duration: 1, platforms: 12, naming: 12 },
      collapseAfter: 1,
    })
    expect(history.entries.value.map((entry) => entry.dimension)).toEqual(['search', 'published'])
  })

  it('normalizes missing, invalid, and out-of-bounds settings and corrupt tag histories', () => {
    expect(normalizeCatalogFilterHistorySettings(undefined)).toEqual({
      limits: { search: 12, tags: 12, published: 12, duration: 12, platforms: 12, naming: 12 },
      collapseAfter: 3,
    })
    expect(
      normalizeCatalogFilterHistorySettings({
        limits: { search: -1, tags: 150, published: NaN, duration: 2.9, platforms: 12, naming: 12 },
        collapseAfter: 0,
      }),
    ).toEqual({
      limits: { search: 0, tags: 100, published: 12, duration: 2, platforms: 12, naming: 12 },
      collapseAfter: 1,
    })
    const entries = normalizeCatalogFilterHistory([
      {
        scopeId: 'test',
        dimension: 'tags',
        filters: { tags: [null, 42, '  ', '  现场 ', '现场', '纯音乐'] },
      },
    ])
    expect(entries[0]?.filters.tags).toEqual(['现场', '纯音乐'])
  })

  it('isolates identical dimensions, deduplication, deletion and restored histories by owner', () => {
    const save = vi.fn()
    const store = createCatalogFilterHistory({ load: () => [], save })
    const drawers = store.forScope('catalog:drawers')
    const tracks = store.forScope('catalog:tracks:A')
    const otherTracks = store.forScope('catalog:tracks:a')
    const filters = {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: '同一个关键词' }],
    }
    for (const history of [drawers, tracks, otherTracks]) history.remember('search', filters)
    expect(store.entries.value).toHaveLength(3)
    for (const history of [drawers, tracks, otherTracks])
      expect(history.entries.value).toHaveLength(1)
    drawers.remove(tracks.entries.value[0]!)
    expect(save).toHaveBeenCalledTimes(3)
    drawers.remove(drawers.entries.value[0]!)
    const restored = createCatalogFilterHistory({ load: () => save.mock.calls.at(-1)?.[0], save })
    expect(restored.forScope('catalog:drawers').entries.value).toEqual([])
    expect(restored.forScope('catalog:tracks:A').entries.value).toEqual(tracks.entries.value)
    expect(restored.forScope('catalog:tracks:a').entries.value).toEqual(otherTracks.entries.value)
  })

  it('applies history limits independently to every filter and follows reactive owner changes', () => {
    const store = createCatalogFilterHistory()
    store.setSettings({
      limits: { search: 1, tags: 1, published: 1, duration: 1, platforms: 12, naming: 12 },
      collapseAfter: 1,
    })
    for (const scopeId of ['catalog:drawers', 'catalog:tracks:first', 'catalog:tracks:second']) {
      const history = store.forScope(scopeId)
      for (const query of ['旧条件', scopeId])
        history.remember('search', {
          ...createCatalogTrackFilterState(),
          searchFilters: [{ query }],
        })
    }
    expect(store.entries.value).toHaveLength(3)
    const owner = shallowRef('catalog:drawers')
    const history = store.forScope(owner)
    const oldEntry = history.entries.value[0]!
    owner.value = 'catalog:tracks:second'
    expect(history.entries.value[0]?.filters.searchFilters[0]?.query).toBe(owner.value)
    history.remove(oldEntry)
    expect(store.entries.value).toHaveLength(3)
    store.setSettings({
      limits: { search: 0, tags: 1, published: 1, duration: 1, platforms: 12, naming: 12 },
      collapseAfter: 1,
    })
    expect(history.entries.value).toEqual([])
  })

  it('does not assign unowned legacy or invalid histories to a filter', () => {
    const filters = { ...createCatalogTrackFilterState(), searchFilters: [{ query: '旧共用记录' }] }
    expect(
      normalizeCatalogFilterHistory([
        { dimension: 'search', filters },
        { scopeId: '', dimension: 'search', filters },
        { scopeId: 'x'.repeat(201), dimension: 'search', filters },
      ]),
    ).toEqual([])
  })

  it('normalizes region settings using independent defaults and ignoring unknown regions', () => {
    expect(
      normalizeCatalogFilterHistorySettings({
        limits: { search: 8, published: 5 },
        collapseAfter: 4,
        contexts: {
          drawers: { limits: { search: 0, published: 200 }, collapseAfter: 0 },
          tracks: { limits: { tags: NaN, duration: 2.9, platforms: 12, naming: 12 } },
          unknown: { limits: { search: 1 } },
        },
      }),
    ).toEqual({
      limits: { search: 8, tags: 12, published: 5, duration: 12, platforms: 12, naming: 12 },
      collapseAfter: 4,
      contexts: {
        drawers: {
          limits: { search: 0, tags: 12, published: 100, duration: 12, platforms: 12, naming: 12 },
          collapseAfter: 1,
        },
        tracks: {
          limits: { search: 12, tags: 12, published: 12, duration: 2, platforms: 12, naming: 12 },
          collapseAfter: 3,
        },
      },
    })
  })

  it('prunes and reloads region quotas independently while every track list keeps its own history', () => {
    const save = vi.fn()
    const saveSettings = vi.fn()
    const store = createCatalogFilterHistory({ load: () => [], save, saveSettings })
    const owners = ['catalog:drawers', 'catalog:tracks:first', 'catalog:tracks:second']
    for (const owner of owners) {
      for (let index = 1; index <= 4; index += 1) {
        const filters = {
          ...createCatalogTrackFilterState(),
          searchFilters: [{ query: `${owner}-${index}` }],
          publishedRanges: [{ from: `2026-01-0${index}`, to: `2026-01-0${index}` }],
        }
        store.forScope(owner).remember('search', filters)
        store.forScope(owner).remember('published', filters)
      }
    }
    store.setSettings({
      ...normalizeCatalogFilterHistorySettings(undefined),
      contexts: {
        drawers: {
          limits: { search: 0, published: 1, tags: 12, duration: 12, platforms: 12, naming: 12 },
          collapseAfter: 1,
        },
        tracks: {
          limits: { search: 2, published: 3, tags: 12, duration: 12, platforms: 12, naming: 12 },
          collapseAfter: 2,
        },
      },
    })
    const restored = createCatalogFilterHistory({
      load: () => save.mock.calls.at(-1)?.[0],
      save,
      loadSettings: () => saveSettings.mock.calls.at(-1)?.[0],
    })
    expect(restored.forScope('catalog:drawers').entries.value).toHaveLength(1)
    expect(restored.forScope('catalog:drawers').entries.value[0]?.dimension).toBe('published')
    for (const owner of owners.slice(1)) {
      const entries = restored.forScope(owner).entries.value
      expect(entries.filter((entry) => entry.dimension === 'published')).toHaveLength(3)
      expect(
        entries
          .filter((entry) => entry.dimension === 'search')
          .map((entry) => entry.filters.searchFilters[0]?.query),
      ).toEqual([`${owner}-4`, `${owner}-3`])
    }
    restored.forScope('catalog:drawers').remember('search', {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: '不保存' }],
    })
    expect(restored.forScope('catalog:drawers').entries.value).toHaveLength(1)
    const owner = shallowRef('catalog:drawers')
    const filter = restored.forScope(owner)
    expect(filter.settings.value.collapseAfter).toBe(1)
    owner.value = 'catalog:tracks:first'
    expect(filter.settings.value.collapseAfter).toBe(2)
    restored.setSettings({
      ...restored.settings.value,
      contexts: {
        ...restored.settings.value.contexts,
        tracks: { ...filter.settings.value, collapseAfter: 5 },
      },
    })
    expect(filter.settings.value.collapseAfter).toBe(5)
    expect(restored.forScope('catalog:drawers').settings.value.collapseAfter).toBe(1)
  })

  it('keeps recent filter owners bounded without starving their remaining dimensions', () => {
    const store = createCatalogFilterHistory()
    for (let index = 0; index < 101; index += 1)
      store.forScope(`catalog:tracks:${index}`).remember('search', {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '关键词' }],
      })
    expect(store.entries.value).toHaveLength(100)
    expect(store.forScope('catalog:tracks:0').entries.value).toEqual([])
    store.forScope('catalog:tracks:1').remember('published', {
      ...createCatalogTrackFilterState(),
      publishedRanges: [{ from: '2026-01-01', to: '2026-01-02' }],
    })
    expect(store.forScope('catalog:tracks:1').entries.value).toHaveLength(2)
  })
})
