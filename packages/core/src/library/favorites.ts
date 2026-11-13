import type { LibraryTrackRecord } from './models'

export type FavoriteTrackKind = 'regular' | 'custom'

/** “我的喜欢”的领域筛选契约；时间字段在普通歌曲中指发布时间，在拼接歌曲中指创建时间。 */
export interface FavoriteRecordFilter {
  kind: FavoriteTrackKind
  titleQuery?: string
  artistQuery?: string
  pluginId?: string
  requiredTags?: readonly string[]
  occurredFromMs?: number
  occurredBeforeMs?: number
}

/**
 * 只从资料库的唯一曲目记录中派生喜欢列表，避免复制 Track 或标签后产生跨视图漂移。
 * 结果默认按最近喜欢排序；时间相同时沿用资料库的稳定加入顺序。
 */
export function filterFavoriteRecords(
  records: readonly LibraryTrackRecord[],
  filter: FavoriteRecordFilter,
): readonly LibraryTrackRecord[] {
  const titleQuery = createSearchKey(filter.titleQuery ?? '')
  const artistQuery = createSearchKey(filter.artistQuery ?? '')
  const requiredTagKeys = (filter.requiredTags ?? []).map(createSearchKey).filter(Boolean)

  return records
    .filter((record) => {
      if (record.favoritedAtMs === undefined) return false

      const track = record.track
      const isCustom = track.source.mediaKind === 'custom'
      if ((filter.kind === 'custom') !== isCustom) return false
      if (
        titleQuery &&
        ![track.title, record.customName ?? ''].some((name) =>
          createSearchKey(name).includes(titleQuery),
        )
      )
        return false

      if (filter.kind === 'regular') {
        if (filter.pluginId && track.source.pluginId !== filter.pluginId) return false
        const artists = track.artists
          .flatMap((artist) => [artist.name, artist.id ?? ''])
          .map(createSearchKey)
          .join('\n')
        if (artistQuery && !artists.includes(artistQuery)) return false
        const tagKeys = new Set(record.customTags.map(createSearchKey))
        if (requiredTagKeys.some((tag) => !tagKeys.has(tag))) return false
      }

      // 导入的拼接歌曲以原创建时间为准；旧数据没有该字段时才回退到入库时间。
      const occurredAtMs = isCustom
        ? (track.publishedAtMs ?? record.addedAtMs)
        : track.publishedAtMs
      if (
        filter.occurredFromMs !== undefined &&
        (occurredAtMs === undefined || occurredAtMs < filter.occurredFromMs)
      ) {
        return false
      }
      if (
        filter.occurredBeforeMs !== undefined &&
        (occurredAtMs === undefined || occurredAtMs >= filter.occurredBeforeMs)
      ) {
        return false
      }
      return true
    })
    .toSorted((left, right) => {
      return (
        (right.favoritedAtMs ?? 0) - (left.favoritedAtMs ?? 0) || right.addedAtMs - left.addedAtMs
      )
    })
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}
