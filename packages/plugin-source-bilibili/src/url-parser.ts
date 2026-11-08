import { MusicSourceError } from '@any-music/core'

import { BILIBILI_MUSIC_SOURCE_DESCRIPTOR } from './descriptor'

export type BilibiliImportTarget =
  | { kind: 'season'; mid: string; seasonId: string; url: string }
  | { kind: 'upper-video'; mid: string; keyword?: string; url: string }
  | { kind: 'upper-audio'; mid: string; url: string }
  | { kind: 'favorite'; mid: string; mediaId: string; url: string }
  | { kind: 'video'; bvid: string; page?: number; url: string }

/** 将用户复制的 B 站页面 URL 收敛为少量明确的导入目标。 */
export function parseBilibiliImportUrl(input: string): BilibiliImportTarget {
  let url: URL

  try {
    url = new URL(input.trim())
  } catch (error) {
    throw new MusicSourceError('invalid-input', '请输入完整的哔哩哔哩 URL。', { cause: error })
  }

  // Keep final plugin preflight aligned with the lightweight descriptor used by UI feedback.
  const isDeclaredScope = BILIBILI_MUSIC_SOURCE_DESCRIPTOR.importUrlScopes.some(
    (scope) => url.origin === scope.origin && url.pathname.startsWith(scope.pathnamePrefix),
  )
  if (!isDeclaredScope) {
    throw new MusicSourceError('unsupported-url', '当前仅支持 B 站视频页和个人空间 URL。')
  }

  if (url.hostname === 'www.bilibili.com') {
    const videoMatch = /^\/video\/(BV[0-9A-Za-z]+)/.exec(url.pathname)
    if (videoMatch?.[1]) {
      const part = url.searchParams.get('p')
      if (part === null) return { kind: 'video', bvid: videoMatch[1], url: url.href }
      const page = Number(part)
      if (!/^\d+$/.test(part) || !Number.isSafeInteger(page) || page < 1) {
        throw new MusicSourceError('invalid-input', 'B 站视频分 P 必须是正整数。')
      }
      return { kind: 'video', bvid: videoMatch[1], page, url: url.href }
    }
  }

  if (url.hostname !== 'space.bilibili.com') {
    throw new MusicSourceError('unsupported-url', '当前仅支持 B 站视频页和个人空间 URL。')
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const mid = parts[0]
  if (!mid || !/^\d+$/.test(mid)) {
    throw new MusicSourceError('unsupported-url', '无法从个人空间 URL 中识别 UP 主 ID。')
  }

  if (parts[1] === 'lists' && parts[2] && /^\d+$/.test(parts[2])) {
    return { kind: 'season', mid, seasonId: parts[2], url: url.href }
  }

  if (parts[1] === 'upload' && parts[2] === 'video') {
    return { kind: 'upper-video', mid, url: url.href }
  }

  if (parts[1] === 'upload' && parts[2] === 'audio') {
    return { kind: 'upper-audio', mid, url: url.href }
  }

  if (parts[1] === 'search') {
    const keyword = url.searchParams.get('keyword')?.trim()
    return { kind: 'upper-video', mid, keyword: keyword || undefined, url: url.href }
  }

  if (parts[1] === 'favlist') {
    const mediaId = url.searchParams.get('fid')
    if (mediaId && /^\d+$/.test(mediaId)) {
      return { kind: 'favorite', mid, mediaId, url: url.href }
    }
  }

  throw new MusicSourceError('unsupported-url', '暂不支持该 B 站页面类型。')
}
