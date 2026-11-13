import { AudioSample } from 'mediabunny'

import { AudioCompositionError } from './audio-composition-error'

export const EXPORT_AUDIO_CHANNEL_COUNT = 2
export const EXPORT_AUDIO_SAMPLE_RATE = 48_000

const OUTPUT_CHUNK_FRAME_COUNT = 16_384

export interface AudioSampleNormalizerOptions {
  outputTimestampSeconds: number
  onSample: (sample: AudioSample) => Promise<void>
}

/**
 * 把单个片段的解码样本流式重采样为固定双声道 48 kHz。
 *
 * Mediabunny 的 AudioSampleSource 会在其内置 transform 之前校验输入参数恒定，因此跨来源
 * 拼接必须先完成标准化。这里只保留尚待插值的尾帧，内存占用与解码块大小相关而非成品时长。
 */
export class AudioSampleNormalizer {
  private readonly outputTimestampSeconds: number
  private readonly onSample: (sample: AudioSample) => Promise<void>

  private sourceSampleRate?: number
  private sourceChannelCount?: number
  private sourceBuffer = new Float32Array(0)
  private sourceBufferStartFrame = 0
  private totalSourceFrameCount = 0
  private nextOutputFrame = 0

  constructor(options: AudioSampleNormalizerOptions) {
    this.outputTimestampSeconds = options.outputTimestampSeconds
    this.onSample = options.onSample
  }

  get outputDurationSeconds(): number {
    return this.nextOutputFrame / EXPORT_AUDIO_SAMPLE_RATE
  }

  async add(sample: AudioSample): Promise<void> {
    this.initializeSourceParameters(sample)
    const channelCount = this.sourceChannelCount!
    const data = new Float32Array(sample.numberOfFrames * channelCount)
    sample.copyTo(data, { planeIndex: 0, format: 'f32' })

    const combined = new Float32Array(this.sourceBuffer.length + data.length)
    combined.set(this.sourceBuffer)
    combined.set(data, this.sourceBuffer.length)
    this.sourceBuffer = combined
    this.totalSourceFrameCount += sample.numberOfFrames

    await this.emitAvailableSamples(false)
  }

  async finalize(): Promise<void> {
    if (this.sourceSampleRate === undefined) return
    await this.emitAvailableSamples(true)
    this.sourceBuffer = new Float32Array(0)
  }

  private initializeSourceParameters(sample: AudioSample): void {
    if (this.sourceSampleRate === undefined || this.sourceChannelCount === undefined) {
      this.sourceSampleRate = sample.sampleRate
      this.sourceChannelCount = sample.numberOfChannels
      return
    }
    if (
      sample.sampleRate !== this.sourceSampleRate ||
      sample.numberOfChannels !== this.sourceChannelCount
    ) {
      throw new AudioCompositionError(
        'media-decode-failed',
        `同一素材片段的音频参数发生变化：预期 ${this.sourceChannelCount} 声道 ${this.sourceSampleRate} Hz，实际 ${sample.numberOfChannels} 声道 ${sample.sampleRate} Hz。`,
      )
    }
  }

  private async emitAvailableSamples(isFinal: boolean): Promise<void> {
    const sourceSampleRate = this.sourceSampleRate!
    const targetFrameLimit = isFinal
      ? Math.round((this.totalSourceFrameCount * EXPORT_AUDIO_SAMPLE_RATE) / sourceSampleRate)
      : Math.ceil(
          (Math.max(0, this.totalSourceFrameCount - 1) * EXPORT_AUDIO_SAMPLE_RATE) /
            sourceSampleRate,
        )

    while (this.nextOutputFrame < targetFrameLimit) {
      const frameCount = Math.min(OUTPUT_CHUNK_FRAME_COUNT, targetFrameLimit - this.nextOutputFrame)
      const outputStartFrame = this.nextOutputFrame
      const data = new Float32Array(frameCount * EXPORT_AUDIO_CHANNEL_COUNT)
      for (let frameOffset = 0; frameOffset < frameCount; frameOffset += 1) {
        const sourcePosition =
          ((outputStartFrame + frameOffset) * sourceSampleRate) / EXPORT_AUDIO_SAMPLE_RATE
        const lowerFrame = Math.floor(sourcePosition)
        const upperFrame = Math.min(this.totalSourceFrameCount - 1, lowerFrame + 1)
        const fraction = sourcePosition - lowerFrame
        for (let channelIndex = 0; channelIndex < EXPORT_AUDIO_CHANNEL_COUNT; channelIndex += 1) {
          const lowerValue = this.readMixedSample(lowerFrame, channelIndex)
          const upperValue = this.readMixedSample(upperFrame, channelIndex)
          data[frameOffset * EXPORT_AUDIO_CHANNEL_COUNT + channelIndex] =
            lowerValue + fraction * (upperValue - lowerValue)
        }
      }

      const normalized = new AudioSample({
        data,
        format: 'f32',
        numberOfChannels: EXPORT_AUDIO_CHANNEL_COUNT,
        sampleRate: EXPORT_AUDIO_SAMPLE_RATE,
        timestamp: this.outputTimestampSeconds + outputStartFrame / EXPORT_AUDIO_SAMPLE_RATE,
      })
      try {
        // 编码轨必须按时间戳顺序写入并遵守背压，并行提交会重排拼接音频。
        // eslint-disable-next-line no-await-in-loop
        await this.onSample(normalized)
      } finally {
        normalized.close()
      }
      this.nextOutputFrame += frameCount
      this.discardConsumedSourceFrames()
    }
  }

  private readMixedSample(frameIndex: number, targetChannelIndex: number): number {
    const channelCount = this.sourceChannelCount!
    const localFrameIndex = frameIndex - this.sourceBufferStartFrame
    const readChannel = (channelIndex: number) =>
      this.sourceBuffer[localFrameIndex * channelCount + channelIndex] ?? 0

    if (channelCount === 1) return readChannel(0)
    if (channelCount === 2) return readChannel(targetChannelIndex)
    if (channelCount === 4) {
      return 0.5 * (readChannel(targetChannelIndex) + readChannel(targetChannelIndex + 2))
    }
    if (channelCount >= 6) {
      return (
        readChannel(targetChannelIndex) +
        Math.SQRT1_2 * (readChannel(2) + readChannel(targetChannelIndex + 4))
      )
    }
    return readChannel(Math.min(targetChannelIndex, channelCount - 1))
  }

  private discardConsumedSourceFrames(): void {
    const sourceSampleRate = this.sourceSampleRate!
    const nextRequiredFrame = Math.min(
      this.totalSourceFrameCount,
      Math.floor((this.nextOutputFrame * sourceSampleRate) / EXPORT_AUDIO_SAMPLE_RATE),
    )
    const discardFrameCount = nextRequiredFrame - this.sourceBufferStartFrame
    if (discardFrameCount <= 0) return
    this.sourceBuffer = this.sourceBuffer.slice(discardFrameCount * this.sourceChannelCount!)
    this.sourceBufferStartFrame = nextRequiredFrame
  }
}
