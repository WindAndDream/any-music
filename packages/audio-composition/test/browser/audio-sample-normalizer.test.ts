import { AudioSample, AudioSampleSource, BufferTarget, Output, WavOutputFormat } from 'mediabunny'
import { describe, expect, it } from 'vitest'

import {
  AudioSampleNormalizer,
  EXPORT_AUDIO_CHANNEL_COUNT,
  EXPORT_AUDIO_SAMPLE_RATE,
} from '../../src/browser/audio-sample-normalizer'

describe('AudioSampleNormalizer', () => {
  it('normalizes sequential 44.1 kHz and 48 kHz segments to one constant output format', async () => {
    const outputSamples: Array<{
      channelCount: number
      frameCount: number
      sampleRate: number
      timestamp: number
    }> = []
    const collect = async (sample: AudioSample) => {
      outputSamples.push({
        channelCount: sample.numberOfChannels,
        frameCount: sample.numberOfFrames,
        sampleRate: sample.sampleRate,
        timestamp: sample.timestamp,
      })
    }

    const first = new AudioSampleNormalizer({ outputTimestampSeconds: 0, onSample: collect })
    const firstInput = createStereoSample(44_100, 441)
    await first.add(firstInput)
    firstInput.close()
    await first.finalize()

    const second = new AudioSampleNormalizer({
      outputTimestampSeconds: first.outputDurationSeconds,
      onSample: collect,
    })
    const secondInput = createStereoSample(48_000, 480)
    await second.add(secondInput)
    secondInput.close()
    await second.finalize()

    expect(
      outputSamples.every((sample) => sample.channelCount === EXPORT_AUDIO_CHANNEL_COUNT),
    ).toBe(true)
    expect(outputSamples.every((sample) => sample.sampleRate === EXPORT_AUDIO_SAMPLE_RATE)).toBe(
      true,
    )
    expect(outputSamples.reduce((total, sample) => total + sample.frameCount, 0)).toBe(960)
    expect(first.outputDurationSeconds).toBeCloseTo(0.01)
    expect(second.outputDurationSeconds).toBeCloseTo(0.01)
    expect(outputSamples.toSorted((left, right) => left.timestamp - right.timestamp)).toEqual(
      outputSamples,
    )
  })

  it('writes mixed source rates into one Mediabunny output track without parameter changes', async () => {
    const target = new BufferTarget()
    const output = new Output({ format: new WavOutputFormat(), target })
    const source = new AudioSampleSource({ codec: 'pcm-s16' })
    output.addAudioTrack(source)
    await output.start()

    let outputTimestampSeconds = 0
    const appendSource = async (sampleRate: number, frameCount: number) => {
      const normalizer = new AudioSampleNormalizer({
        outputTimestampSeconds,
        onSample: (sample) => source.add(sample),
      })
      const input = createStereoSample(sampleRate, frameCount)
      await normalizer.add(input)
      input.close()
      await normalizer.finalize()
      outputTimestampSeconds += normalizer.outputDurationSeconds
    }
    await appendSource(44_100, 441)
    await appendSource(48_000, 480)

    source.close()
    await output.finalize()
    expect(target.buffer?.byteLength).toBeGreaterThan(44)
  })
})

function createStereoSample(sampleRate: number, frameCount: number): AudioSample {
  const data = new Float32Array(frameCount * 2)
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    data[frameIndex * 2] = Math.sin(frameIndex / 10) * 0.5
    data[frameIndex * 2 + 1] = Math.cos(frameIndex / 10) * 0.5
  }
  return new AudioSample({
    data,
    format: 'f32',
    numberOfChannels: 2,
    sampleRate,
    timestamp: 0,
  })
}
