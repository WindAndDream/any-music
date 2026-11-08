import type { HttpResponse } from '@any-music/core'

interface MemoryEntry {
  response: HttpResponse & { body: Uint8Array }
  expires: number
  charge: number
}

/** Session-only bytes; ordered Map promotion/eviction is O(1), with no extra timers or IO. */
export function createResourceMemoryCache(capacityBytes: number) {
  const entries = new Map<string, MemoryEntry>()
  let usedBytes = 0
  function remove(key: string) {
    const entry = entries.get(key)
    if (!entry) return
    usedBytes -= entry.charge
    entries.delete(key)
  }
  function trim(extra = 0) {
    while (usedBytes + extra > capacityBytes || entries.size > 1024) {
      const key = entries.keys().next().value
      if (key === undefined) break
      remove(key)
    }
  }
  return {
    get(key: string, maximum: number): HttpResponse | undefined {
      const entry = entries.get(key)
      if (!entry) return
      if (entry.expires <= Date.now()) {
        remove(key)
        return
      }
      if (entry.response.body.byteLength > maximum) return
      entries.delete(key)
      entries.set(key, entry)
      // Consumers own their buffer; mutations must never corrupt later cache hits.
      return { ...entry.response, body: entry.response.body.slice() }
    },
    put(key: string, response: HttpResponse, expires: number) {
      if (typeof response.body === 'string') return
      const charge = response.body.byteLength + 1024
      if (!response.body.byteLength || charge > capacityBytes || expires <= Date.now()) return
      remove(key)
      trim(charge)
      entries.set(key, {
        response: { ...response, body: response.body.slice() },
        expires,
        charge,
      })
      usedBytes += charge
      trim()
    },
    configure(value: number) {
      capacityBytes = value
      trim()
    },
    clear() {
      entries.clear()
      usedBytes = 0
    },
    snapshot: () => ({
      memoryCapacityBytes: capacityBytes,
      memoryUsedBytes: usedBytes,
      memoryEntryCount: entries.size,
    }),
  }
}
