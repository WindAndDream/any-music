import { AppError } from '@any-music/core'
import type { LibraryTrackRecord } from '@any-music/core'

const MAX_CUSTOM_TAG_LENGTH = 32

/** 标签写入前统一执行 Unicode 归一化、空白折叠和大小写无关去重。 */
export function normalizeCustomTag(input: string): string {
  const normalized = input.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalized) throw new AppError('invalid-input', '标签不能为空。')
  if (normalized.length > MAX_CUSTOM_TAG_LENGTH) {
    throw new AppError('invalid-input', `标签不能超过 ${MAX_CUSTOM_TAG_LENGTH} 个字符。`)
  }
  if (/\p{Cc}/u.test(normalized)) throw new AppError('invalid-input', '标签不能包含控制字符。')
  return normalized
}

export function addCustomTag(tags: readonly string[], input: string): readonly string[] {
  const tag = normalizeCustomTag(input)
  const key = createSearchKey(tag)
  return tags.some((existing) => createSearchKey(existing) === key) ? tags : [...tags, tag]
}

export function removeCustomTag(tags: readonly string[], input: string): readonly string[] {
  const key = createSearchKey(input)
  return tags.filter((tag) => createSearchKey(tag) !== key)
}

export interface SearchLibraryOptions {
  query?: string
  requiredTags?: readonly string[]
}

/** 查询同时覆盖标题、作者、来源标签与自定义标签；多个标签采用 AND 语义。 */
export function searchLibraryRecords(
  records: readonly LibraryTrackRecord[],
  options: SearchLibraryOptions = {},
): readonly LibraryTrackRecord[] {
  const query = createSearchKey(options.query ?? '')
  const requiredTagKeys = (options.requiredTags ?? []).map(createSearchKey).filter(Boolean)

  return records.filter((record) => {
    const tagKeys = new Set(record.customTags.map(createSearchKey))
    if (requiredTagKeys.some((tag) => !tagKeys.has(tag))) return false
    if (!query) return true

    const track = record.track
    const searchable = [
      track.title,
      track.description ?? '',
      ...track.artists.map((artist) => artist.name),
      ...(track.sourceTags ?? []),
      ...record.customTags,
    ]
      .map(createSearchKey)
      .join('\n')
    return searchable.includes(query)
  })
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}
