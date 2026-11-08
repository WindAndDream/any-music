import { AppError, toAppErrorState } from '@any-music/core'
import type { CancellationSignal, MusicPlaylist, Track } from '@any-music/core'
import type { UiPlaylistValidation } from '@any-music/ui/theme'
import { readonly, shallowRef, watch } from 'vue'

/** Only an open playlist admits checks. One run deduplicates leaves and caps concurrent requests. */
export function usePlaylistValidation(options: {
  playlist: () => MusicPlaylist | undefined
  getTrack: (id: string) => Track | undefined
  leafIds: (track: Track) => readonly string[]
  check: (track: Track, cancellation: CancellationSignal) => Promise<void>
}) {
  const state = shallowRef<UiPlaylistValidation>({
    status: 'idle',
    checkedCount: 0,
    totalCount: 0,
    issues: [],
  })
  const attempt = shallowRef(0)
  watch(
    () => {
      const playlist = options.playlist()
      return playlist ? JSON.stringify([playlist.id, playlist.trackIds, attempt.value]) : ''
    },
    (_, __, onCleanup) => {
      const playlist = options.playlist()
      if (!playlist) {
        state.value = { status: 'idle', checkedCount: 0, totalCount: 0, issues: [] }
        return
      }
      let cancelled = false
      const listeners = new Set<() => void>()
      const cancellation: CancellationSignal = {
        isCancelled: () => cancelled,
        subscribe: (listener) => {
          if (cancelled) listener()
          else listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      onCleanup(() => {
        cancelled = true
        for (const listener of listeners) listener()
        listeners.clear()
      })
      const owners = playlist.trackIds.map((id) => options.getTrack(id))
      const checked = new Set<string>()
      // Queue leaves once; the workers below also cover dependencies shared by custom tracks.
      const leaves = new Map<string, Track | undefined>()
      const dependencies = playlist.trackIds.map((id, index) => {
        const track = owners[index]
        const ids = track ? options.leafIds(track) : [id]
        for (const leafId of ids) leaves.set(leafId, options.getTrack(leafId))
        return ids
      })
      const pending = [...leaves]
      let cursor = 0
      state.value = { status: 'checking', checkedCount: 0, totalCount: owners.length, issues: [] }
      const results = new Map<string, UiPlaylistValidation['issues'][number]['error']>()
      async function worker() {
        while (cursor < pending.length) {
          if (cancelled) return
          const [id, track] = pending[cursor++]!
          try {
            if (!track) throw new AppError('source-not-found', '歌单歌曲或配方依赖不存在。')
            // Each worker must finish its current request before admitting another leaf.
            // eslint-disable-next-line no-await-in-loop
            await options.check(track, cancellation)
          } catch (cause) {
            if (cancelled) return
            results.set(id, toAppErrorState(cause, 'upstream-error', '检查歌曲可用性失败。'))
          }
          if (cancelled) return
          checked.add(id)
          publish(false)
        }
      }
      function publish(complete: boolean) {
        let checkedCount = 0
        const issues: UiPlaylistValidation['issues'][number][] = []
        dependencies.forEach((ids, index) => {
          if (ids.every((id) => checked.has(id))) checkedCount++
          for (const id of ids) {
            const error = results.get(id)
            if (error)
              issues.push({
                trackId: playlist!.trackIds[index]!,
                title: owners[index]?.title ?? playlist!.trackIds[index]!,
                error,
              })
          }
        })
        state.value = {
          status: complete ? 'complete' : 'checking',
          checkedCount,
          totalCount: owners.length,
          issues,
        }
      }
      void Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker)).then(() => {
        if (!cancelled) publish(true)
      })
    },
    { immediate: true, flush: 'sync' },
  )
  return {
    state: readonly(state),
    retry: () => {
      attempt.value++
    },
  }
}
