import type { ShallowRef } from 'vue'
import { computed, onScopeDispose, readonly, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import {
  hasCatalogDrawerError,
  isCatalogDrawerDisconnected,
} from '../../components/music-sources/catalog-drawer-presentation'
import type { CatalogDrawerStateFilter, CatalogDrawerView } from '../../product/catalog-drawer'
import { useFilterDraft } from '../filters/use-filter-draft'
import type { ConfirmAction } from '../use-confirmation-dialog'
import { editingStateKey, useEditingSession } from '../use-editing-session'
import { useCatalogListControls } from './use-catalog-list-controls'
import {
  cloneCatalogTrackFilterState,
  countCatalogTrackFilters,
  createCatalogTrackFilterState,
  createCatalogDateRangeMatcher,
  matchesCatalogNaming,
  type CatalogPlatformStat,
  type CatalogTrackFilterState,
} from './use-catalog-track-filters'

export interface CatalogDrawerListSummary {
  selectedCount: number
  visibleCount: number
  totalCount: number
  filterCount: number
}

interface UseCatalogDrawerListOptions {
  drawers: MaybeRefOrGetter<readonly CatalogDrawerView[]>
  invalidTrackIds: MaybeRefOrGetter<ReadonlySet<string>>
  filterOpen: MaybeRefOrGetter<boolean>
  confirm: ConfirmAction
  removeMany: (drawerIds: readonly string[]) => void
  restoreNames?: (drawerIds: readonly string[]) => void
}

/** 文本匹配请求摘要，日期匹配原始请求时间；只派生已有列表，不发起新的来源请求。 */
export function filterCatalogDrawers(
  drawers: readonly CatalogDrawerView[],
  filters: CatalogTrackFilterState,
): readonly CatalogDrawerView[] {
  const query = (filters.searchFilters[0]?.query ?? '').normalize('NFKC').trim().toLocaleLowerCase()
  const platforms = new Set(filters.platformIds)
  if (
    !query &&
    platforms.size === 0 &&
    (!filters.naming || filters.naming === 'all') &&
    filters.publishedRanges.length === 0
  )
    return drawers
  const matchesDate = createCatalogDateRangeMatcher(filters.publishedRanges)
  return drawers.filter((drawer) => {
    if (platforms.size > 0 && !platforms.has(drawer.pluginId)) return false
    if (!matchesCatalogNaming(Boolean(drawer.isCustomNamed), filters.naming)) return false
    if (query) {
      const text = `${drawer.title} ${drawer.input} ${drawer.pluginName}`
        .normalize('NFKC')
        .toLocaleLowerCase()
      if (!text.includes(query)) return false
    }
    return matchesDate(drawer.createdAtMs)
  })
}

/** 列表拥有独立筛选草稿与批量选择；面板取消、请求确认和卸载均不留下过期写入。 */
export function useCatalogDrawerList(options: UseCatalogDrawerListOptions) {
  const editing = useEditingSession('catalog-lists')
  const stateFilter = editing.state(stateFilterKey, () =>
    shallowRef<CatalogDrawerStateFilter>('all'),
  )
  const filters = editing.state(filtersKey, () => shallowRef(createCatalogTrackFilterState()))
  const {
    draft: filterDraft,
    preview: filterPreview,
    applyDraft: applyFilterDraft,
  } = useFilterDraft({
    editing,
    applied: filters,
    open: options.filterOpen,
    clone: cloneCatalogTrackFilterState,
    apply: (value) => {
      filters.value = value
    },
  })
  let isDisposed = false
  onScopeDispose(() => {
    isDisposed = true
  })

  function getDrawerState(drawer: CatalogDrawerView): 'available' | 'unavailable' | 'attention' {
    // 来源断开优先于旧列表错误或单曲失效，三个分组互斥，数量之和等于全部列表。
    if (isCatalogDrawerDisconnected(drawer)) return 'unavailable'
    return hasCatalogDrawerError(drawer) ||
      drawer.tracks.some((track) => toValue(options.invalidTrackIds).has(track.id))
      ? 'attention'
      : 'available'
  }

  const stateCounts = computed(() => {
    const counts = { available: 0, unavailable: 0, attention: 0 }
    for (const drawer of toValue(options.drawers)) counts[getDrawerState(drawer)] += 1
    return counts
  })
  const attentionCount = computed(() => stateCounts.value.attention)
  const platformStats = computed<readonly CatalogPlatformStat[]>(() => {
    const platforms = new Map<string, CatalogPlatformStat>()
    for (const drawer of toValue(options.drawers)) {
      const existing = platforms.get(drawer.pluginId)
      if (existing) existing.count += 1
      else
        platforms.set(drawer.pluginId, { id: drawer.pluginId, name: drawer.pluginName, count: 1 })
    }
    return [...platforms.values()]
  })
  const availableCount = computed(() => stateCounts.value.available)
  const unavailableCount = computed(() => stateCounts.value.unavailable)
  const stateFilteredDrawers = computed(() => {
    const drawers = toValue(options.drawers)
    if (stateFilter.value === 'all') return drawers
    return drawers.filter((drawer) => getDrawerState(drawer) === stateFilter.value)
  })
  const visibleDrawers = computed(() =>
    filterCatalogDrawers(stateFilteredDrawers.value, filters.value),
  )
  const previewDrawers = computed(() =>
    filterCatalogDrawers(stateFilteredDrawers.value, filterPreview.value),
  )
  const controls = useCatalogListControls({
    editing,
    items: visibleDrawers,
    getId: (drawer) => drawer.id,
    getName: (drawer) => drawer.title,
  })
  const draftFilterCount = computed(() => countCatalogTrackFilters(filterDraft.value).total)
  const selectedCustomNamedIds = computed(() =>
    toValue(options.drawers)
      .filter((drawer) => drawer.isCustomNamed && controls.selectedIds.value.has(drawer.id))
      .map((drawer) => drawer.id),
  )
  const summary = computed<CatalogDrawerListSummary>(() => ({
    selectedCount: controls.selectedCount.value,
    visibleCount: visibleDrawers.value.length,
    totalCount: toValue(options.drawers).length,
    filterCount: countCatalogTrackFilters(filters.value).total,
  }))

  async function requestRemoveSelectedDrawers(): Promise<void> {
    const drawerIds = [...controls.selectedIds.value]
    if (drawerIds.length === 0) return
    const confirmed = await options.confirm({
      title: '删除音乐列表',
      message: `确定删除已选的 ${drawerIds.length} 个音乐列表吗？只会移除请求配方，不会删除“我的喜欢”或歌单曲目。`,
      confirmLabel: '删除列表',
      tone: 'danger',
    })
    if (!confirmed || isDisposed) return
    const existingIds = new Set(toValue(options.drawers).map((drawer) => drawer.id))
    options.removeMany(drawerIds.filter((id) => existingIds.has(id)))
    controls.clearSelection()
  }

  function requestRestoreSelectedNames(): void {
    if (isDisposed || controls.selectedCount.value === 0) return
    // 只提交实际命名项；原名选项不会引发存储改写，空集合仍可报告“无需恢复”。
    options.restoreNames?.([...selectedCustomNamedIds.value])
    controls.clearSelection()
  }

  return {
    stateFilter,
    filters: readonly(filters),
    filterDraft,
    filterPreview,
    draftFilterCount,
    availableCount,
    unavailableCount,
    attentionCount,
    stateFilteredDrawers,
    platformStats,
    previewDrawers,
    controls,
    summary,
    hasSelectedCustomNames: computed(() => selectedCustomNamedIds.value.length > 0),
    applyFilterDraft,
    requestRemoveSelectedDrawers,
    requestRestoreSelectedNames,
  }
}

const stateFilterKey = editingStateKey<ShallowRef<CatalogDrawerStateFilter>>(
  'composables/music-sources/use-catalog-drawer-list.ts:stateFilter',
)
const filtersKey = editingStateKey<ShallowRef<ReturnType<typeof createCatalogTrackFilterState>>>(
  'composables/music-sources/use-catalog-drawer-list.ts:filters',
)
