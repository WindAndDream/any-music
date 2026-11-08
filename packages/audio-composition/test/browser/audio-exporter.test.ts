import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  Output,
  WavOutputFormat,
  canEncodeAudio,
} from 'mediabunny'
import { describe, expect, it, vi } from 'vitest'

import { exportAudioSegments } from '../../src/browser/index'

vi.mock('mediabunny', async (importOriginal) => ({
  ...(await importOriginal<typeof import('mediabunny')>()),
  canEncodeAudio: vi.fn(),
}))

/** Small PCM fixtures exercise the actual decoder, resampler and encoder without opening an app. */
async function createWav(sampleRate: number): Promise<Uint8Array> {
  const target = new BufferTarget()
  const output = new Output({ format: new WavOutputFormat(), target })
  const source = new AudioSampleSource({ codec: 'pcm-s16' })
  output.addAudioTrack(source)
  await output.start()
  const sample = new AudioSample({
    data: new Float32Array(sampleRate / 10).fill(0.25),
    format: 'f32',
    numberOfChannels: 1,
    sampleRate,
    timestamp: 0,
  })
  try {
    await source.add(sample)
  } finally {
    sample.close()
  }
  source.close()
  await output.finalize()
  return new Uint8Array(target.buffer!)
}

describe('browser composition engine', () => {
  it('encodes mixed-rate clips in order and loads a reused asset only once', async () => {
    const first = await createWav(44100)
    const second = await createWav(48000)
    const loadSource = vi.fn(async (id: string) => ({ bytes: id === 'voice' ? first : second }))
    const file = await exportAudioSegments({
      title: 'Independent composition',
      format: 'wav',
      segments: [
        { sourceTrackId: 'voice', startMs: 0, endMs: 50 },
        { sourceTrackId: 'effect', startMs: 0, endMs: 50 },
        { sourceTrackId: 'voice', startMs: 50, endMs: 100 },
      ],
      loadSource,
    })
    expect(loadSource.mock.calls.map(([id]) => id)).toEqual(['voice', 'effect'])
    expect(file.blob.type).toBe('audio/wav')
    expect(file.blob.size).toBeGreaterThan(48000 * 0.15 * 2 * 2)
  })

  it('rejects invalid and cancelled requests before loading media', async () => {
    const loadSource = vi.fn()
    const options = {
      title: 'cancelled',
      format: 'wav' as const,
      segments: [{ sourceTrackId: 'voice', startMs: 0, endMs: 10 }],
      loadSource,
    }
    await expect(
      exportAudioSegments({ ...options, signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ code: 'operation-cancelled' })
    await expect(
      exportAudioSegments({
        ...options,
        segments: [{ sourceTrackId: 'voice', startMs: 10, endMs: 0 }],
      }),
    ).rejects.toMatchObject({ code: 'invalid-range' })
    expect(loadSource).not.toHaveBeenCalled()
  })

  it('retries encoder capability initialization after a failure', async () => {
    vi.mocked(canEncodeAudio)
      .mockRejectedValueOnce(new Error('first probe'))
      .mockRejectedValueOnce(new Error('second probe'))
    const options = {
      title: 'retry',
      format: 'mp3' as const,
      segments: [{ sourceTrackId: 'voice', startMs: 0, endMs: 10 }],
      loadSource: vi.fn(),
    }
    await expect(exportAudioSegments(options)).rejects.toThrow('first probe')
    await expect(exportAudioSegments(options)).rejects.toThrow('second probe')
    expect(canEncodeAudio).toHaveBeenCalledTimes(2)
    expect(options.loadSource).not.toHaveBeenCalled()
  })
})
