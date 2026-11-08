import { describe, expect, it, vi } from 'vitest'

import {
  MAX_DOWNLOAD_RETRY_COUNT,
  normalizeDownloadConcurrency,
  runConcurrentDownloads,
} from '../../src'

describe('runConcurrentDownloads', () => {
  it('respects the shared concurrency limit and preserves input order', async () => {
    let activeCount = 0
    let peakActiveCount = 0
    const releases: Array<() => void> = []
    const pending = runConcurrentDownloads([1, 2, 3, 4], {
      concurrency: 2,
      maxRetryCount: 0,
      download: async (item) => {
        activeCount += 1
        peakActiveCount = Math.max(peakActiveCount, activeCount)
        await new Promise<void>((resolve) => releases.push(resolve))
        activeCount -= 1
        return item * 10
      },
    })

    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases.splice(0, 2).forEach((release) => release())
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases.splice(0, 2).forEach((release) => release())

    const results = await pending
    expect(peakActiveCount).toBe(2)
    expect(results.map((result) => result.item)).toEqual([1, 2, 3, 4])
    expect(results.map((result) => result.status)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ])
  })

  it('retries one failed song three times without blocking other songs', async () => {
    const attempts = new Map<string, number>()
    const failures: Array<{ item: string; willRetry: boolean }> = []
    const results = await runConcurrentDownloads(['broken', 'healthy'], {
      concurrency: 2,
      download: async (item) => {
        attempts.set(item, (attempts.get(item) ?? 0) + 1)
        if (item === 'broken') throw new Error('network')
        return 'saved'
      },
      onAttemptFailure: ({ item, willRetry }) => failures.push({ item, willRetry }),
    })

    expect(attempts.get('broken')).toBe(MAX_DOWNLOAD_RETRY_COUNT + 1)
    expect(attempts.get('healthy')).toBe(1)
    expect(failures).toEqual([
      { item: 'broken', willRetry: true },
      { item: 'broken', willRetry: true },
      { item: 'broken', willRetry: true },
      { item: 'broken', willRetry: false },
    ])
    expect(results[0]?.status).toBe('failed')
    expect(results[1]?.status).toBe('succeeded')
  })

  it('cancels active work without retrying and marks work that has not started', async () => {
    let cancelled = false
    let hasStarted = false
    let releaseActiveDownload!: () => void
    const cancelledItems: number[] = []
    const pending = runConcurrentDownloads([1, 2, 3], {
      concurrency: 1,
      download: async () => {
        hasStarted = true
        await new Promise<void>((resolve) => {
          releaseActiveDownload = resolve
        })
        throw new Error('transport aborted')
      },
      isCancelled: () => cancelled,
      onTaskCancelled: ({ item }) => cancelledItems.push(item),
    })

    await vi.waitFor(() => expect(hasStarted).toBe(true))
    cancelled = true
    releaseActiveDownload()

    const results = await pending
    expect(results.map((result) => result.status)).toEqual(['cancelled', 'cancelled', 'cancelled'])
    expect(results.map((result) => result.attemptCount)).toEqual([1, 0, 0])
    expect(cancelledItems).toEqual([1, 2, 3])
  })

  it('cancels one task while allowing the remaining songs to finish', async () => {
    const results = await runConcurrentDownloads(['skip', 'keep'], {
      concurrency: 1,
      isTaskCancelled: (item) => item === 'skip',
      download: async (item) => `${item}-saved`,
    })

    expect(results).toMatchObject([
      { item: 'skip', status: 'cancelled', attemptCount: 0 },
      { item: 'keep', status: 'succeeded', value: 'keep-saved' },
    ])
  })
})

describe('normalizeDownloadConcurrency', () => {
  it('uses an integer value between one and five', () => {
    expect(normalizeDownloadConcurrency(undefined)).toBe(2)
    expect(normalizeDownloadConcurrency(0)).toBe(1)
    expect(normalizeDownloadConcurrency(3.9)).toBe(3)
    expect(normalizeDownloadConcurrency(99)).toBe(5)
  })
})
