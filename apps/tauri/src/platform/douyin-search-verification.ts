import { AppError } from '@any-music/core'
import type { CancellationSignal, HttpResponse } from '@any-music/core'
import { invoke } from '@tauri-apps/api/core'

import { mapNativeError } from './native-http'

/** Only an explicit listing action opens a visible account browser. Private CDP state stays Rust-owned. */
export async function verifyDouyinSearch(
  accountId: string,
  query: string,
  cancellation?: CancellationSignal,
  onProgress?: (phase: 'opening' | 'waiting' | 'confirming' | 'restoring') => void,
): Promise<void> {
  if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
  const { isDouyinSearchVerificationComplete } =
    await import('@any-music/plugin-source-douyin/runtime')
  if (cancellation?.isCancelled()) throw new AppError('operation-cancelled')
  const verificationId = crypto.randomUUID()
  let completed = false
  const cancelled = () => cancellation?.isCancelled() === true
  const detach = cancellation?.subscribe(() => {
    void invoke('end_douyin_search_verification', {
      accountId,
      verificationId,
      completed: false,
    }).catch(() => {})
  })
  try {
    if (cancelled()) throw new AppError('operation-cancelled')
    onProgress?.('opening')
    await invoke('begin_douyin_search_verification', { accountId, verificationId, query })
    if (cancelled()) throw new AppError('operation-cancelled')
    onProgress?.('waiting')
    const deadline = Date.now() + 10 * 60_000
    while (Date.now() < deadline) {
      if (cancelled()) throw new AppError('operation-cancelled')
      // Polling only consumes the latest allowlisted official response; it never replays a signed URL.
      // oxlint-disable-next-line no-await-in-loop
      const response = await invoke<(Omit<HttpResponse, 'body'> & { body: number[] }) | null>(
        'poll_douyin_search_verification',
        { accountId, verificationId },
      )
      if (cancelled()) throw new AppError('operation-cancelled')
      if (
        response &&
        isDouyinSearchVerificationComplete({ ...response, body: new Uint8Array(response.body) })
      ) {
        onProgress?.('confirming')
        // oxlint-disable-next-line no-await-in-loop
        await invoke('end_douyin_search_verification', {
          accountId,
          verificationId,
          completed: true,
        })
        completed = true
        if (cancelled()) throw new AppError('operation-cancelled')
        return
      }
      // oxlint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        const timer = setTimeout(finish, 1000)
        let unsubscribe: (() => void) | undefined
        unsubscribe = cancellation?.subscribe(finish)
        function finish() {
          clearTimeout(timer)
          unsubscribe?.()
          resolve()
        }
        if (cancelled()) finish()
      })
    }
    throw new AppError('request-timeout', '等待抖音安全验证超时，请重新点击验证。')
  } catch (error) {
    if (error instanceof AppError) throw error
    throw mapNativeError(error)
  } finally {
    detach?.()
    if (!completed)
      await invoke('end_douyin_search_verification', {
        accountId,
        verificationId,
        completed: false,
      }).catch(() => {})
  }
}
