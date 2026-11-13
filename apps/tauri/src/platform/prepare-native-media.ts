import { AppError } from '@any-music/core'
import type { ResolvedMediaSource } from '@any-music/core'

/** Native source adapters own account-bound grants and their release lifetime. */
export async function prepareNativeMedia(
  source: ResolvedMediaSource,
): Promise<ResolvedMediaSource> {
  if (source.type !== 'remote-url') return source
  const urls = [source.url, ...source.backupUrls]
  if (urls.every((url) => url.startsWith('http://127.0.0.1:'))) return source
  source.release?.()
  throw new AppError('unsupported-operation', '原生来源必须通过账号媒体授权提供播放地址。')
}
