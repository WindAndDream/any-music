import { describe, expect, it, vi } from 'vitest'

import { createPlaylistCoverCache } from '#workbench/storage/playlist-cover-cache'

const image = 'data:image/jpeg;base64,AAAA'
describe('runtime-local playlist covers', () => {
  it('serializes writes, shares one read and recovers after an acknowledged storage failure', async () => {
    let stored: Record<string, string> = {}
    const backend = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (value) => {
        stored = structuredClone(value)
      }),
    }
    const cache = createPlaylistCoverCache(backend)
    const ids = await Promise.all([cache.put(image), cache.put(image)])
    expect(new Set(ids).size).toBe(2)
    expect(Object.keys(stored)).toEqual(ids)
    expect(await Promise.all(ids.map(cache.read))).toEqual([image, image])
    expect(backend.read).toHaveBeenCalledTimes(1)
    backend.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(cache.put(image)).rejects.toThrow('disk full')
    expect(Object.keys(stored)).toEqual(ids)
    expect(await cache.read(await cache.put(image))).toBe(image)
  })
  it('bounds aggregate bytes and rejects active formats and oversized data', async () => {
    let stored: Record<string, string> = {}
    const backend = {
      read: async () => stored,
      write: async (value: Record<string, string>) => {
        stored = value
      },
    }
    const cache = createPlaylistCoverCache(backend)
    await expect(cache.put('data:image/svg+xml,<svg/>')).rejects.toThrow(/格式/)
    await expect(cache.put(`data:image/jpeg;base64,${'A'.repeat(512 * 1024)}`)).rejects.toThrow(
      /过大/,
    )
    const large = `data:image/jpeg;base64,${'A'.repeat(512 * 1024 - 32)}`
    const ids = await Promise.all(Array.from({ length: 16 }, () => cache.put(large)))
    await expect(cache.put(large)).rejects.toThrow(/空间已满/)
    expect(
      Object.values(stored).reduce((total, value) => total + value.length, 0),
    ).toBeLessThanOrEqual(8 * 1024 ** 2)
    expect(await cache.read(ids[0]!)).toBe(large)
    await cache.remove(ids[0]!)
    expect(await cache.read(await cache.put(large))).toBe(large)
    await cache.retain([ids[1]!])
    expect(Object.keys(stored)).toEqual([ids[1]])
    await cache.dispose()
    await expect(cache.put(image)).rejects.toThrow(/关闭/)
  })
})
