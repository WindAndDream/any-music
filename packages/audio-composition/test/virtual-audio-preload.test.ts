import { describe, expect, it } from 'vitest'

import { createVirtualPlaybackChunks } from '../src/index'
import { preloadVirtualAudioChunks } from '../src/virtual-audio-preload'

describe('virtual audio preload', () => {
  it('stops claiming work when another worker fails', async () => {
    const chunks = createVirtualPlaybackChunks([
      { sourceTrackId: 'asset', startMs: 0, endMs: 16000, virtualStartMs: 0, virtualEndMs: 16000 },
    ])
    const gate = createDeferred()
    const started: string[] = []
    const pending = preloadVirtualAudioChunks(chunks, {
      concurrency: 2,
      shouldContinue: () => true,
      loadChunk: async (chunk) => {
        started.push(chunk.key)
        if (chunk === chunks[0]) throw new Error('decode failed')
        await gate.promise
      },
    })
    await expect(pending).rejects.toThrow('decode failed')
    gate.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(chunks.slice(0, 2).map((chunk) => chunk.key))
  })

  it('fills three workers immediately and keeps one-second fragments loading concurrently', async () => {
    const chunks = createVirtualPlaybackChunks(
      Array.from({ length: 6 }, (_, index) => ({
        sourceTrackId: `track-${index}`,
        startMs: 0,
        endMs: 1_000,
        virtualStartMs: index * 1_000,
        virtualEndMs: (index + 1) * 1_000,
      })),
    )
    const gates = chunks.map(() => createDeferred())
    const startedKeys: string[] = []

    const pending = preloadVirtualAudioChunks(chunks, {
      concurrency: 3,
      shouldContinue: () => true,
      loadChunk: async (chunk) => {
        const index = chunks.indexOf(chunk)
        startedKeys.push(chunk.key)
        await gates[index]!.promise
      },
    })
    await Promise.resolve()

    expect(startedKeys).toEqual(chunks.slice(0, 3).map(({ key }) => key))

    gates[0]!.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(startedKeys).toEqual(chunks.slice(0, 4).map(({ key }) => key))

    for (const gate of gates) gate.resolve()
    await pending
    expect(startedKeys).toEqual(chunks.map(({ key }) => key))
  })

  it('does not claim another fragment after the playback session is cancelled', async () => {
    const chunks = createVirtualPlaybackChunks([
      {
        sourceTrackId: 'track-a',
        startMs: 0,
        endMs: 4_000,
        virtualStartMs: 0,
        virtualEndMs: 4_000,
      },
      {
        sourceTrackId: 'track-b',
        startMs: 0,
        endMs: 4_000,
        virtualStartMs: 4_000,
        virtualEndMs: 8_000,
      },
    ])
    const gate = createDeferred()
    let isActive = true
    const startedKeys: string[] = []
    const pending = preloadVirtualAudioChunks(chunks, {
      concurrency: 1,
      shouldContinue: () => isActive,
      loadChunk: async (chunk) => {
        startedKeys.push(chunk.key)
        await gate.promise
      },
    })
    await Promise.resolve()

    isActive = false
    gate.resolve()
    await pending

    expect(startedKeys).toEqual([chunks[0]!.key])
  })
})

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
