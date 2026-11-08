import { MusicSourceError } from '@any-music/core'

export type DouyinImportTarget =
  | { kind: 'search'; query: string; url: string }
  | { kind: 'video'; awemeId: string; pageKind?: 'video' | 'note'; url: string }
  | { kind: 'mix'; mixId: string; url: string }
  | { kind: 'user-mixes'; secUid: string; url: string }
  | { kind: 'user-posts'; secUid: string; url: string }
  | { kind: 'user-favorites'; secUid: string; url: string }
  | { kind: 'self-posts'; url: string }
  | { kind: 'self-history'; url: string }
  | { kind: 'self-recommendations'; url: string }
  | { kind: 'self-mixes'; url: string }
  | { kind: 'self-favorites'; url: string }
  | { kind: 'self-collected-videos'; url: string }
  | { kind: 'self-collected-music'; url: string }
  | { kind: 'self-collected-mixes'; url: string }
  | { kind: 'self-collection-folders'; url: string }

const SUPPORTED_HOSTS = new Set(['douyin.com', 'www.douyin.com', 'www-hj.douyin.com'])

/** 搜索与验证统一落到精选页；不复用某次网页搜索生成的 aid 标识。 */
export function createDouyinSearchPageUrl(query: string): string {
  return `https://www.douyin.com/jingxuan/search/${encodeURIComponent(query)}?type=general`
}

/** 把搜索弹窗、视频、图文、合集与个人页收敛为稳定的导入配方。 */
export function parseDouyinImportUrl(input: string): DouyinImportTarget {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch (error) {
    throw new MusicSourceError('invalid-input', '请输入完整的抖音 URL。', { cause: error })
  }

  if (!SUPPORTED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new MusicSourceError('unsupported-url', '当前仅支持 douyin.com 的网页 URL。')
  }

  // Pasted URLs can contain another URL inside showTab; treating that as a profile
  // silently imports posts and reports an unrelated privacy failure.
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    [...url.searchParams.values()].some((value) => /https?:\/\//i.test(value))
  ) {
    throw new MusicSourceError(
      'invalid-input',
      '抖音链接中拼接了其他地址，请只粘贴一个完整页面链接。',
    )
  }
  for (const key of ['showTab', 'tab', 'showSubTab', 'subTab', 'modal_id']) {
    if (url.searchParams.getAll(key).length > 1) {
      throw new MusicSourceError(
        'invalid-input',
        '抖音链接包含重复的页面参数，请重新复制页面链接。',
      )
    }
  }

  // 搜索结果弹层保留在搜索路径上，modal_id 才是用户当前打开的作品。
  const modalId = url.searchParams.get('modal_id')
  if (modalId && /^\d+$/.test(modalId)) {
    return { kind: 'video', awemeId: modalId, url: url.href }
  }

  const parts = url.pathname.split('/').filter(Boolean)
  if ((parts[0] === 'video' || parts[0] === 'note') && isNumericId(parts[1])) {
    return {
      kind: 'video',
      awemeId: parts[1],
      pageKind: parts[0],
      url: url.href,
    }
  }

  if (parts[0] === 'collection' && isNumericId(parts[1])) {
    return { kind: 'mix', mixId: parts[1], url: url.href }
  }

  const searchIndex = parts[0] === 'jingxuan' && parts[1] === 'search' ? 2 : 1
  if (parts[searchIndex - 1] === 'search' && parts[searchIndex]) {
    const query = decodePathPart(parts[searchIndex])
    if (query) return { kind: 'search', query, url: url.href }
  }

  if (parts[0] === 'user') {
    const secUid = parts[1]
    const selfCollection = getSelfCollectionKind(url)
    if (selfCollection) {
      if (secUid && secUid !== 'self') {
        throw new MusicSourceError('access-denied', '抖音收藏只对当前登录账号开放。')
      }
      return { kind: selfCollection, url: url.href }
    }
    const recommendations = isRecommendationsView(url)
    const history = (url.searchParams.get('showTab') ?? url.searchParams.get('tab')) === 'record'
    const favorites = isFavoritesView(url, parts)
    const mixes = isMixesView(url, parts)
    if (!secUid || secUid === 'self') {
      return {
        kind: history
          ? 'self-history'
          : recommendations
            ? 'self-recommendations'
            : favorites
              ? 'self-favorites'
              : mixes
                ? 'self-mixes'
                : 'self-posts',
        url: url.href,
      }
    }
    if (history) {
      throw new MusicSourceError('access-denied', '抖音观看历史只对当前登录账号开放。')
    }
    if (recommendations) {
      throw new MusicSourceError('access-denied', '抖音推荐页只对当前登录账号开放。')
    }
    return {
      kind: favorites ? 'user-favorites' : mixes ? 'user-mixes' : 'user-posts',
      secUid,
      url: url.href,
    }
  }

  if (parts.length === 0 && isFavoritesView(url, parts)) {
    return { kind: 'self-favorites', url: url.href }
  }

  throw new MusicSourceError(
    'unsupported-url',
    '暂不支持该抖音页面；可导入搜索、视频、图文、合集、用户作品/喜欢和个人收藏页。',
  )
}

function isRecommendationsView(url: URL): boolean {
  const view = (url.searchParams.get('showTab') ?? url.searchParams.get('tab') ?? '').toLowerCase()
  return ['recommend', 'recommendation', 'recommendations'].includes(view)
}

function getSelfCollectionKind(
  url: URL,
): Extract<DouyinImportTarget, { kind: `self-${string}` }>['kind'] | undefined {
  const tab = (url.searchParams.get('showTab') ?? url.searchParams.get('tab') ?? '').toLowerCase()
  if (tab !== 'favorite_collection') return undefined
  const subTab = (
    url.searchParams.get('showSubTab') ??
    url.searchParams.get('subTab') ??
    ''
  ).toLowerCase()
  if (!subTab || subTab === 'video') return 'self-collected-videos'
  if (subTab === 'music') return 'self-collected-music'
  if (['compilation', 'collection', 'mix'].includes(subTab)) return 'self-collected-mixes'
  if (['favorite_folder', 'folder', 'collects'].includes(subTab)) {
    return 'self-collection-folders'
  }
  throw new MusicSourceError('unsupported-url', `暂不支持抖音收藏子页：${subTab}。`)
}

function isMixesView(url: URL, parts: readonly string[]): boolean {
  const view = (
    url.searchParams.get('showSubTab') ??
    url.searchParams.get('subTab') ??
    url.searchParams.get('tab') ??
    ''
  ).toLowerCase()
  return (
    parts.some((part) =>
      ['collection', 'compilation', 'mix', 'mixes'].includes(part.toLowerCase()),
    ) || ['collection', 'compilation', 'mix', 'mixes'].includes(view)
  )
}

function isFavoritesView(url: URL, parts: readonly string[]): boolean {
  const view = (url.searchParams.get('showTab') ?? url.searchParams.get('tab') ?? '').toLowerCase()
  return (
    parts.some((part) => ['favorite', 'favorites', 'like', 'liked'].includes(part.toLowerCase())) ||
    ['favorite', 'favorites', 'like', 'liked'].includes(view)
  )
}

function isNumericId(value?: string): value is string {
  return Boolean(value && /^\d+$/.test(value))
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return value.trim()
  }
}
