import { AppError } from '@any-music/core'
import type { TrackListing } from '@any-music/core'
import { PluginCallError } from '@any-music/plugin-sdk'
import type { MusicSourceProvider, WireListing } from '@any-music/plugin-sdk/music'
import { assertSchema } from '@any-music/plugin-sdk/schema'

import { errorFromWire, trackFromWire } from './music-source-values'

/** A host iterator drives exactly one nextPage per consumer step and always closes its cursor. */
export function listingFromWire(
  provider: MusicSourceProvider,
  wire: WireListing,
  hostOptions?: { verify?: TrackListing['verify'] },
): TrackListing {
  assertSchema('WireListing', wire)
  let consumed = false
  return {
    id: wire.id,
    title: wire.title,
    sourceUrl: wire.sourceUrl,
    estimatedTotal: wire.estimatedTotal,
    verify: hostOptions?.verify,
    async *pages(options) {
      if (consumed) throw new AppError('conflict')
      consumed = true
      const cancel = () => {
        void provider.cancel({ listingRef: wire.listingRef }).catch(() => {})
      }
      const unsubscribe = options?.cancellation?.subscribe(cancel)
      try {
        if (options?.startPage !== undefined && options.startPage !== 1)
          throw new AppError('unsupported-operation')
        while (true) {
          if (options?.cancellation?.isCancelled()) {
            cancel()
            throw new AppError('operation-cancelled')
          }
          // The consumer owns pagination; parallel calls would prefetch unwanted pages.
          // eslint-disable-next-line no-await-in-loop
          const page = await provider.nextPage({ listingRef: wire.listingRef })
          assertSchema('WireTrackPage', page)
          if (options?.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
          yield { ...page, items: page.items.map(trackFromWire) }
          if (!page.hasMore) break
        }
      } catch (error) {
        throw error instanceof PluginCallError ? errorFromWire(error.detail) : error
      } finally {
        unsubscribe?.()
        await provider.close({ listingRef: wire.listingRef })
      }
    },
  }
}
