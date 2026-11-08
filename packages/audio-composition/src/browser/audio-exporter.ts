import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BufferSource as MediaBufferSource,
  BufferTarget,
  canEncodeAudio,
  Input,
  Mp3OutputFormat,
  Output,
  Quality,
  WavOutputFormat,
} from 'mediabunny'

import type { AudioExportFormat, SegmentRecipe } from '../models'
import { AudioCompositionError } from './audio-composition-error'
import { AudioSampleNormalizer } from './audio-sample-normalizer'

export type { AudioExportFormat } from '../models'

export interface AudioExportProgress {
  completedSegmentCount: number
  totalSegmentCount: number
  message: string
}

export interface ExportAudioOptions {
  title: string
  creatorName?: string
  segments: readonly SegmentRecipe[]
  format: AudioExportFormat
  /** Resolve bytes only when a segment is consumed; the caller owns network and source identity. */
  loadSource: (
    sourceTrackId: string,
    options: { signal?: AbortSignal },
  ) => Promise<{ bytes: Uint8Array }>
  onProgress?: (progress: AudioExportProgress) => void
  signal?: AbortSignal
}

export interface ExportedAudioFile {
  blob: Blob
  extension: AudioExportFormat
}

interface DecodableTrack {
  input: Input
  sink: AudioSampleSink
}

let mp3EncoderRegistration: Promise<void> | undefined

/**
 * 将已经扁平化的叶子片段顺序解码、精确裁边并编码为统一格式。
 * 每个来源媒体在一次导出中只解析和下载一次，样本逐块写入以避免创建整首 PCM 副本。
 */
export async function exportAudioSegments(options: ExportAudioOptions): Promise<ExportedAudioFile> {
  throwIfExportCancelled(options.signal)
  if (options.segments.length === 0) {
    throw new AudioCompositionError('export-unavailable', '没有可导出的音频片段。')
  }
  // Independent consumers need the same bounds guarantee as the recipe compiler.
  for (const segment of options.segments) {
    if (
      !segment.sourceTrackId ||
      !Number.isSafeInteger(segment.startMs) ||
      !Number.isSafeInteger(segment.endMs) ||
      segment.startMs < 0 ||
      segment.endMs <= segment.startMs
    ) {
      throw new AudioCompositionError('invalid-range', '音频片段必须使用有效的毫秒区间。')
    }
  }
  if (options.format === 'mp3') await ensureMp3Encoder()
  throwIfExportCancelled(options.signal)

  const target = new BufferTarget()
  const outputFormat = options.format === 'mp3' ? new Mp3OutputFormat() : new WavOutputFormat()
  const output = new Output({ format: outputFormat, target })
  const audioSource = new AudioSampleSource(
    options.format === 'mp3'
      ? {
          codec: 'mp3',
          quality: new Quality({ bitrate: 192_000 }),
        }
      : {
          codec: 'pcm-s16',
        },
  )
  output.addAudioTrack(audioSource)
  output.setMetadataTags({ title: options.title, artist: options.creatorName })

  const decodableTracks = new Map<string, Promise<DecodableTrack>>()
  let outputTimestampSeconds = 0
  try {
    await output.start()
    for (const [segmentIndex, segment] of options.segments.entries()) {
      throwIfExportCancelled(options.signal)
      // 时间线编码必须保持顺序，且逐段等待编码器背压，不能并行写同一输出轨。
      // eslint-disable-next-line no-await-in-loop
      const decodable = await getDecodableTrack(segment.sourceTrackId, options, decodableTracks)
      // eslint-disable-next-line no-await-in-loop
      outputTimestampSeconds = await appendSegmentSamples(
        decodable.sink,
        audioSource,
        segment,
        outputTimestampSeconds,
        options.signal,
      )
      options.onProgress?.({
        completedSegmentCount: segmentIndex + 1,
        totalSegmentCount: options.segments.length,
        message: `已处理 ${segmentIndex + 1} / ${options.segments.length} 个叶子片段`,
      })
    }
    throwIfExportCancelled(options.signal)
    audioSource.close()
    await output.finalize()
    throwIfExportCancelled(options.signal)
  } catch (error) {
    if (output.state === 'started') await output.cancel().catch(() => undefined)
    throw error
  } finally {
    for (const decodable of decodableTracks.values()) {
      void decodable.then(({ input }) => input.dispose()).catch(() => undefined)
    }
  }

  if (!target.buffer)
    throw new AudioCompositionError('export-failed', '音频编码器没有生成输出数据。')
  const mimeType = options.format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
  return { blob: new Blob([target.buffer], { type: mimeType }), extension: options.format }
}

