import { AppError } from '@any-music/core'
import type { CancellationSignal } from '@any-music/core'

import type { DouyinAccountBrowserCatalog } from '../../platform/douyin-browser-catalog'

export async function readDouyinAccountNickname(
  pageCatalog: Pick<DouyinAccountBrowserCatalog, 'getSelfNickname'>,
  cancellation?: CancellationSignal,
): Promise<string> {
  try {
    if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    // Native code projects only the nickname verified against the account UID.
    const response = await pageCatalog.getSelfNickname()
    if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
    if (response.status !== 200) return ''
    const body =
      typeof response.body === 'string' ? response.body : new TextDecoder().decode(response.body)
    const result: unknown = JSON.parse(body)
    return result &&
      typeof result === 'object' &&
      'nickname' in result &&
      typeof result.nickname === 'string'
      ? result.nickname.trim()
      : ''
  } catch (error) {
    if (error instanceof AppError && error.code === 'operation-cancelled') throw error
    // A failed display read preserves the independently verified login state.
    return ''
  }
}
