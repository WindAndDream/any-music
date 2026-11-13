import { AppError } from '@any-music/core'
import type {
  CancellationSignal,
  MusicSourcePlugin,
  ResolvedMediaSource,
  Track,
  TrackListing,
  TrackPage,
} from '@any-music/core'

/** Host-only lifetime gate. A new generation never revives old listings or media leases. */
export function createManagedMusicSourcePlugin(
  source: MusicSourcePlugin,
  prepareMedia?: (track: Track, media: ResolvedMediaSource) => Promise<ResolvedMediaSource>,
) {
  let enabled = true
  let generation = 0
  const tasks = new Set<() => void>()
  const assertCurrent = (expected = generation) => {
    if (!enabled || expected !== generation)
      throw new AppError('operation-cancelled', '音乐源已停用或失效，请启用后重新操作。')
  }
  function task(external?: CancellationSignal) {
    const expected = generation
    assertCurrent(expected)
    let cancelled = false
    const listeners = new Set<() => void>()
    const cancel = () => {
      if (cancelled) return
      cancelled = true
      const pending = [...listeners]
      for (const listener of pending) listener()
      listeners.clear()
    }
    const detach = external?.subscribe(cancel)
    if (external?.isCancelled()) cancel()
    tasks.add(cancel)
    return {
      signal: {
        isCancelled: () => cancelled,
        subscribe(listener) {
          if (cancelled) listener()
          else listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      } satisfies CancellationSignal,
      assert() {
        assertCurrent(expected)
        if (cancelled) throw new AppError('operation-cancelled')
      },
      finish() {
        detach?.()
        tasks.delete(cancel)
        cancel()
      },
    }
  }
  function listing(value: TrackListing): TrackListing {
    const expected = generation
    return {
      id: value.id,
      get title() {
        return value.title
      },
      get sourceUrl() {
        return value.sourceUrl
      },
      get estimatedTotal() {
        return value.estimatedTotal
      },
      get account() {
        return value.account
      },
      get verify() {
        if (!value.verify) return undefined
        return async (options: Parameters<NonNullable<TrackListing['verify']>>[0]) => {
          assertCurrent(expected)
          const run = task(options?.cancellation)
          try {
            run.assert()
            await value.verify!({ ...options, cancellation: run.signal })
            run.assert()
          } finally {
            run.finish()
          }
        }
      },
      async *pages(options) {
        assertCurrent(expected)
        const run = task(options?.cancellation)
        let iterator: AsyncIterator<TrackPage> | undefined
        let closing: Promise<unknown> | undefined
        const close = () => (closing ??= Promise.resolve().then(() => iterator?.return?.()))
        // Closing is queued by async generators; cancellation reaches the pending request first.
        let detachClose: (() => void) | undefined
        try {
          run.assert()
          iterator = value.pages({ ...options, cancellation: run.signal })[Symbol.asyncIterator]()
          detachClose = run.signal.subscribe(() => {
            void close().catch(() => {})
          })
          while (true) {
            run.assert()
            // eslint-disable-next-line no-await-in-loop
            const next = await iterator.next()
            run.assert()
            if (next.done) return
            if (!next.value.hasMore) {
              // UI consumers stop at hasMore=false without another next(); close native readers now.
              // eslint-disable-next-line no-await-in-loop
              await close()
              run.assert()
              detachClose?.()
              run.finish()
              yield next.value
              return
            }
            yield next.value
          }
        } finally {
          detachClose?.()
          run.finish()
          await close()
        }
      },
    }
  }
  const plugin: MusicSourcePlugin = {
    descriptor: source.descriptor,
    checkAvailability: () => source.checkAvailability(),
    validateImportUrl: (url) => source.validateImportUrl(url),
    getLoginUrl: () => source.getLoginUrl(),
    async getSession() {
      const expected = generation
      assertCurrent(expected)
      const result = await source.getSession()
      assertCurrent(expected)
      return result
    },
    search(request) {
      assertCurrent()
      return listing(source.search(request))
    },
    importFromUrl(request) {
      assertCurrent()
      return listing(source.importFromUrl(request))
    },
    async resolveMedia(track, options) {
      const run = task(options?.cancellation)
      let resolved: ResolvedMediaSource | undefined
      let released = false
      const release = () => {
        if (released) return
        released = true
        detachRelease()
        run.finish()
        resolved?.release?.()
      }
      const detachRelease = run.signal.subscribe(() => {
        if (resolved) release()
      })
      try {
        run.assert()
        const original = await source.resolveMedia(track, { ...options, cancellation: run.signal })
        let originalReleased = false
        resolved = {
          ...original,
          release() {
            if (originalReleased) return
            originalReleased = true
            original.release?.()
          },
        }
        run.assert()
        if (prepareMedia) {
          const prepared = await prepareMedia(track, resolved)
          if (released) {
            prepared.release?.()
            throw new AppError('operation-cancelled')
          }
          resolved = prepared
          run.assert()
        }
        return { ...resolved, release }
      } catch (error) {
        release()
        throw error
      }
    },
  }
  function invalidate() {
    generation++
    // Release callbacks remove their own task and may acquire new work in the next generation.
    const pending = [...tasks]
    for (const cancel of pending) cancel()
  }
  return {
    plugin,
    invalidate,
    setEnabled(value: boolean) {
      if (enabled === value) return
      enabled = value
      if (!value) {
        invalidate()
      }
    },
    dispose() {
      enabled = false
      invalidate()
    },
  }
}
