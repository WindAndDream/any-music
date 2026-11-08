import { createCatalogTrackFilterState } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readStored, writeStored } from '#workbench/runtime/storage'

vi.mock('#workbench/runtime/storage', () => ({ readStored: vi.fn(), writeStored: vi.fn() }))

import { catalogFilterHistoryRepository } from '#workbench/storage/catalog-filter-history-repository'

describe('catalog filter history repository', () => {
  beforeEach(() => {
    vi.mocked(readStored).mockReset()
    vi.mocked(writeStored).mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  it('saves scoped history separately from the old shared history and existing preferences', () => {
    const entries = [
      {
        scopeId: 'catalog:drawers',
        dimension: 'search' as const,
        filters: { ...createCatalogTrackFilterState(), searchFilters: [{ query: '关键词' }] },
      },
    ]
    const settings = {
      limits: { search: 5, tags: 6, published: 7, duration: 8, platforms: 12, naming: 12 },
      collapseAfter: 2,
    }
    vi.mocked(readStored).mockImplementation((key) =>
      key === 'catalog-filter-history:v2' ? entries : settings,
    )
    expect(catalogFilterHistoryRepository.load()).toEqual(entries)
    expect(catalogFilterHistoryRepository.loadSettings?.()).toEqual(settings)
    catalogFilterHistoryRepository.save(entries)
    catalogFilterHistoryRepository.saveSettings?.(settings)
    expect(writeStored).toHaveBeenCalledWith('catalog-filter-history:v2', entries)
    expect(writeStored).toHaveBeenCalledWith('catalog-filter-history-settings:v1', settings)
    expect(readStored).not.toHaveBeenCalledWith('catalog-filter-history:v1')
  })

  it('allows in-memory operation when the host storage is unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(readStored).mockImplementation(() => {
      throw new Error('unavailable')
    })
    vi.mocked(writeStored).mockImplementation(() => {
      throw new Error('unavailable')
    })
    expect(catalogFilterHistoryRepository.load()).toEqual([])
    expect(catalogFilterHistoryRepository.loadSettings?.()).toBeUndefined()
    expect(() => catalogFilterHistoryRepository.save([])).not.toThrow()
    expect(catalogFilterHistoryRepository.save([])).toMatchObject({ code: 'storage-write-failed' })
    expect(
      catalogFilterHistoryRepository.saveSettings?.({
        limits: { search: 12, tags: 12, published: 12, duration: 12, platforms: 12, naming: 12 },
        collapseAfter: 3,
      }),
    ).toMatchObject({ code: 'storage-write-failed' })
    expect(() =>
      catalogFilterHistoryRepository.saveSettings?.({
        limits: { search: 12, tags: 12, published: 12, duration: 12, platforms: 12, naming: 12 },
        collapseAfter: 3,
      }),
    ).not.toThrow()
  })
})
