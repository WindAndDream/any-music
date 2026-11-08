import type {
  CatalogTagStat,
  CatalogTrackDurationRangeFilter,
  CatalogTrackFilterState,
  CatalogTrackPublishedRangeFilter,
  CatalogTrackSearchFilter,
} from '../../composables/music-sources/use-catalog-track-filters'
import type { AppIconName } from '../app-icon'

export type CatalogTrackFilterDimension =
  | 'search'
  | 'tags'
  | 'published'
  | 'duration'
  | 'platforms'
  | 'naming'
export type CatalogFilterContext = 'tracks' | 'drawers' | 'queue' | 'favorites' | 'downloads'

export interface CatalogTrackFilterDimensionDefinition {
  id: CatalogTrackFilterDimension
  label: string
  description: string
  icon: AppIconName
}

/** 稳定的维度目录供导航、编辑器和总览共享，避免三处文案与顺序逐渐分叉。 */
export const catalogTrackFilterDimensions: readonly CatalogTrackFilterDimensionDefinition[] = [
  {
    id: 'search',
    label: '搜索筛选',
    description: '按歌曲、作者或用户 ID 查找',
    icon: 'search',
  },
  {
    id: 'tags',
    label: '标签筛选',
    description: '匹配任意一个已选用户标签',
    icon: 'tags',
  },
  {
    id: 'naming',
    label: '命名筛选',
    description: '按是否设置自定义名称筛选',
    icon: 'edit',
  },
  {
    id: 'published',
    label: '发布时间',
    description: '可添加多个独立日期区间',
    icon: 'clock',
  },
  {
    id: 'duration',
    label: '歌曲时长',
    description: '按歌曲时长区间筛选',
    icon: 'waveform',
  },
]

/** 列表复用文本与日期编辑契约，只切换维度文案，不暴露歌曲专属条件。 */
export function getCatalogFilterDimensions(
  context: CatalogFilterContext,
  options: { platformScoped?: boolean } = {},
): readonly CatalogTrackFilterDimensionDefinition[] {
  const platforms: readonly CatalogTrackFilterDimensionDefinition[] = options.platformScoped
    ? []
    : [
        {
          id: 'platforms',
          label: '平台筛选',
          description: '可选择多个来源平台，匹配其中任意一个',
          icon: 'music',
        },
      ]
  if (context === 'tracks') return catalogTrackFilterDimensions
  if (context === 'queue' || context === 'favorites' || context === 'downloads')
    return [
      {
        id: 'search',
        label: '文本筛选',
        description: '按歌曲、作者或用户 ID 查找',
        icon: 'search',
      },
      catalogTrackFilterDimensions.find(({ id }) => id === 'tags')!,
      catalogTrackFilterDimensions.find(({ id }) => id === 'duration')!,
      ...platforms,
      {
        id: 'published',
        label:
          context === 'downloads' ? '任务日期' : context === 'favorites' ? '喜欢时间' : '添加时间',
        description:
          context === 'downloads'
            ? '按创建下载任务的日期筛选，支持多个日期区间'
            : context === 'favorites'
              ? '按喜欢的日期筛选，支持多个日期区间'
              : '按加入待听的日期筛选，支持多个日期区间',
        icon: 'clock',
      },
    ]
  return [
    {
      id: 'search',
      label: '文本筛选',
      description: '按列表名称、搜索词、链接或来源查找',
      icon: 'search',
    },
    ...platforms,
    catalogTrackFilterDimensions.find(({ id }) => id === 'naming')!,
    {
      id: 'published',
      label: '搜索时间',
      description: '按搜索或导入的创建日期筛选，支持多个日期区间',
      icon: 'clock',
    },
  ]
}

export function getCatalogTrackFilterDimensionCount(
  filters: CatalogTrackFilterState,
  dimension: CatalogTrackFilterDimension,
): number {
  if (dimension === 'search') return filters.searchFilters[0]?.query.trim() ? 1 : 0
  if (dimension === 'tags') return filters.tags.length
  if (dimension === 'published') return filters.publishedRanges.length
  if (dimension === 'platforms') return filters.platformIds?.length ?? 0
  if (dimension === 'naming') return filters.naming && filters.naming !== 'all' ? 1 : 0
  return filters.durationRanges.length
}

export function getCatalogTrackFilterLabels(
  filters: CatalogTrackFilterState,
  dimension: CatalogTrackFilterDimension,
  platformNames: ReadonlyMap<string, string> = new Map(),
): readonly string[] {
  if (dimension === 'search')
    return filters.searchFilters.slice(0, 1).map(formatCatalogTrackSearchFilter)
  if (dimension === 'tags') return filters.tags
  if (dimension === 'platforms')
    return (filters.platformIds ?? []).map((id) => platformNames.get(id) ?? id)
  if (dimension === 'naming')
    return filters.naming === 'custom'
      ? ['自定义名称']
      : filters.naming === 'original'
        ? ['来源原名']
        : []
  if (dimension === 'published') {
    return filters.publishedRanges.map(formatCatalogTrackPublishedRange)
  }
  return filters.durationRanges.map(formatCatalogTrackDurationRange)
}

