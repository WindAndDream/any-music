import { AppError, type MusicPlaylist } from '@any-music/core'
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'

import type { PlaylistCoverCache } from '../../storage/playlist-cover-cache'

/** Resolve only stable references; stale reads and disposed writes never mutate the next workbench. */
export function usePlaylistArtwork(
  playlists: Readonly<Ref<readonly MusicPlaylist[]>>,
  cache?: PlaylistCoverCache,
  canReclaim: () => boolean = () => true,
) {
  const urls = shallowRef<Readonly<Record<string, string>>>({})
  let generation = 0
  let disposed = false
  onScopeDispose(() => {
    disposed = true
    generation++
  })
  let ready: Promise<void> | undefined
  function initialize(): Promise<void> | undefined {
    ready ??= cache
      ?.retain(playlists.value.flatMap(({ coverId }) => coverId ?? []))
      .catch((cause) => {
        ready = undefined
        throw cause
      })
    return ready
  }
  // A failed read must not hide the library; a new upload still reports the storage failure.
  void initialize()?.catch(() => {})
  watch(
    () => playlists.value.map(({ coverId }) => coverId).filter((id): id is string => Boolean(id)),
    async (ids, previousIds = []) => {
      const current = ++generation
      if (canReclaim()) {
        const liveIds = new Set(ids)
        for (const id of previousIds) if (!liveIds.has(id)) void cache?.remove(id).catch(() => {})
      }
      const entries = await Promise.all(
        [...new Set(ids)].map(async (id) => {
          try {
            return [id, await cache?.read(id)] as const
          } catch {
            return [id, undefined] as const
          }
        }),
      )
      if (current === generation)
        urls.value = Object.fromEntries(
          entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
        )
    },
    { immediate: true },
  )
  function assertActive() {
    if (disposed) throw new AppError('invalid-input', '歌单编辑已结束。')
  }
  async function store(cover?: string | null): Promise<string | undefined> {
    assertActive()
    if (!cover) return undefined
    await initialize()
    assertActive()
    if (!cache) throw new AppError('unsupported-operation', '此运行端暂不支持保存歌单封面。')
    const id = await cache.put(cover)
    assertActive()
    return id
  }
  return { urls, store, assertActive }
}
