import type { ResourceCachePort } from '@any-music/music-workbench'
import type { RemoteImageResolver } from '@any-music/ui'
import { invoke } from '@tauri-apps/api/core'

import { mapNativeError } from './native-http'

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(name, args)
  } catch (cause) {
    throw mapNativeError(cause)
  }
}
export const nativeResourceCache: ResourceCachePort = {
  snapshot: () => command('resource_cache_snapshot'),
  configure: (capacityBytes) => command('resource_cache_configure', { capacityBytes }),
  configureMemory: (memoryCapacityBytes) =>
    command('resource_cache_configure', { memoryCapacityBytes }),
  clear: () => command('resource_cache_clear'),
  chooseDirectory: (reset) => command('resource_cache_directory', { reset }),
}

/** Coalesce only IPC registration, not resource bytes; native signed addresses stay session-only. */
const registrations = new Map<string, Promise<{ url: string }>>()
export const resolveNativeArtwork: RemoteImageResolver = (url) => {
  if (!url.startsWith('https://')) return Promise.resolve({ url })
  const existing = registrations.get(url)
  if (existing) return existing
  const pending = command<string>('register_artwork', { url }).then((address) => ({ url: address }))
  registrations.set(url, pending)
  if (registrations.size > 512) registrations.delete(registrations.keys().next().value!)
  void pending.catch(() => {
    if (registrations.get(url) === pending) registrations.delete(url)
  })
  return pending
}
