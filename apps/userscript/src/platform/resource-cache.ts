import { GM } from '$'
import { AppError } from '@any-music/core'
import type { HttpClient, HttpRequest, HttpResponse } from '@any-music/core'
import type { ResourceCachePort } from '@any-music/music-workbench'
import type { RemoteImageResolver, ResourceCacheSnapshot } from '@any-music/ui'
import { DEFAULT_MEMORY_CACHE_MIB, MAX_MEMORY_CACHE_MIB } from '@any-music/ui'

import { createResourceMemoryCache } from './resource-memory-cache'

const PREFIX = 'any-music:userscript:resource-cache:v1:'
const INDEX = `${PREFIX}index`
const MAX_ENTRY_BYTES = 4 * 1024 ** 2
// Tampermonkey sends all GM values when injecting a script. Leave room below Chrome's
// 64 MiB message ceiling for the bundle, product generations and manager metadata.
const MAX_MANAGER_CACHE_BYTES = 32 * 1024 ** 2
const MAX_ENTRIES = 1024
const TTL_MS = 7 * 24 * 3600 * 1000
interface Entry {
  size: number
  charge: number
  kind: 'image' | 'audio'
  expires: number
  status: number
  headers: string
  mime: string
}
interface Manifest {
  capacity: number
  memoryCapacity?: number
  entries: [string, Entry][]
}
function encode(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += 16384)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 16384)))
  return btoa(parts.join(''))
}
function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}
function readHeaders(raw: string): Map<string, string> {
  const headers = new Map<string, string>()
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
  }
  return headers
}
async function requestKey(input: HttpRequest): Promise<string> {
  // Hash complete request identity; expiring URLs and credentials never enter stored metadata.
  const headers = Object.entries(input.headers ?? {})
    .map(([key, value]) => [key.toLowerCase(), value])
    .toSorted(([a], [b]) => a!.localeCompare(b!))
  const bytes = new TextEncoder().encode(JSON.stringify([input.url, input.credentials, headers]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Manager-owned cache, separate from product generations and every host page's origin.
 * One expanded workbench owns the GM writer session before this adapter is initialized.
 * Map insertion order gives O(1) LRU promotion; checkpoints coalesce metadata writes. */
export async function createGmResourceCache(transport: HttpClient) {
  const stored = await GM.getValue<Manifest | undefined>(INDEX)
  let capacity = stored?.capacity ?? 1024 ** 3
  if (!Number.isSafeInteger(capacity) || capacity < 128 * 1024 ** 2 || capacity > 100 * 1024 ** 3)
    capacity = 1024 ** 3
  const memoryValue = stored?.memoryCapacity
  const memory = createResourceMemoryCache(
    typeof memoryValue === 'number' &&
      Number.isSafeInteger(memoryValue) &&
      memoryValue >= 0 &&
      memoryValue <= MAX_MEMORY_CACHE_MIB * 1024 ** 2
      ? memoryValue
      : DEFAULT_MEMORY_CACHE_MIB * 1024 ** 2,
  )
  const entries = new Map<string, Entry>()
  let used = 0
  let epoch = 0
  let ended = false
  let queue = Promise.resolve()
  let checkpoint: ReturnType<typeof setTimeout> | undefined
  let ioCount = 0
  let pendingWrites = 0
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation)
    queue = result.then(
      () => {},
      () => {},
    )
    return result
  }
  const persist = () =>
    GM.setValue(INDEX, {
      capacity,
      memoryCapacity: memory.snapshot().memoryCapacityBytes,
      entries: Array.from(entries),
    } satisfies Manifest)
  function scheduleCheckpoint() {
    if (checkpoint || ended) return
    checkpoint = setTimeout(() => {
      checkpoint = undefined
      void enqueue(persist).catch(() => {})
    }, 500)
  }
  for (const item of (Array.isArray(stored?.entries) ? stored.entries : []).slice(-MAX_ENTRIES)) {
    if (!Array.isArray(item) || item.length !== 2) continue
    const [key, entry] = item
    if (
      /^[a-f0-9]{64}$/.test(key) &&
      !entries.has(key) &&
      Number.isSafeInteger(entry?.size) &&
      entry.size > 0 &&
      entry.size <= MAX_ENTRY_BYTES &&
      Number.isSafeInteger(entry.charge) &&
      entry.charge >= entry.size &&
      entry.charge <= 2 * MAX_ENTRY_BYTES &&
      Number.isSafeInteger(entry.expires) &&
      entry.expires > Date.now() &&
      [200, 206].includes(entry.status) &&
      ['image', 'audio'].includes(entry.kind) &&
      typeof entry.headers === 'string' &&
      entry.headers.length < 2048 &&
      typeof entry.mime === 'string' &&
      entry.mime.length <= 128
    ) {
      entries.set(key, entry)
      used += entry.charge
    }
  }
  async function remove(key: string) {
    const entry = entries.get(key)
    await GM.deleteValue(`${PREFIX}${key}`)
    if (entry) {
      used -= entry.charge
      entries.delete(key)
    }
  }
  async function trim(extra = 0) {
    while (
      used + extra > Math.min(capacity, MAX_MANAGER_CACHE_BYTES) ||
      entries.size >= MAX_ENTRIES
    ) {
      const key = entries.keys().next().value
      if (!key) break
      // Ordered deletion keeps GM IO and memory bounded by one stored record.
      // eslint-disable-next-line no-await-in-loop
      await remove(key)
    }
  }
  // Reclaim interrupted writes and expired entries once at startup, never per request.
  for (const key of await GM.listValues())
    if (key.startsWith(PREFIX) && key !== INDEX && !entries.has(key.slice(PREFIX.length)))
      await GM.deleteValue(key)
  await trim()
  await persist()

  async function get(input: HttpRequest, key: string): Promise<HttpResponse | undefined> {
    const entry = entries.get(key)
    if (
      !entry ||
      entry.expires <= Date.now() ||
      entry.size > (input.maxResponseBytes ?? Infinity) ||
      ioCount >= 4 ||
      ended
    )
      return
    ioCount++
    const current = epoch
    try {
      const value = await GM.getValue<string | undefined>(`${PREFIX}${key}`)
      if (
        current !== epoch ||
        entries.get(key) !== entry ||
        input.cancellation?.isCancelled() ||
        typeof value !== 'string' ||
        value.length > 2 * MAX_ENTRY_BYTES
      )
        return
      const bytes = decode(value)
      if (bytes.length !== entry.size) return
      entries.delete(key)
      entries.set(key, entry)
      scheduleCheckpoint()
      const response = {
        body: bytes,
        status: entry.status,
        statusText: entry.status === 206 ? 'Partial Content' : 'OK',
        headers: entry.headers,
      }
      memory.put(key, response, entry.expires)
      return response
    } catch {
      return undefined
    } finally {
      ioCount--
    }
  }
  async function put(key: string, response: HttpResponse, current: number) {
    if (
      current !== epoch ||
      ended ||
      typeof response.body === 'string' ||
      response.body.length === 0 ||
      response.body.length > MAX_ENTRY_BYTES ||
      ![200, 206].includes(response.status) ||
      pendingWrites >= 4
    )
      return
    const headers = readHeaders(response.headers)
    const mime = headers.get('content-type') ?? ''
    const kind = mime.startsWith('image/')
      ? 'image'
      : /^(audio|video)\//.test(mime) || mime.startsWith('application/octet-stream')
        ? 'audio'
        : undefined
    if (
      !kind ||
      mime.length > 128 ||
      headers.get('cache-control')?.toLowerCase().includes('no-store')
    )
      return
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('content-range') ?? '')
      if (
        !range ||
        Number(range[2]) - Number(range[1]) + 1 !== response.body.length ||
        Number(range[3]) <= Number(range[2])
      )
        return
    }
    const bytes = response.body
    const safeHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges']
      .filter((name) => headers.has(name))
      .map((name) => `${name}: ${headers.get(name)}`)
      .join('\r\n')
    pendingWrites++
    try {
      await enqueue(async () => {
        if (ended || epoch !== current) return
        const encoded = encode(bytes)
        const charge = encoded.length + 1024
        if (entries.has(key)) await remove(key)
        await trim(charge)
        await GM.setValue(`${PREFIX}${key}`, encoded)
        entries.set(key, {
          size: bytes.length,
          charge,
          kind,
          expires: Date.now() + TTL_MS,
          status: response.status,
          headers: safeHeaders,
          mime,
        })
        used += charge
        if (!ended && epoch === current)
          memory.put(key, { ...response, headers: safeHeaders }, Date.now() + TTL_MS)
        scheduleCheckpoint()
      })
    } finally {
      pendingWrites--
    }
  }
  const http: HttpClient = {
    async request(input) {
      if (input.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
      if (
        input.responseType !== 'bytes' ||
        (input.method ?? 'GET') !== 'GET' ||
        input.body !== undefined ||
        ended
      )
        return transport.request(input)
      const current = epoch
      let key: string
      try {
        key = await requestKey(input)
      } catch {
        return transport.request(input)
      }
      const memoryHit = memory.get(key, input.maxResponseBytes ?? Infinity)
      if (memoryHit) {
        const entry = entries.get(key)
        if (entry) {
          entries.delete(key)
          entries.set(key, entry)
          scheduleCheckpoint()
        }
      }
      const cached = memoryHit ?? (await get(input, key))
      if (input.cancellation?.isCancelled()) throw new AppError('operation-cancelled')
      if (cached) return cached
      const response = await transport.request(input)
      if (!input.cancellation?.isCancelled()) void put(key, response, current).catch(() => {})
      return response
    },
  }
  function snapshot(): ResourceCacheSnapshot {
    let imageBytes = 0
    let audioBytes = 0
    for (const entry of entries.values()) {
      if (entry.kind === 'image') imageBytes += entry.size
      else audioBytes += entry.size
    }
    return {
      ...memory.snapshot(),
      capacityBytes: capacity,
      usedBytes: used,
      imageBytes,
      audioBytes,
      entryCount: entries.size,
      directory: '脚本管理器专属存储（跨宿主页面共享）',
      customDirectory: false,
      canChooseDirectory: false,
      description:
        '油猴缓存通过 GM 读取的图片和媒体响应（单次最多 4 MiB），实际缓存另受 32 MiB 启动安全上限约束（含编码和元数据）。直接播放使用浏览器自身缓存；歌曲仍按原有原生流优先顺序播放。',
    }
  }
  const port: ResourceCachePort = {
    snapshot: async () => {
      await queue
      return snapshot()
    },
    configure: async (value) => {
      if (!Number.isSafeInteger(value) || value < 128 * 1024 ** 2 || value > 100 * 1024 ** 3)
        throw new AppError('invalid-input', '缓存容量必须在 128 MiB 至 100 GiB 之间。')
      epoch++
      return enqueue(async () => {
        const previous = capacity
        capacity = value
        try {
          await trim()
          await persist()
        } catch (error) {
          capacity = previous
          throw error
        }
        return snapshot()
      })
    },
    configureMemory: async (value) => {
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MEMORY_CACHE_MIB * 1024 ** 2)
        throw new AppError('invalid-input', '内存缓存容量必须在 0 至 1024 MiB 之间。')
      epoch++
      return enqueue(async () => {
        const previous = memory.snapshot().memoryCapacityBytes
        memory.configure(value)
        try {
          await persist()
        } catch (error) {
          memory.configure(previous)
          throw error
        }
        return snapshot()
      })
    },
    clear: async () => {
      epoch++
      memory.clear()
      return enqueue(async () => {
        for (const key of Array.from(entries.keys())) {
          // The manager has no bulk transaction; acknowledge one removal at a time.
          // eslint-disable-next-line no-await-in-loop
          await remove(key)
        }
        await persist()
        return snapshot()
      })
    },
  }
  // Artwork is lazy at the shared image boundary. A small FIFO bounds active GM image reads.
  let activeImages = 0
  const imageQueue: (() => void)[] = []
  const lifecycle = new AbortController()
  const resolveArtwork: RemoteImageResolver = async (url, signal) => {
    if (ended || !url.startsWith('https://')) return { url }
    if (activeImages >= 4) {
      if (imageQueue.length >= 128) return { url }
      await new Promise<void>((resolve) => {
        const resume = () => {
          signal?.removeEventListener('abort', cancel)
          resolve()
        }
        const cancel = () => {
          const index = imageQueue.indexOf(resume)
          if (index >= 0) imageQueue.splice(index, 1)
          resume()
        }
        imageQueue.push(resume)
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
      })
    }
    activeImages++
    try {
      if (ended || signal?.aborted) return { url }
      const response = await http.request({
        url,
        credentials: 'omit',
        responseType: 'bytes',
        maxResponseBytes: MAX_ENTRY_BYTES,
        timeoutMs: 30_000,
        cancellation: {
          isCancelled: () => ended || Boolean(signal?.aborted),
          subscribe: (listener) => {
            signal?.addEventListener('abort', listener)
            lifecycle.signal.addEventListener('abort', listener)
            return () => {
              signal?.removeEventListener('abort', listener)
              lifecycle.signal.removeEventListener('abort', listener)
            }
          },
        },
      })
      const mime = readHeaders(response.headers).get('content-type')
      if (
        response.status !== 200 ||
        typeof response.body === 'string' ||
        !mime?.startsWith('image/')
      )
        return { url }
      const objectUrl = URL.createObjectURL(
        new Blob([new Uint8Array(response.body)], { type: mime }),
      )
      return { url: objectUrl, release: () => URL.revokeObjectURL(objectUrl) }
    } finally {
      activeImages--
      imageQueue.shift()?.()
    }
  }
  let disposal: Promise<void> | undefined
  function dispose(): Promise<void> {
    if (disposal) return disposal
    ended = true
    epoch++
    memory.clear()
    lifecycle.abort()
    if (checkpoint) clearTimeout(checkpoint)
    while (imageQueue.length) imageQueue.shift()?.()
    disposal = queue.then(persist)
    return disposal
  }
  return { http, port, resolveArtwork, dispose }
}

