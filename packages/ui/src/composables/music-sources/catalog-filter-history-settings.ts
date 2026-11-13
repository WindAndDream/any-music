import type {
  CatalogFilterContext,
  CatalogTrackFilterDimension,
} from '../../components/music-sources/catalog-track-filter-presentation'

/** 每个维度独立控制保留数量；折叠只影响展示，不删除已保存的条件。 */
export interface CatalogFilterHistoryPreferences {
  limits: Record<CatalogTrackFilterDimension, number>
  collapseAfter: number
}

/** 独立区域偏好；顶层值仅作为未指定产品区域的通用筛选器配置。 */
export interface CatalogFilterHistorySettings extends CatalogFilterHistoryPreferences {
  contexts?: Partial<Record<CatalogFilterContext, CatalogFilterHistoryPreferences>>
}

export const MAX_CATALOG_FILTER_HISTORY_LIMIT = 100
export const DEFAULT_CATALOG_FILTER_HISTORY_COLLAPSE_AFTER = 3

/** 校验跨运行端持久偏好；缺失字段使用每项 12 组的默认值。 */
export function normalizeCatalogFilterHistorySettings(
  input: unknown,
): CatalogFilterHistorySettings {
  const raw = isRecord(input) ? input : {}
  const defaults: CatalogFilterHistoryPreferences = {
    limits: { search: 12, tags: 12, published: 12, duration: 12, platforms: 12, naming: 12 },
    collapseAfter: DEFAULT_CATALOG_FILTER_HISTORY_COLLAPSE_AFTER,
  }
  const settings: CatalogFilterHistorySettings = normalizePreferences(raw, defaults)
  if (isRecord(raw.contexts)) {
    const contexts: NonNullable<CatalogFilterHistorySettings['contexts']> = {}
    for (const context of ['drawers', 'tracks', 'queue', 'favorites', 'downloads'] as const) {
      if (isRecord(raw.contexts[context]))
        contexts[context] = normalizePreferences(raw.contexts[context], defaults)
    }
    if (Object.keys(contexts).length > 0) settings.contexts = contexts
  }
  return settings
}

/** 区域决定配置，配方 ID 仍决定历史归属；多个歌曲列表共用配置而不共用记录。 */
export function getCatalogFilterHistoryPreferences(
  settings: CatalogFilterHistorySettings,
  scopeId: string,
): CatalogFilterHistoryPreferences {
  const context =
    scopeId === 'catalog:drawers'
      ? 'drawers'
      : scopeId.startsWith('catalog:tracks:')
        ? 'tracks'
        : scopeId === 'queue:tracks'
          ? 'queue'
          : scopeId === 'favorites:tracks'
            ? 'favorites'
            : scopeId === 'downloads:tracks'
              ? 'downloads'
              : undefined
  return (context && settings.contexts?.[context]) || settings
}

function normalizePreferences(
  raw: Record<string, unknown>,
  fallback: CatalogFilterHistoryPreferences,
): CatalogFilterHistoryPreferences {
  const limits = isRecord(raw.limits) ? raw.limits : {}
  return {
    limits: {
      search: normalizeCount(limits.search, fallback.limits.search, 0),
      tags: normalizeCount(limits.tags, fallback.limits.tags, 0),
      published: normalizeCount(limits.published, fallback.limits.published, 0),
      duration: normalizeCount(limits.duration, fallback.limits.duration, 0),
      platforms: normalizeCount(limits.platforms, fallback.limits.platforms, 0),
      naming: normalizeCount(limits.naming, fallback.limits.naming, 0),
    },
    collapseAfter: normalizeCount(raw.collapseAfter, fallback.collapseAfter, 1),
  }
}

function normalizeCount(input: unknown, fallback: number, minimum: number): number {
  return typeof input === 'number' && Number.isFinite(input)
    ? Math.max(minimum, Math.min(MAX_CATALOG_FILTER_HISTORY_LIMIT, Math.floor(input)))
    : fallback
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}
