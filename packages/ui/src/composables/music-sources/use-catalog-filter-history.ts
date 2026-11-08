import { toAppErrorState } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import { computed, inject, provide, readonly, shallowRef, toValue } from 'vue'
import type { InjectionKey, MaybeRefOrGetter } from 'vue'

import {
  commitCatalogTrackFilterDimension,
  getCatalogTrackFilterDimensionCount,
  type CatalogTrackFilterDimension,
} from '../../components/music-sources/catalog-track-filter-presentation'
import { isCatalogCalendarDate } from './catalog-filter-calendar'
import {
  MAX_CATALOG_FILTER_HISTORY_LIMIT,
  getCatalogFilterHistoryPreferences,
  normalizeCatalogFilterHistorySettings,
  type CatalogFilterHistorySettings,
} from './catalog-filter-history-settings'
import {
  createCatalogTrackFilterState,
  type CatalogTrackFilterState,
} from './use-catalog-track-filters'

export type CatalogFilterHistoryDimension = CatalogTrackFilterDimension
const MAX_CATALOG_FILTER_HISTORY_SCOPES = 100

/** 每条历史保存一个维度的完整快照，点击恢复整组区间，而不是把历史追加到当前条件。 */
export interface CatalogFilterHistoryEntry {
  scopeId: string
  dimension: CatalogFilterHistoryDimension
  filters: CatalogTrackFilterState
}

export interface CatalogFilterHistoryRepository {
  load: () => unknown
  save: (entries: readonly CatalogFilterHistoryEntry[]) => AppErrorState | void
  loadSettings?: () => unknown
  saveSettings?: (settings: CatalogFilterHistorySettings) => AppErrorState | void
}

/** 校验运行端的持久化输入并限制历史规模；未知字段不进入恢复后的业务草稿。 */
export function normalizeCatalogFilterHistory(
  input: unknown,
  settings: CatalogFilterHistorySettings = normalizeCatalogFilterHistorySettings(undefined),
): readonly CatalogFilterHistoryEntry[] {
  if (!Array.isArray(input)) return []
  const entries: CatalogFilterHistoryEntry[] = []
  const scopeIds = new Set<string>()
  const counts = new Map<string, number>()
  const keys = new Set<string>()
  // 每个归属独享维度额度；最近使用的 100 个筛选器有界保存，避免已删除列表无限累积。
  const scanLimit = MAX_CATALOG_FILTER_HISTORY_SCOPES * MAX_CATALOG_FILTER_HISTORY_LIMIT * 6 + 1
  for (const entry of input.slice(0, scanLimit)) {
    if (!isRecord(entry) || !isRecord(entry.filters)) continue
    const scopeId = readScopeId(entry.scopeId)
    // 旧共用记录没有可靠归属，不能猜测后灌入多个筛选器。
    if (!scopeId) continue
    const dimension = entry.dimension
    if (
      dimension !== 'search' &&
      dimension !== 'tags' &&
      dimension !== 'published' &&
      dimension !== 'duration' &&
      dimension !== 'platforms' &&
      dimension !== 'naming'
    )
      continue
    const countKey = JSON.stringify([scopeId, dimension])
    const preferences = getCatalogFilterHistoryPreferences(settings, scopeId)
    if ((counts.get(countKey) ?? 0) >= preferences.limits[dimension]) continue
    if (!scopeIds.has(scopeId) && scopeIds.size >= MAX_CATALOG_FILTER_HISTORY_SCOPES) continue
    const filters = createCatalogTrackFilterState()
    const raw = entry.filters
    if (dimension === 'search' && Array.isArray(raw.searchFilters)) {
      const first: unknown = raw.searchFilters[0]
      if (isRecord(first) && typeof first.query === 'string') {
        filters.searchFilters = [{ query: first.query.slice(0, 120).trim() }]
      }
    } else if (dimension === 'tags' && Array.isArray(raw.tags)) {
      filters.tags = raw.tags.flatMap((tag: unknown) =>
        typeof tag === 'string' && tag.trim() ? [tag.slice(0, 32).trim()] : [],
      )
    } else if (dimension === 'platforms' && Array.isArray(raw.platformIds)) {
      filters.platformIds = raw.platformIds
        .slice(0, 200)
        .flatMap((id: unknown) =>
          typeof id === 'string' && id.trim() && id.length <= 200 ? [id.trim()] : [],
        )
    } else if (dimension === 'naming' && (raw.naming === 'custom' || raw.naming === 'original')) {
      filters.naming = raw.naming
    } else if (dimension === 'published' && Array.isArray(raw.publishedRanges)) {
      filters.publishedRanges = raw.publishedRanges.flatMap((range: unknown) => {
        if (
          !isRecord(range) ||
          !isCatalogCalendarDate(range.from) ||
          !isCatalogCalendarDate(range.to) ||
          range.to < range.from
        )
          return []
        return [{ from: range.from, to: range.to }]
      })
    } else if (dimension === 'duration' && Array.isArray(raw.durationRanges)) {
      filters.durationRanges = raw.durationRanges.flatMap((range: unknown) => {
        if (!isRecord(range)) return []
        const minMs = readDuration(range.minMs)
        const maxMs = readDuration(range.maxMs)
        if (
          (range.minMs !== undefined && minMs === undefined) ||
          (range.maxMs !== undefined && maxMs === undefined) ||
          (minMs !== undefined && maxMs !== undefined && minMs > maxMs)
        )
          return []
        return minMs !== undefined || maxMs !== undefined ? [{ minMs, maxMs }] : []
      })
    }
    const normalized = commitCatalogTrackFilterDimension(
      createCatalogTrackFilterState(),
      filters,
      dimension,
    )
    if (getCatalogTrackFilterDimensionCount(normalized, dimension) === 0) continue
    const candidate: CatalogFilterHistoryEntry = { scopeId, dimension, filters: normalized }
    const key = createEntryKey(candidate)
    if (keys.has(key)) continue
    keys.add(key)
    scopeIds.add(scopeId)
    counts.set(countKey, (counts.get(countKey) ?? 0) + 1)
    entries.push(candidate)
  }
  return entries
}

