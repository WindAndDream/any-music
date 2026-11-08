import { MusicSourceError } from '@any-music/core'

export interface NeteaseImportTarget {
  kind: 'song' | 'playlist' | 'album' | 'artist'
  id: string
  url: string
}

export function validateNeteaseId(value: string): string {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new MusicSourceError('invalid-input', '网易云资源 ID 必须是有效的正整数。')
  return value
}

/** Official hash routes and mobile share routes normalize to one stable identity. */
export function parseNeteaseImportUrl(input: string): NeteaseImportTarget {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new MusicSourceError('invalid-input', '请输入有效的网易云音乐链接。')
  }
  if (url.origin !== 'https://music.163.com' || url.username || url.password)
    throw new MusicSourceError('unsupported-url', '仅支持 music.163.com 的官方 HTTPS 链接。')
  if (url.hash.startsWith('#/')) {
    if (url.pathname !== '/' || url.search)
      throw new MusicSourceError('unsupported-url', '网易云链接包含冲突的资源路径。')
    url = new URL(url.hash.slice(1), url.origin)
  }
  const match = /^\/(?:m\/)?(song|playlist|album|artist)\/?$/.exec(url.pathname)
  const kind = match?.[1] as NeteaseImportTarget['kind'] | undefined
  if (!kind || url.hash || url.searchParams.getAll('id').length !== 1)
    throw new MusicSourceError(
      'unsupported-url',
      '支持歌曲、歌单、专辑和歌手链接，链接需包含唯一的 id。',
    )
  const id = validateNeteaseId(url.searchParams.get('id')!)
  return { kind, id, url: `https://music.163.com/${kind}?id=${id}` }
}
