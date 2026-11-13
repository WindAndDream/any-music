import type { HttpClient, HttpRequest, HttpResponse } from '@any-music/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const manager = vi.hoisted(() => ({ values: new Map<string, unknown>(), fail: false, reads: 0 }))
vi.mock('$', () => ({
  GM: {
    getValue: async (key: string) => {
      manager.reads++
      return manager.values.get(key)
    },
    setValue: async (key: string, value: unknown) => {
      if (manager.fail) throw new Error('quota')
      manager.values.set(key, structuredClone(value))
    },
    deleteValue: async (key: string) => {
      manager.values.delete(key)
    },
    listValues: async () => Array.from(manager.values.keys()),
  },
}))
import {
  createGmResourceCache,
  createGmResourceCacheRuntime,
} from '../../src/platform/resource-cache'
const response = (): HttpResponse => ({
  body: new Uint8Array([1, 2, 3, 4]),
  status: 200,
  statusText: 'OK',
  headers: 'content-type: audio/mp4\r\ncontent-length: 4\r\nset-cookie: never-store=secret',
})
const request: HttpRequest = {
  url: 'https://example.com/audio?sign=secret',
  credentials: 'include',
  responseType: 'bytes',
  maxResponseBytes: 8,
}
beforeEach(() => {
  manager.values.clear()
  manager.fail = false
  manager.reads = 0
})
describe('manager-owned resource cache', () => {
  it('reuses bounded memory before GM reads, copies bytes and retains only its capacity after restart', async () => {
    const transport = {
      request: vi.fn(async () => ({ ...response(), body: new Uint8Array(600 * 1024).fill(1) })),
    }
    let cache = await createGmResourceCache(transport)
    await cache.port.configureMemory(1024 ** 2)
    const input = { ...request, maxResponseBytes: undefined }
    const first = await cache.http.request(input)
    await cache.port.snapshot()
    if (typeof first.body !== 'string') first.body[0] = 99
    const reads = manager.reads
    const hit = await cache.http.request(input)
    expect(hit.body[0]).toBe(1)
    expect(manager.reads).toBe(reads)
    expect(transport.request).toHaveBeenCalledOnce()
    await cache.http.request({ ...input, url: 'https://example.com/other' })
    const snapshot = await cache.port.snapshot()
    expect(snapshot.memoryUsedBytes).toBeLessThanOrEqual(1024 ** 2)
    expect(snapshot.memoryEntryCount).toBe(1)
    await cache.http.request(input)
    expect(manager.reads).toBeGreaterThan(reads)
    expect(transport.request).toHaveBeenCalledTimes(2)
    await expect(cache.port.configureMemory(-1)).rejects.toThrow('内存')
    await expect(cache.port.configureMemory(1024 ** 3 + 1)).rejects.toThrow('内存')
    await cache.port.configureMemory(0)
    expect((await cache.port.snapshot()).memoryUsedBytes).toBe(0)
    await cache.dispose()
    cache = await createGmResourceCache(transport)
    expect((await cache.port.snapshot()).memoryCapacityBytes).toBe(0)
    await cache.port.configureMemory(1024 ** 2)
    await cache.http.request(input)
    expect((await cache.port.snapshot()).memoryUsedBytes).toBeGreaterThan(0)
    expect((await cache.port.clear()).memoryUsedBytes).toBe(0)
    await cache.dispose()
  })
  it('bounds accumulated GM values below the manager injection message ceiling across restarts', async () => {
    const productKey = 'any-music:userscript:product-data:commit'
    manager.values.set(productKey, { keep: true })
    const transport = {
      request: vi.fn(async (): Promise<HttpResponse> => ({
        ...response(),
        body: new Uint8Array(2 * 1024 ** 2),
        headers: 'content-type: audio/mp4',
      })),
    }
    let cache = await createGmResourceCache(transport)
    await cache.port.configure(100 * 1024 ** 3)
    for (let index = 0; index < 32; index++) {
      // Different media URLs accumulate more than 64 MiB without the runtime safety ceiling.
      // eslint-disable-next-line no-await-in-loop
      await cache.http.request({
        ...request,
        url: `https://example.com/${index}`,
        maxResponseBytes: undefined,
      })
      // eslint-disable-next-line no-await-in-loop
      const snapshot = await cache.port.snapshot()
      expect(snapshot.usedBytes).toBeLessThanOrEqual(32 * 1024 ** 2)
    }
    await cache.dispose()
    expect(
      new TextEncoder().encode(JSON.stringify(Array.from(manager.values))).length,
    ).toBeLessThan(32 * 1024 ** 2)
    expect(manager.values.get(productKey)).toEqual({ keep: true })
    cache = await createGmResourceCache(transport)
    await cache.http.request({
      ...request,
      url: 'https://example.com/31',
      maxResponseBytes: undefined,
    })
    expect(transport.request).toHaveBeenCalledTimes(32)
    await cache.http.request({
      ...request,
      url: 'https://example.com/0',
      maxResponseBytes: undefined,
    })
    expect(transport.request).toHaveBeenCalledTimes(33)
    expect((await cache.port.snapshot()).usedBytes).toBeLessThanOrEqual(32 * 1024 ** 2)
    await cache.dispose()
  }, 30_000)

  it('trims an oversized cache before checkpointing without deleting product values', async () => {
    const prefix = 'any-music:userscript:resource-cache:v1:'
    const keys = Array.from({ length: 16 }, (_, index) => index.toString(16).padStart(64, '0'))
    manager.values.set(`${prefix}index`, {
      capacity: 1024 ** 3,
      entries: keys.map((key) => [
        key,
        {
          size: 2 * 1024 ** 2,
          charge: 3 * 1024 ** 2,
          kind: 'audio',
          expires: Date.now() + 60_000,
          status: 200,
          headers: 'content-type: audio/mp4',
          mime: 'audio/mp4',
        },
      ]),
    })
    for (const key of keys) manager.values.set(`${prefix}${key}`, 'cached')
    manager.values.set('any-music:userscript:product-data:commit', { keep: true })
    const cache = await createGmResourceCache({ request: vi.fn() })
    expect((await cache.port.snapshot()).usedBytes).toBe(30 * 1024 ** 2)
    expect(manager.values.has(`${prefix}${keys[0]}`)).toBe(false)
    expect(manager.values.has(`${prefix}${keys.at(-1)}`)).toBe(true)
    expect(manager.values.get('any-music:userscript:product-data:commit')).toEqual({ keep: true })
    await cache.dispose()
  })

  it('does not block product startup when cache storage fails and retries initialization', async () => {
    manager.fail = true
    const configure = vi.fn()
    const runtime = createGmResourceCacheRuntime({ request: vi.fn() }, configure)
    await expect(runtime.port.snapshot()).rejects.toThrow('quota')
    expect(configure).not.toHaveBeenCalled()
    manager.fail = false
    expect((await runtime.port.snapshot()).entryCount).toBe(0)
    expect(configure).toHaveBeenCalledOnce()
    await runtime.dispose()
    expect(configure).toHaveBeenLastCalledWith()
    await expect(runtime.port.snapshot()).rejects.toMatchObject({ code: 'operation-cancelled' })
  })
  it('reuses bounded bytes across restarts, hashes URLs and never touches product records', async () => {
    manager.values.set('any-music:userscript:product-data:commit', { keep: true })
    const transport = { request: vi.fn(async () => response()) }
    let cache = await createGmResourceCache(transport)
    await cache.http.request(request)
    expect((await cache.port.snapshot()).audioBytes).toBe(4)
    const cached = await cache.http.request(request)
    expect(cached.body).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(cached.headers).not.toContain('set-cookie')
    expect(transport.request).toHaveBeenCalledOnce()
    await cache.dispose()
    expect(JSON.stringify(Array.from(manager.values))).not.toContain('sign=secret')
    expect(JSON.stringify(Array.from(manager.values))).not.toContain('never-store')
    cache = await createGmResourceCache(transport)
    await cache.http.request(request)
    expect(transport.request).toHaveBeenCalledOnce()
    await expect(cache.port.configure(1024 ** 2)).rejects.toMatchObject({ code: 'invalid-input' })
    await cache.port.clear()
    expect((await cache.port.snapshot()).usedBytes).toBe(0)
    expect(manager.values.get('any-music:userscript:product-data:commit')).toEqual({ keep: true })
    await cache.dispose()
  })
  it('rejects late network completion after clear and propagates cancellation without a request', async () => {
    let finish!: (value: HttpResponse) => void
    const transport = {
      request: vi.fn(
        () =>
          new Promise<HttpResponse>((resolve) => {
            finish = resolve
          }),
      ),
    }
    const cache = await createGmResourceCache(transport)
    const pending = cache.http.request(request)
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalledOnce())
    await cache.port.clear()
    finish(response())
    await pending
    expect((await cache.port.snapshot()).entryCount).toBe(0)
    await expect(
      cache.http.request({
        ...request,
        cancellation: { isCancelled: () => true, subscribe: () => () => {} },
      }),
    ).rejects.toMatchObject({ code: 'operation-cancelled' })
    expect(transport.request).toHaveBeenCalledOnce()
    await cache.dispose()
  })
  it('keeps text APIs, no-store, invalid Range and storage failures out of the cache', async () => {
    const transport = {
      request: vi.fn(async (): Promise<HttpResponse> => response()),
    } satisfies HttpClient
    const cache = await createGmResourceCache(transport)
    for (const result of [
      { ...response(), headers: 'content-type: audio/mp4\r\ncache-control: no-store' },
      {
        ...response(),
        status: 206,
        headers: 'content-type: audio/mp4\r\ncontent-range: bytes 0-8/16',
      },
    ]) {
      transport.request.mockResolvedValueOnce(result)
      // Sequential requests prove each invalid response leaves the next request uncached.
      // eslint-disable-next-line no-await-in-loop
      await cache.http.request(request)
    }
    expect((await cache.port.snapshot()).entryCount).toBe(0)
    manager.fail = true
    expect((await cache.http.request(request)).body).toEqual(response().body)
    expect((await cache.port.snapshot()).entryCount).toBe(0)
    manager.fail = false
    await cache.http.request({ ...request, responseType: 'text' })
    expect((await cache.port.snapshot()).entryCount).toBe(0)
    await cache.http.request(request)
    expect((await cache.port.snapshot()).entryCount).toBe(1)
    await cache.dispose()
  })
})
