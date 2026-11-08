import { GM } from '$'
import {
  createProductGenerationStorage,
  PRODUCT_COMMIT_KEY,
} from '@any-music/music-workbench/storage'
import type {
  ProductGenerationBackend,
  ProductGenerationStorage,
} from '@any-music/music-workbench/storage'

const PREFIX = 'any-music:userscript:'
const TAB_OWNER = 'anyMusicProductWriter'
let initialization = 0
let activeOwner: string | undefined
let tabUpdates = Promise.resolve()
let pendingWrites = Promise.resolve()

export interface GmProductStorage extends ProductGenerationStorage {
  /** Freeze/drain runtime-local writers before releasing the shared manager tab owner. */
  onDispose(cleanup: () => Promise<void>): void
  flush(): Promise<void>
  /** Freeze synchronously, drain persistence, then release the tab registration. */
  dispose(): Promise<void>
}

function updateTab(
  update: (tab: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const result = tabUpdates.then(async () => {
    const tab = await GM.getTab()
    await GM.saveTab(update(tab))
  })
  tabUpdates = result.catch(() => {})
  return result
}

/** GM's synchronous values are tab-local caches, not atomic cross-tab registers.
 * Hold one manager-owned writer session for the workbench lifetime. Announce
 * before querying peers: a concurrent contender sees our owner or withdraws
 * before we can become sole owner. Closed tabs disappear from GM.getTabs;
 * suspended sessions never expire by time. All product IO uses acknowledged
 * async GM operations; the shared synchronous port reads our hydrated snapshot. */
export async function createGmProductStorage(): Promise<GmProductStorage> {
  const attempt = ++initialization
  activeOwner = undefined
  const owner = crypto.randomUUID()
  let open = false
  let ended = false
  let writes = Promise.resolve()
  let failed = false
  let disposal: Promise<void> | undefined
  const cleanups = new Set<() => Promise<void>>()
  const onPageHide = () => {
    void dispose().catch(() => {})
  }
  const dispose = (): Promise<void> => {
    open = false
    ended = true
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide)
    if (activeOwner === owner) activeOwner = undefined
    disposal ??= Promise.allSettled([writes, ...Array.from(cleanups, (cleanup) => cleanup())])
      .then((results) => {
        const failure = results.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      })
      .finally(() =>
        updateTab((tab) => {
          if (tab[TAB_OWNER] !== owner) return tab
          const { [TAB_OWNER]: _previousOwner, ...rest } = tab
          return rest
        }),
      )
    // A same-document reinitialization must wait for cache shutdown too, before
    // replacing this tab's owner record. Preserve any newer acknowledged product IO.
    pendingWrites = Promise.allSettled([pendingWrites, disposal]).then(() => {})
    return disposal
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide, { once: true })
  try {
    // Reconfiguration freezes the old writer before waiting for its queued IO.
    await pendingWrites.catch(() => {})
    await updateTab((tab) => {
      if (ended || attempt !== initialization)
        throw new Error('Product storage initialization was replaced')
      return { ...tab, [TAB_OWNER]: owner }
    })
    const tabs = await GM.getTabs()
    if (ended || attempt !== initialization)
      throw new Error('Product storage initialization was replaced')
    if (!Object.values(tabs).some((tab) => tab[TAB_OWNER] === owner))
      throw new Error('Unable to confirm the product writer session')
    if (Object.values(tabs).some((tab) => tab[TAB_OWNER] !== undefined && tab[TAB_OWNER] !== owner))
      throw new Error('另一个标签页已展开 Any Music，请先关闭该标签页后重试。')
    activeOwner = owner
    open = true
    const values = new Map<string, unknown>()
    const readValue = async (key: string): Promise<void> => {
      values.set(key, await GM.getValue(`${PREFIX}${key}`))
    }
    await Promise.all(
      [PRODUCT_COMMIT_KEY, 'product-data:journal', 'runtime:proxy:v1'].map(readValue),
    )
    const pointer = values.get(PRODUCT_COMMIT_KEY) as { slot?: unknown; id?: unknown } | undefined
    if (pointer && (pointer.slot === 0 || pointer.slot === 1) && typeof pointer.id === 'string') {
      await Promise.all(
        ['core', 'host', 'namespaces', 'manifest'].map((part) =>
          readValue(`product-data:g${pointer.slot}:${pointer.id}:${part}`),
        ),
      )
    }
    if (ended || attempt !== initialization)
      throw new Error('Product storage initialization was replaced')
    const enqueue = (operation: () => Promise<unknown>): void => {
      writes = writes.then(operation).then(() => {})
      pendingWrites = writes
      void writes.catch(() => {
        if (failed) return
        failed = true
        if (typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent('any-music:storage-error'))
      })
    }
    let writing = false
    const raw: ProductGenerationBackend = {
      read: <T>(key: string, fallback?: T) => (values.get(key) as T | undefined) ?? fallback,
      write(key, value) {
        const copy: unknown = JSON.parse(JSON.stringify(value))
        values.set(key, copy)
        enqueue(() => GM.setValue(`${PREFIX}${key}`, copy))
      },
      remove(key) {
        values.delete(key)
        enqueue(() => GM.deleteValue(`${PREFIX}${key}`))
      },
      withExclusiveWrite(operation) {
        if (!open || activeOwner !== owner)
          throw new Error('Product storage session changed; reload before writing')
        if (failed) throw new Error('GM product persistence failed; restart before writing')
        if (writing) throw new Error('Product storage is busy')
        writing = true
        try {
          return operation()
        } finally {
          writing = false
        }
      },
    }
    const storage = createProductGenerationStorage(raw, { runtime: 'userscript' })
    await writes
    if (ended || attempt !== initialization)
      throw new Error('Product storage initialization was replaced')
    return {
      ...storage,
      flush: () => writes,
      dispose,
      onDispose: (cleanup) => {
        cleanups.add(cleanup)
      },
    }
  } catch (error) {
    await dispose().catch(() => {})
    throw error
  }
}