async function ensureMp3Encoder(): Promise<void> {
  // 批量下载会并发进入此函数；共享 Promise 保证扩展注册只执行一次。
  mp3EncoderRegistration ??= registerMp3EncoderOnce().catch((error: unknown) => {
    // A transient capability/worker failure must not poison every later export.
    mp3EncoderRegistration = undefined
    throw error
  })
  await mp3EncoderRegistration
}

async function registerMp3EncoderOnce(): Promise<void> {
  if (await canEncodeAudio('mp3')) return
  // 官方扩展把 LAME WASM 与 worker 打进同一包，无需 CDN 或外部 wasm 路径。
  registerMp3Encoder()
}

function getDecodableTrack(
  sourceTrackId: string,
  options: ExportAudioOptions,
  cache: Map<string, Promise<DecodableTrack>>,
): Promise<DecodableTrack> {
  const cached = cache.get(sourceTrackId)
  if (cached) return cached
  const pending = createDecodableTrack(sourceTrackId, options)
  cache.set(sourceTrackId, pending)
  void pending.catch(() => cache.delete(sourceTrackId))
  return pending
}

async function createDecodableTrack(
  sourceTrackId: string,
  options: ExportAudioOptions,
): Promise<DecodableTrack> {
  options.onProgress?.({
    completedSegmentCount: 0,
    totalSegmentCount: options.segments.length,
    message: `正在解析素材：${sourceTrackId}`,
  })
  const file = await options.loadSource(sourceTrackId, { signal: options.signal })
  throwIfExportCancelled(options.signal)
  const input = new Input({ source: new MediaBufferSource(file.bytes), formats: ALL_FORMATS })
  try {
    if (!(await input.canRead())) {
      throw new AudioCompositionError(
        'media-format-unsupported',
        `不支持素材“${sourceTrackId}”的媒体封装格式。`,
      )
    }
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack)
      throw new AudioCompositionError(
        'media-format-unsupported',
        `素材“${sourceTrackId}”不包含音轨。`,
      )
    if (!(await audioTrack.canDecode())) {
      throw new AudioCompositionError(
        'media-format-unsupported',
        `当前浏览器不能解码素材“${sourceTrackId}”的音频编码。`,
      )
    }
    return { input, sink: new AudioSampleSink(audioTrack) }
  } catch (error) {
    input.dispose()
    throw error
  }
}

async function appendSegmentSamples(
  sink: AudioSampleSink,
  output: AudioSampleSource,
  segment: SegmentRecipe,
  outputTimestampSeconds: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  const startSeconds = segment.startMs / 1000
  const endSeconds = segment.endMs / 1000
  let appendedSampleCount = 0
  const normalizer = new AudioSampleNormalizer({
    outputTimestampSeconds,
    onSample: (sample) => output.add(sample),
  })

  for await (const sample of sink.samples(startSeconds, endSeconds)) {
    if (signal?.aborted) {
      sample.close()
      throwIfExportCancelled(signal)
    }
    const overlapStart = Math.max(startSeconds, sample.timestamp)
    const overlapEnd = Math.min(endSeconds, sample.timestamp + sample.duration)
    if (overlapEnd <= overlapStart) {
      sample.close()
      continue
    }

    const startFrame = clampFrame(
      Math.round((overlapStart - sample.timestamp) * sample.sampleRate),
      sample.numberOfFrames,
    )
    const endFrame = clampFrame(
      Math.round((overlapEnd - sample.timestamp) * sample.sampleRate),
      sample.numberOfFrames,
    )
    if (endFrame <= startFrame) {
      sample.close()
      continue
    }

    const trimmed = sample.trim(startFrame, endFrame)
    sample.close()
    try {
      // Mediabunny 在内置 transform 之前要求输入参数恒定，必须先统一不同来源的采样率与声道。
      await normalizer.add(trimmed)
      appendedSampleCount += 1
    } finally {
      trimmed.close()
    }
  }

  if (appendedSampleCount === 0) {
    throw new AudioCompositionError(
      'media-decode-failed',
      `片段 ${segment.sourceTrackId} 没有可解码的音频样本。`,
    )
  }
  await normalizer.finalize()
  throwIfExportCancelled(signal)
  return outputTimestampSeconds + normalizer.outputDurationSeconds
}

function throwIfExportCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new AudioCompositionError('operation-cancelled', '下载已由用户中止。')
}

function clampFrame(frame: number, frameCount: number): number {
  return Math.min(frameCount, Math.max(0, frame))
}