/** Cache initialization failures remain retryable and never block product startup. */
export function createGmResourceCacheRuntime(
  transport: HttpClient,
  configure: (client?: HttpClient) => void,
) {
  let cache: Awaited<ReturnType<typeof createGmResourceCache>> | undefined
  let pending: Promise<Awaited<ReturnType<typeof createGmResourceCache>>> | undefined
  let closed = false
  async function get() {
    if (closed) throw new AppError('operation-cancelled', '缓存会话已关闭。')
    if (cache) return cache
    if (!pending) {
      pending = createGmResourceCache(transport).then(async (created) => {
        if (closed) {
          await created.dispose()
          throw new AppError('operation-cancelled')
        }
        cache = created
        configure(created.http)
        return created
      })
      void pending.catch(() => {
        pending = undefined
      })
    }
    return pending
  }
  const port: ResourceCachePort = {
    snapshot: async () => (await get()).port.snapshot(),
    configure: async (capacityBytes) => (await get()).port.configure(capacityBytes),
    configureMemory: async (capacityBytes) => (await get()).port.configureMemory(capacityBytes),
    clear: async () => (await get()).port.clear(),
  }
  const resolveArtwork: RemoteImageResolver = async (url, signal) =>
    (await get()).resolveArtwork(url, signal)
  async function dispose() {
    closed = true
    configure()
    const initialized = cache ?? (await pending?.catch(() => undefined))
    await initialized?.dispose()
  }
  void get().catch(() => {})
  return { port, resolveArtwork, dispose }
}
