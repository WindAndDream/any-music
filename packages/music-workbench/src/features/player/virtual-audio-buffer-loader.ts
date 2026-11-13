import type { VirtualPlaybackChunk } from '@any-music/audio-composition'
import { AppError, normalizeAppError } from '@any-music/core'
import type { ResolvedMediaSource, Track } from '@any-music/core'
import { ALL_FORMATS, AudioSampleSink, Input } from 'mediabunny'
import type { InputAudioTrack } from 'mediabunny'

import { createRangeMediaSource } from '../../media/range-media-source'

export interface VirtualAudioBufferLoaderOptions {
  audioContext: AudioContext
  resolveTrack: (trackId: string) => Track | undefined
  resolveMedia: (track: Track) => Promise<ResolvedMediaSource>
  canPrefetchMedia: (track: Track) => boolean
}

interface DecodableTrack {
  input: Input
  audioTrack: InputAudioTrack
}

/** 让播放器能把加载错误稳定映射回具体叶子素材。 */
export class VirtualAudioBufferError extends AppError {
  readonly sourceTrackId: string

  constructor(sourceTrackId: string, message: string, options?: ErrorOptions) {
    super('media-decode-failed', message, options)
    this.name = 'VirtualAudioBufferError'
    this.sourceTrackId = sourceTrackId
  }
}

/**
 * 按块解析和解码自定义歌曲的叶子媒体。输入源按稳定曲目 ID 复用，但解码后的 PCM 由上层
 * 滚动窗口管理；dispose 会立即释放所有解封装器及其临时 Range 缓存。
 */
export class VirtualAudioBufferLoader {
  private readonly options: VirtualAudioBufferLoaderOptions
  private readonly decodableTracks = new Map<string, Promise<DecodableTrack>>()
  private readonly controller = new AbortController()
  private readonly resolvedSources = new Set<ResolvedMediaSource>()

  constructor(options: VirtualAudioBufferLoaderOptions) {
    this.options = options
  }

  async load(chunk: VirtualPlaybackChunk): Promise<AudioBuffer> {
    this.throwIfDisposed()
    const track = this.options.resolveTrack(chunk.sourceTrackId)
    if (!track || track.source.mediaKind === 'custom') {
      throw new VirtualAudioBufferError(
        chunk.sourceTrackId,
        `找不到自定义歌曲的叶子素材：${chunk.sourceTrackId}`,
      )
    }

    try {
      const decodable = await this.getDecodableTrack(track)
      return await this.decodeChunk(decodable.audioTrack, chunk)
    } catch (error) {
      throw new VirtualAudioBufferError(
        chunk.sourceTrackId,
        `无法预解析素材“${track.title}”的目标片段。`,
        { cause: error },
      )
    }
  }

  dispose(): void {
    this.controller.abort()
    for (const pending of this.decodableTracks.values()) {
      void pending.then(({ input }) => input.dispose()).catch(() => undefined)
    }
    this.decodableTracks.clear()
    for (const source of this.resolvedSources) source.release?.()
    this.resolvedSources.clear()
  }

  private getDecodableTrack(track: Track): Promise<DecodableTrack> {
    const cached = this.decodableTracks.get(track.id)
    if (cached) return cached
    const pending = this.createDecodableTrack(track)
    this.decodableTracks.set(track.id, pending)
    void pending.catch(() => this.decodableTracks.delete(track.id))
    return pending
  }

  private async createDecodableTrack(track: Track): Promise<DecodableTrack> {
    this.throwIfDisposed()
    if (!this.options.canPrefetchMedia(track)) {
      throw new AppError(
        'unsupported-operation',
        `素材“${track.title}”需要完整读取媒体，不能参与后台播放预取。`,
      )
    }
    const resolved = await this.options.resolveMedia(track)
    if (this.controller.signal.aborted) {
      resolved.release?.()
      this.throwIfDisposed()
    }
    this.resolvedSources.add(resolved)
    this.throwIfDisposed()
    if (resolved.type === 'complete-binary') {
      this.resolvedSources.delete(resolved)
      resolved.release?.()
      // 来源能力判断是轻量前置保护；这里再防守一次不符合声明的插件实现。
      throw new AppError(
        'unsupported-operation',
        `素材“${track.title}”返回了完整媒体，已停止后台播放预取。`,
      )
    }

    const errors: string[] = []
    for (const url of [resolved.url, ...resolved.backupUrls]) {
      this.throwIfDisposed()
      const source = createRangeMediaSource(track, resolved, url, {
        signal: this.controller.signal,
      })
      try {
        // 备用节点必须串行验证；同时探测多个 CDN 会制造无意义的 Range 流量。
        // eslint-disable-next-line no-await-in-loop
        return await this.openInput(track, source)
      } catch (error) {
        // openInput 失败时会 dispose Input，并由 Mediabunny 的引用计数释放对应 Source。
        errors.push(normalizeAppError(error, 'media-decode-failed', '未知媒体解析错误').message)
      }
    }
    this.resolvedSources.delete(resolved)
    resolved.release?.()
    throw new AppError(
      'media-format-unsupported',
      `所有媒体节点均不支持范围解码：${errors.join('；')}`,
    )
  }

