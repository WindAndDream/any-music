import { AppError } from '@any-music/core'
import type { CancellationSignal, HttpResponse } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import type {
  DouyinBrowserCatalog,
  DouyinBrowserImportTarget,
} from '@any-music/plugin-source-douyin/runtime'
import { invoke } from '@tauri-apps/api/core'

import { mapNativeError } from './native-http'

/** Account/target IDs are public; CDP sockets, signed URLs and credentials stay native. */
export function createDouyinBrowserCatalog(
  accountId: string,
  cancellation?: CancellationSignal,
): DouyinBrowserCatalog {
  async function request(
    input: {
      listingId?: string
      query?: string
      offset?: number
      awemeId?: string
      pageKind?: 'video' | 'note'
      importKind?: DouyinBrowserImportTarget['kind']
      mixId?: string
    },
    listingCancellation?: CancellationSignal,
  ) {
    const isCancelled = () => cancellation?.isCancelled() || listingCancellation?.isCancelled()
    if (isCancelled()) throw new AppError('operation-cancelled')
    const requestId = crypto.randomUUID()
    const pending = invoke<ArrayBuffer | number[]>('douyin_catalog_request', {
      accountId,
      requestId,
      ...input,
    })
    const cancel = () => {
      void invoke('cancel_request', { requestId }).catch(() => {})
    }
    const detach = cancellation?.subscribe(cancel)
    const detachListing = listingCancellation?.subscribe(cancel)
    if (isCancelled()) cancel()
    try {
      const result = await pending
      if (isCancelled()) throw new AppError('operation-cancelled')
      const bytes = result instanceof ArrayBuffer ? new Uint8Array(result) : Uint8Array.from(result)
      const status = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0)
      if (bytes.length < 2 || bytes.length > 12 * 1024 * 1024 + 2 || status < 100 || status > 599)
        throw new AppError('invalid-response')
      // The native status prefix precedes unchanged API, framed search or detail-page bytes.
      // Keep a view into the IPC buffer instead of allocating another page-sized copy.
      return { status, statusText: '', headers: '', body: bytes.subarray(2) } satisfies HttpResponse
    } catch (error) {
      if (error instanceof AppError) throw error
      throw mapNativeError(error)
    } finally {
      detach?.()
      detachListing?.()
    }
  }
  return {
    getSelfProfile: () => request({}),
    getAwemeDetail: (awemeId, pageKind) => request({ awemeId, pageKind }),
    openImport(target) {
      const listingId = crypto.randomUUID()
      const listingCancellation = new CancellationSource()
      return {
        load: (offset) =>
          request(
            {
              listingId,
              importKind: target.kind,
              ...(target.kind === 'mix' ? { mixId: target.mixId } : {}),
              offset,
            },
            listingCancellation.signal,
          ),
        async close() {
          if (listingCancellation.signal.isCancelled()) return
          listingCancellation.cancel()
          await invoke('close_douyin_listing', { accountId, listingId }).catch(() => {})
        },
      }
    },
    openSearch(query) {
      const listingId = crypto.randomUUID()
      const listingCancellation = new CancellationSource()
      return {
        async reportFailure(code) {
          if (cancellation?.isCancelled() || listingCancellation.signal.isCancelled())
            throw new AppError('operation-cancelled')
          const requestId = crypto.randomUUID()
          const cancel = () => {
            void invoke('cancel_request', { requestId }).catch(() => {})
          }
          const detach = cancellation?.subscribe(cancel)
          const detachListing = listingCancellation.signal.subscribe(cancel)
          try {
            const result = await invoke<
              'not-authenticated' | 'verification-required' | 'pagination-unavailable'
            >('report_douyin_search_failure', { accountId, listingId, requestId, code })
            if (cancellation?.isCancelled() || listingCancellation.signal.isCancelled())
              throw new AppError('operation-cancelled')
            if (
              result !== 'not-authenticated' &&
              result !== 'verification-required' &&
              result !== 'pagination-unavailable'
            )
              throw new AppError('invalid-response', '账号状态响应无效。')
            return result
          } catch (error) {
            if (error instanceof AppError) throw error
            throw mapNativeError(error)
          } finally {
            detach?.()
            detachListing()
          }
        },
        load(offset) {
          return request({ listingId, query, offset }, listingCancellation.signal)
        },
        async close() {
          if (listingCancellation.signal.isCancelled()) return
          // Abort a pending native load before queuing Close behind the account actor.
          listingCancellation.cancel()
          await invoke('close_douyin_listing', { accountId, listingId }).catch(() => {})
        },
      }
    },
  }
}
