import type { CatalogTrackDisplayMode, MobileTrackColumns, QueueListSummary } from '@any-music/ui'
import { useCatalogSelectionOperator } from '@any-music/ui/library'
import { shallowRef } from 'vue'

/** 每个集合独占会话视图状态；导航只隐藏界面，不重新用勾选数推导手动开关。 */
export function useTrackCollectionView(context: 'queue' | 'favorites' | 'downloads') {
  const isFilterOpen = shallowRef(false)
  const isOperatorOpen = shallowRef(false)
  const isOperatorAvailable = shallowRef(false)
  const isChildModalOpen = shallowRef(false)
  const displayMode = shallowRef<CatalogTrackDisplayMode>('standard')
  const mobileColumns = shallowRef<MobileTrackColumns>(1)
  const summary = shallowRef<QueueListSummary>({
    selectedCount: 0,
    visibleCount: 0,
    totalCount: 0,
    filterCount: 0,
  })
  useCatalogSelectionOperator({
    context,

    open: isOperatorOpen,
  })

  function openFilter(): void {
    isOperatorOpen.value = false
    isFilterOpen.value = true
  }

  function toggleOperator(): void {
    isFilterOpen.value = false
    isOperatorOpen.value = !isOperatorOpen.value
  }

  return {
    isFilterOpen,
    isOperatorOpen,
    isOperatorAvailable,
    isChildModalOpen,
    displayMode,
    mobileColumns,
    summary,

    openFilter,
    toggleOperator,
  }
}
