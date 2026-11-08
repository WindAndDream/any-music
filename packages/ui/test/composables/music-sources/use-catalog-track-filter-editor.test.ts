import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { useCatalogTrackFilterEditor } from '../../../src/composables/music-sources/use-catalog-track-filter-editor'
import { createCatalogTrackFilterState } from '../../../src/composables/music-sources/use-catalog-track-filters'
import { createEditingSession } from '../../../src/composables/use-editing-session'

describe('catalog track filter editor', () => {
  it('retains an explicit feature owner across editor replacement and isolates other collections', () => {
    const editing = createEditingSession()
    const queue = shallowRef(createCatalogTrackFilterState())
    const original = useCatalogTrackFilterEditor({
      filters: queue,
      dimension: 'duration',
      editing: editing.scope('queue'),
    })
    original.minimumMinutes.value = 'unfinished'
    const replacement = useCatalogTrackFilterEditor({
      filters: queue,
      dimension: 'duration',
      editing: editing.scope('queue'),
    })
    const other = useCatalogTrackFilterEditor({
      filters: shallowRef(createCatalogTrackFilterState()),
      dimension: 'duration',
      editing: editing.scope('favorites'),
    })
    expect(replacement.minimumMinutes.value).toBe('unfinished')
    expect(replacement.confirmDraft()).toBe(false)
    expect(other.minimumMinutes.value).toBe('')
    expect(queue.value.durationRanges).toEqual([])
    replacement.resetPendingRange()
    expect(original.minimumMinutes.value).toBe('')
    editing.dispose()
  })
  it('previews valid pending duration edits without committing and ignores invalid input', () => {
    const initialFilters = {
      ...createCatalogTrackFilterState(),
      tags: ['现场'],
      durationRanges: [{ maxMs: 60_000 }, { minMs: 300_000 }],
    }
    const filters = shallowRef(initialFilters)
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'duration', initialIndex: 0 })
    editor.maximumMinutes.value = '2'
    expect(editor.previewFilters.value.durationRanges).toEqual([
      { minMs: undefined, maxMs: 120_000 },
      { minMs: 300_000 },
    ])
    expect(editor.previewFilters.value.tags).toEqual(['现场'])
    expect(filters.value).toEqual(initialFilters)
    editor.minimumMinutes.value = '3'
    expect(editor.previewFilters.value).toEqual(initialFilters)
  })

  it('previews complete pending dates while retaining siblings and leaves incomplete dates unapplied', () => {
    const initialFilters = {
      ...createCatalogTrackFilterState(),
      publishedRanges: [{ from: '2026-01-01', to: '2026-01-02' }],
    }
    const filters = shallowRef(initialFilters)
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'published' })
    editor.selectPublishedDate('2026-02-01')
    expect(editor.previewFilters.value).toEqual(initialFilters)
    editor.setPublishedStage('end')
    editor.selectPublishedDate('2026-02-02')
    expect(editor.previewFilters.value.publishedRanges).toEqual([
      ...initialFilters.publishedRanges,
      { from: '2026-02-01', to: '2026-02-02' },
    ])
    expect(filters.value).toEqual(initialFilters)
    const preview = editor.previewFilters.value
    editor.confirmDraft()
    expect(filters.value).toEqual(preview)
  })

  it('replaces its single search keyword and removes the criterion for blank input', () => {
    const filters = shallowRef(createCatalogTrackFilterState())
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'search' })
    editor.searchQuery.value = '夜曲'
    editor.searchQuery.value = '晨光'
    expect(filters.value.searchFilters).toEqual([{ query: '晨光' }])
    editor.searchQuery.value = '  '
    expect(filters.value.searchFilters).toEqual([])
  })

  it('allows a same-day range and rejects end dates before the selected start', () => {
    const filters = shallowRef(createCatalogTrackFilterState())
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'published' })
    editor.selectPublishedDate('2026-02-28')
    expect(editor.confirmDraft()).toBe(false)
    expect(filters.value.publishedRanges).toEqual([])
    editor.setPublishedStage('end')
    expect(editor.pendingEnd.value).toBe('2026-02-28')
    editor.selectPublishedDate('2026-02-27')
    expect(editor.pendingEnd.value).toBe('2026-02-28')
    expect(editor.addPublishedRange()).toBe(true)
    expect(filters.value.publishedRanges).toEqual([{ from: '2026-02-28', to: '2026-02-28' }])
  })

  it('loads the clicked range and replaces that range while preserving its siblings', () => {
    const filters = shallowRef({
      ...createCatalogTrackFilterState(),
      publishedRanges: [
        { from: '2026-01-01', to: '2026-01-15' },
        { from: '2026-02-01', to: '2026-02-15' },
      ],
    })
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'published', initialIndex: 1 })
    expect(editor.pendingStart.value).toBe('2026-02-01')
    expect(editor.pendingEnd.value).toBe('2026-02-15')
    editor.selectPublishedDate('2026-02-20')
    expect(editor.confirmDraft()).toBe(true)
    expect(filters.value.publishedRanges).toEqual([
      { from: '2026-01-01', to: '2026-01-15' },
      { from: '2026-02-01', to: '2026-02-20' },
    ])
  })

  it('edits only the active date endpoint and confirms a complete range from either stage', () => {
    const filters = shallowRef({
      ...createCatalogTrackFilterState(),
      publishedRanges: [{ from: '2026-02-01', to: '2026-02-15' }],
    })
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'published', initialIndex: 0 })
    editor.setPublishedStage('start')
    editor.selectPublishedDate('2026-02-05')
    expect(editor.pendingEnd.value).toBe('2026-02-15')
    editor.selectPublishedDate('2026-02-16')
    expect(editor.pendingStart.value).toBe('2026-02-05')
    expect(editor.pendingEnd.value).toBe('2026-02-15')
    editor.setPublishedStage('end')
    editor.selectPublishedDate('2026-02-04')
    expect(editor.pendingEnd.value).toBe('2026-02-15')
    editor.selectPublishedDate('2026-02-20')
    expect(editor.pendingStart.value).toBe('2026-02-05')
    editor.setPublishedStage('start')
    expect(editor.canAddPublishedRange.value).toBe(true)
    expect(editor.confirmDraft()).toBe(true)
    expect(filters.value.publishedRanges).toEqual([{ from: '2026-02-05', to: '2026-02-20' }])
  })

  it('validates duration input, accepts zero and one-sided limits and deduplicates ranges', () => {
    const filters = shallowRef(createCatalogTrackFilterState())
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'duration' })
    editor.minimumMinutes.value = '4'
    editor.maximumMinutes.value = '2'
    expect(editor.addDurationRange()).toBe(false)
    expect(editor.durationError.value).toContain('不能小于')
    editor.minimumMinutes.value = '-1'
    expect(editor.confirmDraft()).toBe(false)
    editor.minimumMinutes.value = '-0.0000001'
    expect(editor.confirmDraft()).toBe(false)
    editor.minimumMinutes.value = '1e308'
    expect(editor.confirmDraft()).toBe(false)
    editor.minimumMinutes.value = 'abc'
    expect(editor.confirmDraft()).toBe(false)
    editor.minimumMinutes.value = '0'
    expect(editor.addDurationRange()).toBe(true)
    editor.minimumMinutes.value = '0'
    editor.maximumMinutes.value = '2'
    editor.addDurationRange()
    expect(filters.value.durationRanges).toEqual([{ minMs: 0, maxMs: 120_000 }])
    editor.maximumMinutes.value = '5'
    expect(editor.confirmDraft()).toBe(true)
    expect(filters.value.durationRanges).toHaveLength(2)
  })

  it('retains duration precision while editing and adjusts the edit index after removal', () => {
    const filters = shallowRef({
      ...createCatalogTrackFilterState(),
      durationRanges: [
        { minMs: 0, maxMs: 30_000 },
        { minMs: 65_123, maxMs: 98_765 },
      ],
    })
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'duration', initialIndex: 1 })
    editor.removeRange(0)
    expect(editor.editingIndex.value).toBe(0)
    editor.confirmDraft()
    expect(filters.value.durationRanges).toEqual([{ minMs: 65_123, maxMs: 98_765 }])
  })

  it('restores the complete historical dimension and leaves other dimensions unchanged', () => {
    const filters = shallowRef({
      ...createCatalogTrackFilterState(),
      tags: ['现场'],
      durationRanges: [{ minMs: 60_000 }],
    })
    const editor = useCatalogTrackFilterEditor({ filters, dimension: 'duration' })
    editor.minimumMinutes.value = '100'
    const snapshot = {
      ...createCatalogTrackFilterState(),
      durationRanges: [{ maxMs: 120_000 }, { minMs: 300_000 }],
    }
    editor.restoreHistory({ scopeId: 'test', dimension: 'duration', filters: snapshot })
    expect(filters.value.durationRanges).toEqual(snapshot.durationRanges)
    expect(filters.value.tags).toEqual(['现场'])
    expect(editor.minimumMinutes.value).toBe('')
    expect(editor.maximumMinutes.value).toBe('2')
    editor.maximumMinutes.value = '3'
    editor.confirmDraft()
    expect(snapshot.durationRanges[0]).toEqual({ maxMs: 120_000 })
    expect(filters.value.durationRanges).toEqual([
      { minMs: undefined, maxMs: 180_000 },
      { minMs: 300_000 },
    ])
  })
})
