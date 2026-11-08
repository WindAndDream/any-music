import { describe, expect, it } from 'vitest'
import { computed, effectScope, nextTick, shallowRef } from 'vue'

import { useTrackCollectionView } from '#workbench/features/library/use-track-collection-view'

describe('useTrackCollectionView', () => {
  it('restores each collection operator exactly, including manual closing with selected tracks', async () => {
    const scope = effectScope()
    const { queue, favorites } = scope.run(() => ({
      queue: useTrackCollectionView('queue'),
      favorites: useTrackCollectionView('favorites'),
    }))!
    const tab = shallowRef<'queue' | 'favorites' | 'catalog'>('favorites')
    const active = computed(() => (tab.value === 'favorites' ? favorites : queue))

    favorites.summary.value = { ...favorites.summary.value, selectedCount: 2 }
    await nextTick()
    expect(active.value.isOperatorOpen.value).toBe(false)
    favorites.toggleOperator()
    tab.value = 'queue'
    await nextTick()
    expect(active.value.isOperatorOpen.value).toBe(false)
    queue.summary.value = { ...queue.summary.value, selectedCount: 1 }
    await nextTick()
    queue.isOperatorOpen.value = false
    tab.value = 'favorites'
    await nextTick()
    expect(active.value.isOperatorOpen.value).toBe(true)
    favorites.isOperatorOpen.value = false
    tab.value = 'catalog'
    await nextTick()
    tab.value = 'favorites'
    await nextTick()
    expect(active.value.summary.value.selectedCount).toBe(2)
    expect(active.value.isOperatorOpen.value).toBe(false)
    tab.value = 'queue'
    await nextTick()
    expect(active.value.summary.value.selectedCount).toBe(1)
    expect(active.value.isOperatorOpen.value).toBe(false)

    // Neither delayed summaries nor navigation enter selection mode.
    queue.summary.value = { ...queue.summary.value, selectedCount: 2 }
    await nextTick()
    expect(queue.isOperatorOpen.value).toBe(false)
    expect(favorites.isOperatorOpen.value).toBe(false)
    scope.stop()
  })

  it('isolates filter, display preferences and delayed summaries from another collection', async () => {
    const scope = effectScope()
    const { queue, favorites } = scope.run(() => ({
      queue: useTrackCollectionView('queue'),
      favorites: useTrackCollectionView('favorites'),
    }))!
    favorites.openFilter()
    favorites.displayMode.value = 'compact'
    favorites.mobileColumns.value = 2
    queue.toggleOperator()
    await nextTick()
    expect(favorites.isFilterOpen.value).toBe(true)
    expect(favorites.isOperatorOpen.value).toBe(false)
    expect(queue.isFilterOpen.value).toBe(false)
    expect(queue.isOperatorOpen.value).toBe(true)
    expect(queue.displayMode.value).toBe('standard')
    expect(queue.mobileColumns.value).toBe(1)

    queue.summary.value = { selectedCount: 2, totalCount: 3, visibleCount: 3, filterCount: 0 }
    await nextTick()
    expect(favorites.isFilterOpen.value).toBe(true)
    expect(favorites.summary.value.selectedCount).toBe(0)
    queue.isChildModalOpen.value = false
    expect(favorites.isFilterOpen.value).toBe(true)
    scope.stop()
  })
})