/** 历史由产品作用域持有；存储端口由应用注入，组件卸载或关闭面板不会丢失历史。 */
export function createCatalogFilterHistory(repository?: CatalogFilterHistoryRepository) {
  const settings = shallowRef(normalizeCatalogFilterHistorySettings(repository?.loadSettings?.()))
  const entries = shallowRef(normalizeCatalogFilterHistory(repository?.load(), settings.value))

  /** 调小保留量立即裁去最旧记录；同作用域内已打开的筛选器同步读取新折叠偏好。 */
  function setSettings(input: CatalogFilterHistorySettings): AppErrorState | void {
    settings.value = normalizeCatalogFilterHistorySettings(input)
    entries.value = normalizeCatalogFilterHistory(entries.value, settings.value)
    // 运行端可保留会话状态并返回写入错误；两个存储项都尝试提交，反馈不误报成功。
    let error: AppErrorState | void = undefined
    for (const save of [
      () => repository?.saveSettings?.(settings.value),
      () => repository?.save(entries.value),
    ]) {
      try {
        const failure = save()
        if (failure) error ??= failure
      } catch (cause) {
        error ??= toAppErrorState(cause, 'storage-write-failed', '筛选历史设置保存失败。')
      }
    }
    return error
  }

  /** 读取、去重、删除都经过相同归属；响应式标识切换时不能继续操作旧筛选器的记录。 */
  function forScope(scope: MaybeRefOrGetter<string>) {
    const scopeId = computed(() => readScopeId(toValue(scope)))
    const scopedEntries = computed(() =>
      entries.value.filter((entry) => entry.scopeId === scopeId.value),
    )
    const scopedSettings = computed(() =>
      getCatalogFilterHistoryPreferences(settings.value, scopeId.value ?? ''),
    )

    function remember(
      dimension: CatalogTrackFilterDimension,
      filters: CatalogTrackFilterState,
    ): void {
      if (!scopeId.value) return
      const snapshot = commitCatalogTrackFilterDimension(
        createCatalogTrackFilterState(),
        filters,
        dimension,
      )
      if (getCatalogTrackFilterDimensionCount(snapshot, dimension) === 0) return
      entries.value = normalizeCatalogFilterHistory(
        [{ scopeId: scopeId.value, dimension, filters: snapshot }, ...entries.value],
        settings.value,
      )
      repository?.save(entries.value)
    }

    function remove(entry: CatalogFilterHistoryEntry): void {
      if (entry.scopeId !== scopeId.value) return
      const key = createEntryKey(entry)
      const remaining = entries.value.filter((candidate) => createEntryKey(candidate) !== key)
      if (remaining.length === entries.value.length) return
      entries.value = remaining
      repository?.save(entries.value)
    }

    return {
      entries: readonly(scopedEntries),
      settings: readonly(scopedSettings),
      remember,
      remove,
      setSettings,
    }
  }

  return { entries: readonly(entries), settings: readonly(settings), forScope, setSettings }
}

const historyKey: InjectionKey<ReturnType<typeof createCatalogFilterHistory>> =
  Symbol('catalog-filter-history')

export function provideCatalogFilterHistory(repository: CatalogFilterHistoryRepository) {
  const history = createCatalogFilterHistory(repository)
  provide(historyKey, history)
  return history
}

export function useCatalogFilterHistory() {
  return inject(historyKey, undefined) ?? createCatalogFilterHistory()
}

function createEntryKey(entry: CatalogFilterHistoryEntry): string {
  // 仅条件忽略大小写；业务归属标识保持原样，不能把不同 ID 合并。
  return JSON.stringify([
    entry.scopeId,
    entry.dimension,
    entry.dimension === 'platforms'
      ? JSON.stringify([...(entry.filters.platformIds ?? [])].toSorted())
      : JSON.stringify(entry.filters).normalize('NFKC').toLocaleLowerCase(),
  ])
}

function readScopeId(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim().length > 0 && input.length <= 200
    ? input.trim()
    : undefined
}

function readDuration(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