/**
 * 单个维度的编辑页可以包含尚未填写完整的新行；确认返回概览时只提交有效、去重后的条件，
 * 并保留用户在概览中对其他维度所做的最新修改。
 */
export function commitCatalogTrackFilterDimension(
  currentFilters: CatalogTrackFilterState,
  dimensionDraft: CatalogTrackFilterState,
  dimension: CatalogTrackFilterDimension,
): CatalogTrackFilterState {
  if (dimension === 'search') {
    const query = dimensionDraft.searchFilters[0]?.query.trim() ?? ''
    const searchFilters = query ? [{ query }] : []
    return { ...currentFilters, searchFilters }
  }

  if (dimension === 'tags') {
    const tags = uniqueByKey(dimensionDraft.tags.map((tag) => tag.trim()).filter(Boolean), (tag) =>
      tag.normalize('NFKC').toLocaleLowerCase(),
    )
    return { ...currentFilters, tags }
  }

  if (dimension === 'platforms') {
    return {
      ...currentFilters,
      platformIds: [...new Set(dimensionDraft.platformIds?.filter(Boolean))],
    }
  }
  if (dimension === 'naming') {
    return {
      ...currentFilters,
      naming:
        dimensionDraft.naming === 'custom' || dimensionDraft.naming === 'original'
          ? dimensionDraft.naming
          : 'all',
    }
  }

  if (dimension === 'published') {
    const publishedRanges = uniqueByKey(
      dimensionDraft.publishedRanges
        .map(normalizePublishedRange)
        .filter((range) => range.from || range.to),
      createCatalogTrackPublishedRangeKey,
    )
    return { ...currentFilters, publishedRanges }
  }

  const durationRanges = uniqueByKey(
    dimensionDraft.durationRanges
      .map(normalizeDurationRange)
      .filter((range) => range.minMs !== undefined || range.maxMs !== undefined),
    createCatalogTrackDurationRangeKey,
  )
  return { ...currentFilters, durationRanges }
}

export function createCatalogTrackPublishedRangeKey(
  range: CatalogTrackPublishedRangeFilter,
): string {
  return `${range.from}:${range.to}`
}

export function createCatalogTrackDurationRangeKey(range: CatalogTrackDurationRangeFilter): string {
  return `${range.minMs ?? ''}:${range.maxMs ?? ''}`
}

export function readCatalogTrackDurationMinutes(input: string): number | undefined {
  if (!input.trim()) return undefined
  const minutes = Number(input)
  const durationMs = Math.round(minutes * 60_000)
  return Number.isFinite(durationMs) && minutes >= 0 ? durationMs : undefined
}

/** 标签搜索只收窄当前可选项，不改变筛选草稿、标签排序或歌曲预览结果。 */
export function filterCatalogTagStats(
  tagStats: readonly CatalogTagStat[],
  query: string,
): readonly CatalogTagStat[] {
  const normalizedQuery = query.normalize('NFKC').trim().toLocaleLowerCase()
  if (!normalizedQuery) return tagStats
  return tagStats.filter((tag) =>
    tag.name.normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery),
  )
}

function normalizePublishedRange(
  range: CatalogTrackPublishedRangeFilter,
): CatalogTrackPublishedRangeFilter {
  if (range.from && range.to && range.from > range.to) {
    return { from: range.to, to: range.from }
  }
  return { ...range }
}

function normalizeDurationRange(
  range: CatalogTrackDurationRangeFilter,
): CatalogTrackDurationRangeFilter {
  if (range.minMs !== undefined && range.maxMs !== undefined && range.minMs > range.maxMs) {
    return { minMs: range.maxMs, maxMs: range.minMs }
  }
  return { ...range }
}

function uniqueByKey<T>(items: readonly T[], createKey: (item: T) => string): T[] {
  const keys = new Set<string>()
  return items.filter((item) => {
    const key = createKey(item)
    if (keys.has(key)) return false
    keys.add(key)
    return true
  })
}

function formatCatalogTrackSearchFilter(filter: CatalogTrackSearchFilter): string {
  return filter.query.trim() || '未填写搜索文本'
}

function formatCatalogTrackPublishedRange(range: CatalogTrackPublishedRangeFilter): string {
  if (range.from && range.to) return `${range.from} 至 ${range.to}`
  if (range.from) return `${range.from} 起`
  if (range.to) return `${range.to} 前`
  return '未设置日期'
}

function formatCatalogTrackDurationRange(range: CatalogTrackDurationRangeFilter): string {
  const min = range.minMs === undefined ? undefined : formatMinutes(range.minMs)
  const max = range.maxMs === undefined ? undefined : formatMinutes(range.maxMs)
  if (min && max) return `${min} 至 ${max}`
  if (min) return `${min} 以上`
  return max ? `${max} 以内` : '未设置时长'
}

function formatMinutes(durationMs: number): string {
  const minutes = durationMs / 60_000
  return `${Number(minutes.toFixed(4))} 分钟`
}
