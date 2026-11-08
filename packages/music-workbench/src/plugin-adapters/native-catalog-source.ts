import { AppError } from '@any-music/core'
import type { MusicSourcePlugin, TrackListing } from '@any-music/core'
import { decodeProtocolJson } from '@any-music/plugin-sdk/schema'
import type { NativePluginSnapshot } from '@any-music/ui'

import type { NativePluginAuthorityPort } from '../features/plugins/use-native-plugin-authority'

function unavailable(): never {
  throw new AppError('unsupported-operation', '此来源仅提供曲目目录，尚未提供媒体解析。')
}

/** Metadata catalogs are real source selections with stable references. They expose
 * no media/URL authority: arbitrary guest artwork/headers never enter product loading. */
export function createNativeCatalogSource(
  port: NativePluginAuthorityPort,
  state: NativePluginSnapshot,
): MusicSourcePlugin {
  const listing = (query: string): TrackListing => ({
    id: state.pluginId + ':' + query,
    title: state.pluginId,
    async *pages(options) {
      if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
      if (options?.startPage !== undefined && options.startPage !== 1)
        throw new AppError('unsupported-operation')
      const unsubscribe = options?.cancellation?.subscribe(() => {
        void port.cancelExecution?.(state.installId).catch(() => {})
      })
      try {
        // Bind identity once for the entire listing, including the explicit no-login choice.
        const account = port.sourceAccount ? await port.sourceAccount(state.installId) : undefined
        for (let pageNumber = 1; pageNumber <= 50; pageNumber++) {
          if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
          // One bounded page per consumer step; no speculative native/guest execution.
          const input = JSON.stringify({ query, pageNumber, pageSize: 20 })
          const pending = account
            ? port.execute!(state.installId, 'search', input, account)
            : port.execute!(state.installId, 'search', input)
          // oxlint-disable-next-line no-await-in-loop -- Consumer-driven pages must stay serial.
          const result = await pending
          if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
          if (
            result.value &&
            typeof result.value === 'object' &&
            'status' in result.value &&
            result.value.status === 'unavailable'
          )
            throw new AppError(
              'unsupported-operation',
              '来源目录能力未授权、上游不可用或超过预算。',
            )
          const page = decodeProtocolJson('WireTrackPage', JSON.stringify(result.value))
          if (
            page.pageNumber !== pageNumber ||
            page.items.some((item) => item.source.pluginId !== state.pluginId)
          )
            throw new AppError('invalid-response')
          yield {
            ...page,
            items: page.items.map((item) => ({
              id: item.id,
              title: item.title,
              artists: item.artists.map((artist) => ({ name: artist.name })),
              source: {
                pluginId: state.pluginId,
                resourceId: item.source.resourceId,
                mediaKind: item.source.mediaKind,
              },
            })),
          }
          if (!page.hasMore) return
        }
        throw new AppError('limit-exceeded', '来源分页超过本次预算。')
      } finally {
        unsubscribe?.()
      }
    },
  })
  return {
    descriptor: {
      id: state.pluginId,
      name: state.pluginId,
      provenance: 'external',
      description: '原生插件曲目目录（媒体解析不可用）',
      capabilities: { search: true, importUrl: false, session: !!port.sourceSession },
      importUrlScopes: [],
    },
    checkAvailability: async () => ({ status: 'available', checkedAtMs: Date.now() }),
    getSession: async () => port.sourceSession?.(state.installId) ?? { status: 'not-required' },
    getLoginUrl: () => (port.sourceSession ? 'anymusic://accounts' : undefined),
    validateImportUrl: unavailable,
    importFromUrl: unavailable,
    resolveMedia: async () => unavailable(),
    search: (request) => listing(request.query),
  }
}
