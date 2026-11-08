import {
  AppError,
  PLAYLIST_COVER_MAX_LENGTH,
  PLAYLIST_COVER_CACHE_MAX_LENGTH,
} from '@any-music/core'
export interface PlaylistCoverCache {
  read(id: string): Promise<string | undefined>
  put(dataUrl: string): Promise<string>
  retain(ids: readonly string[]): Promise<void>
  remove(id: string): Promise<void>
  dispose(): Promise<void>
}

function isValidCover(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= PLAYLIST_COVER_MAX_LENGTH &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

/** Bounded uploaded artwork, outside product generations, backups and credentials.
 * Serialized writes keep two concurrent editors from replacing each other's entries. */
export function createPlaylistCoverCache(backend: {
  read(): Promise<unknown>
  write(value: Record<string, string>): Promise<void>
}): PlaylistCoverCache {
  let queue = Promise.resolve()
  let ended = false
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (ended) return Promise.reject(new AppError('storage-write-failed', '封面存储已关闭。'))
    const result = queue.then(operation)
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  let snapshot: Promise<Record<string, string>> | undefined
  async function readBackend(): Promise<Record<string, string>> {
    const raw = await backend.read()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    let size = 0
    return Object.fromEntries(
      Object.entries(raw).filter(([id, data]) => {
        if (!/^playlist-cover:[a-f0-9-]{36}$/.test(id) || !isValidCover(data)) return false
        size += data.length
        return size <= PLAYLIST_COVER_CACHE_MAX_LENGTH
      }),
    )
  }
  function load(): Promise<Record<string, string>> {
    snapshot ??= readBackend().catch((cause) => {
      snapshot = undefined
      throw cause
    })
    return snapshot
  }
  return {
    async read(id) {
      await queue
      return (await load())[id]
    },
    put(dataUrl) {
      return enqueue(async () => {
        if (!isValidCover(dataUrl)) throw new AppError('invalid-input', '封面格式无效或图片过大。')
        const entries = { ...(await load()) }
        const size = Object.values(entries).reduce((total, value) => total + value.length, 0)
        if (size + dataUrl.length > PLAYLIST_COVER_CACHE_MAX_LENGTH)
          throw new AppError('storage-write-failed', '歌单封面存储空间已满，请先移除不需要的封面。')
        const id = `playlist-cover:${crypto.randomUUID()}`
        entries[id] = dataUrl
        await backend.write(entries)
        snapshot = Promise.resolve(entries)
        return id
      })
    },
    retain(ids) {
      return enqueue(async () => {
        const keep = new Set(ids)
        const entries = Object.fromEntries(
          Object.entries(await load()).filter(([id]) => keep.has(id)),
        )
        await backend.write(entries)
        snapshot = Promise.resolve(entries)
      })
    },
    remove(id) {
      return enqueue(async () => {
        const entries = { ...(await load()) }
        if (!(id in entries)) return
        delete entries[id]
        await backend.write(entries)
        snapshot = Promise.resolve(entries)
      })
    },
    dispose() {
      ended = true
      return queue
    },
  }
}