  private async openInput(
    track: Track,
    source: ReturnType<typeof createRangeMediaSource>,
  ): Promise<DecodableTrack> {
    const input = new Input({ source, formats: ALL_FORMATS })
    try {
      if (!(await input.canRead())) {
        throw new AppError('media-format-unsupported', `不支持素材“${track.title}”的媒体封装格式。`)
      }
      const audioTrack = await input.getPrimaryAudioTrack()
      if (!audioTrack) {
        throw new AppError('media-format-unsupported', `素材“${track.title}”不包含音轨。`)
      }
      if (!(await audioTrack.canDecode())) {
        throw new AppError(
          'media-format-unsupported',
          `当前浏览器不能解码素材“${track.title}”的音频编码。`,
        )
      }
      return { input, audioTrack }
    } catch (error) {
      input.dispose()
      throw error
    }
  }

  private async decodeChunk(
    audioTrack: InputAudioTrack,
    chunk: VirtualPlaybackChunk,
  ): Promise<AudioBuffer> {
    const startSeconds = chunk.startMs / 1000
    const endSeconds = chunk.endMs / 1000
    const sink = new AudioSampleSink(audioTrack)
    let output: AudioBuffer | undefined
    let copiedFrameCount = 0

    for await (const sample of sink.samples(startSeconds, endSeconds)) {
      try {
        const overlapStart = Math.max(startSeconds, sample.timestamp)
        const overlapEnd = Math.min(endSeconds, sample.timestamp + sample.duration)
        if (overlapEnd <= overlapStart) continue

        output ??= this.options.audioContext.createBuffer(
          sample.numberOfChannels,
          Math.max(1, Math.round((endSeconds - startSeconds) * sample.sampleRate)),
          sample.sampleRate,
        )
        if (
          sample.sampleRate !== output.sampleRate ||
          sample.numberOfChannels !== output.numberOfChannels
        ) {
          throw new AppError('media-decode-failed', '同一解码块内的采样率或声道数发生变化。')
        }

        const sourceFrameOffset = clampFrame(
          Math.round((overlapStart - sample.timestamp) * sample.sampleRate),
          sample.numberOfFrames,
        )
        const targetFrameOffset = clampFrame(
          Math.round((overlapStart - startSeconds) * output.sampleRate),
          output.length,
        )
        const frameCount = Math.min(
          sample.numberOfFrames - sourceFrameOffset,
          output.length - targetFrameOffset,
          Math.max(0, Math.round((overlapEnd - overlapStart) * output.sampleRate)),
        )
        if (frameCount <= 0) continue

        for (let channelIndex = 0; channelIndex < output.numberOfChannels; channelIndex += 1) {
          const channelData = new Float32Array(frameCount)
          sample.copyTo(channelData, {
            planeIndex: channelIndex,
            format: 'f32-planar',
            frameOffset: sourceFrameOffset,
            frameCount,
          })
          output.copyToChannel(channelData, channelIndex, targetFrameOffset)
        }
        copiedFrameCount += frameCount
      } finally {
        sample.close()
      }
    }

    if (!output || copiedFrameCount === 0) {
      throw new AppError(
        'media-decode-failed',
        `片段 ${chunk.sourceTrackId} 没有可解码的音频样本。`,
      )
    }
    return output
  }

  private throwIfDisposed(): void {
    if (!this.controller.signal.aborted) return
    throw new AppError('operation-cancelled', '音频缓冲已由用户中止。')
  }
}

function clampFrame(frame: number, frameCount: number): number {
  return Math.min(frameCount, Math.max(0, frame))
}
