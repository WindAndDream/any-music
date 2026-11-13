import { AppError } from '@any-music/core'
import type { RemoteResolvedMediaSource, Track } from '@any-music/core'
import {
  ALL_FORMATS,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Mp3OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny'
import type { EncodedPacket, InputAudioTrack, StreamTargetChunk } from 'mediabunny'

import { createRangeMediaSource } from '../../media/range-media-source'

const FRAGMENT_DURATION_SECONDS = 1
const MEDIA_NODE_HEDGE_DELAY_MS = 250
const NATIVE_AUDIO_STARTUP_TIMEOUT_MS = 5_000
const MAX_BUFFER_AHEAD_SECONDS = 30
const MAX_BUFFER_BEHIND_SECONDS = 15
const BUFFER_BACKPRESSURE_POLL_MS = 250

interface OpenedAudioInput {
  input: Input
  audioTrack: InputAudioTrack
  firstPacket: EncodedPacket
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

export interface NativeCompatibleAudioFile {
  bytes: Uint8Array
  mimeType: string
}

export interface NativeCompatibleAudioFileOptions {
  signal?: AbortSignal
}

export interface NativeCompatibleAudioSessionOptions {
  getPlaybackPositionSeconds?: () => number
  startTimeSeconds?: number
}

/** 所有候选节点都无法建立 Range 输入时，音轨文件回退会重复同一失败，应直接完整读取。 */
export class NativeAudioInputUnavailableError extends AppError {
  constructor(causes: readonly unknown[]) {
    super('media-range-invalid', '所有媒体节点均无法建立音频分段读取。', {
      cause: new AggregateError(causes),
    })
    this.name = 'NativeAudioInputUnavailableError'
  }
}

/** MSE 在交互预算内没有产出首个可播放碎片时，停止后台长等待并改走快速兜底。 */
export class NativeAudioStartupTimeoutError extends AppError {
  constructor() {
    super('request-timeout', '原生兼容音频流未能及时启动。')
    this.name = 'NativeAudioStartupTimeoutError'
  }
}

/** 播放器只按错误类别选择下一条兼容路径，不读取平台 URL 或底层异常文案。 */
export function isNativeAudioInputUnavailableError(
  error: unknown,
): error is NativeAudioInputUnavailableError {
  return error instanceof NativeAudioInputUnavailableError
}

/** Range 输入失败或首碎片超时都不应继续整段抽取，否则会把等待时间再次叠加。 */
export function shouldSkipNativeAudioExtraction(error: unknown): boolean {
  return (
    error instanceof NativeAudioInputUnavailableError ||
    error instanceof NativeAudioStartupTimeoutError
  )
}

/**
 * 将需要自定义请求头的远程媒体按 Range 解封装，并把其中的音轨重封装为 MSE 可消费的碎片 MP4。
 * 媒体元素仍掌管播放、暂停、倍速和拖动，因此兼容通道不会改变用户熟悉的原生控制条。
 */
export class NativeCompatibleAudioSession {
  readonly url: string

  private readonly track: Track
  private readonly source: RemoteResolvedMediaSource
  private readonly getPlaybackPositionSeconds: () => number
  private readonly startTimeSeconds: number
  private readonly mediaSource: MediaSource
  private readonly controller = new AbortController()
  private readonly ready = createDeferred<void>()
  private input?: Input
  private output?: Output
  private sourceBuffer?: SourceBuffer
  private runPromise?: Promise<void>
  private isReady = false
  private nextWritePosition = 0
  private terminalFailure?: unknown
  private isDisposed = false

  constructor(
    track: Track,
    source: RemoteResolvedMediaSource,
    options: NativeCompatibleAudioSessionOptions = {},
  ) {
    if (typeof MediaSource === 'undefined') {
      throw new AppError('media-format-unsupported', '当前浏览器不支持原生流式兼容播放。')
    }
    this.track = track
    this.source = source
    this.getPlaybackPositionSeconds = options.getPlaybackPositionSeconds ?? (() => 0)
    this.startTimeSeconds = normalizeStartTimeSeconds(options.startTimeSeconds)
    this.mediaSource = new MediaSource()
    this.url = URL.createObjectURL(this.mediaSource)
  }

  /** 在媒体元素挂载 object URL 后启动；解析到首个可播放碎片即解除加载态。 */
  start(): Promise<void> {
    if (!this.runPromise) {
      this.runPromise = this.run()
      void this.runPromise.catch((error: unknown) => {
        if (!this.isReady) this.ready.reject(error)
      })
      const timeoutId = globalThis.setTimeout(() => {
        if (this.isReady || this.controller.signal.aborted) return
        const failure = new NativeAudioStartupTimeoutError()
        this.terminalFailure = failure
        this.ready.reject(failure)
        // 启动预算用尽后立即停止节点读取；PlayerBar 会在同一轮事件中切换到完整媒体兜底。
        this.controller.abort()
        this.input?.dispose()
        void this.output?.cancel().catch(() => undefined)
      }, NATIVE_AUDIO_STARTUP_TIMEOUT_MS)
      const clearStartupTimeout = () => globalThis.clearTimeout(timeoutId)
      void this.ready.promise.then(clearStartupTimeout, clearStartupTimeout)
    }
    return this.ready.promise
  }

  /** 首个碎片可播放后，后台仍继续抽取音轨；这里用于监听后续网络或封装失败。 */
  whenComplete(): Promise<void> {
    void this.start()
    return this.runPromise!
  }

  /** 媒体元素先收到 MSE error 时，播放器可用这个脱敏错误类别决定是否跳过重复抽取。 */
  get failure(): unknown {
    return this.terminalFailure
  }

  /** 切歌、切音质或回退到另一通道时，同时停止解封装、Range 请求和 MSE 写入。 */
  dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    if (!this.controller.signal.aborted) this.controller.abort()
    this.input?.dispose()
    void this.output?.cancel().catch(() => undefined)
    try {
      if (this.sourceBuffer?.updating && this.mediaSource.readyState === 'open') {
        this.sourceBuffer.abort()
      }
    } catch {
      // SourceBuffer 可能已随媒体元素卸载；终止请求和释放 URL 已足够。
    }
    URL.revokeObjectURL(this.url)
  }

  private async run(): Promise<void> {
    try {
      const [opened] = await Promise.all([
        openAudioInput(this.track, this.source, this.controller.signal, this.startTimeSeconds),
        waitForMediaSourceOpen(this.mediaSource, this.controller.signal),
      ])
      this.throwIfAborted()
      this.input = opened.input

      const codec = await opened.audioTrack.getCodec()
      const decoderConfig = await opened.audioTrack.getDecoderConfig()
      if (!codec || !decoderConfig) {
        throw new AppError('media-format-unsupported', '远程音轨缺少浏览器播放所需的编码信息。')
      }
      const codecParameter =
        (await opened.audioTrack.getCodecParameterString()) ?? decoderConfig.codec

      const packetSource = new EncodedAudioPacketSource(codec)
      const isMp3 = codec === 'mp3'
      const output = new Output({
        format: isMp3
          ? new Mp3OutputFormat()
          : new Mp4OutputFormat({
              fastStart: 'fragmented',
              minimumFragmentDuration: FRAGMENT_DURATION_SECONDS,
            }),
        target: new StreamTarget(
          new WritableStream<StreamTargetChunk>({
            write: (chunk) => this.appendChunk(chunk),
          }),
        ),
      })
      output.addAudioTrack(packetSource, { decoderConfig })
      // EncodedAudioPacketSource 在首包前无法让 Output.getMimeType() 完成；这里直接使用输入轨的
      // 精确 codec parameter，打破“先建 SourceBuffer / 先写首包”之间的循环等待。
      const mimeType = isMp3 ? 'audio/mpeg' : createNativeAudioMimeType(codecParameter)
      if (!MediaSource.isTypeSupported(mimeType)) {
        throw new AppError(
          'media-format-unsupported',
          `当前浏览器不支持原生兼容音频编码：${mimeType}。`,
        )
      }

      this.output = output
      this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType)
      if (isMp3 && opened.firstPacket.timestamp > 0) {
        // MP3 字节流没有容器时间戳；从中途取包时用 SourceBuffer 偏移把新片段放回原时间轴。
        this.sourceBuffer.timestampOffset = opened.firstPacket.timestamp
      }
      const declaredDurationSeconds = readDeclaredDurationSeconds(this.track, this.source)
      if (declaredDurationSeconds !== undefined) {
        this.mediaSource.duration = declaredDurationSeconds
      }

      await output.start()
      const sink = new EncodedPacketSink(opened.audioTrack)
      const timestampOffsetSeconds = readPacketTimestampOffset(opened.firstPacket)
      let packetCount = 0
      let packetEndSeconds = 0
      for await (const packet of sink.packets(opened.firstPacket)) {
        this.throwIfAborted()
        const normalizedPacket = normalizeEncodedAudioPacketTimestamp(
          packet,
          timestampOffsetSeconds,
        )
        // 复制已编码音频包而不经过 PCM 解码/重编码，启动开销和 CPU 占用都远低于整段视频转换。
        // eslint-disable-next-line no-await-in-loop
        await packetSource.add(normalizedPacket)
        packetCount += 1
        packetEndSeconds = Math.max(
          packetEndSeconds,
          normalizedPacket.timestamp + normalizedPacket.duration,
        )
      }
      if (packetCount === 0) {
        throw new AppError('media-format-unsupported', '远程媒体没有可写入原生播放器的音频包。')
      }

      await output.finalize()
      this.throwIfAborted()
      if (!this.isReady) {
        throw new AppError('media-decode-failed', '原生兼容流没有生成可播放的音频范围。')
      }
      if (this.mediaSource.readyState === 'open') {
        const finalDurationSeconds = Math.max(declaredDurationSeconds ?? 0, packetEndSeconds)
        if (finalDurationSeconds > 0) this.mediaSource.duration = finalDurationSeconds
        this.mediaSource.endOfStream()
      }
    } catch (error) {
      this.terminalFailure ??= error
      if (!this.controller.signal.aborted && this.mediaSource.readyState === 'open') {
        try {
          this.mediaSource.endOfStream('decode')
        } catch {
          // 浏览器也可能先因 SourceBuffer 错误关闭 MediaSource，保留原始错误即可。
        }
      }
      throw error
    } finally {
      this.input?.dispose()
      this.input = undefined
    }
  }

  private async appendChunk(chunk: StreamTargetChunk): Promise<void> {
    this.throwIfAborted()
    const sourceBuffer = this.sourceBuffer
    if (!sourceBuffer || this.mediaSource.readyState !== 'open') {
      throw new AppError('media-decode-failed', '原生兼容播放器已提前关闭。')
    }
    if (chunk.position !== this.nextWritePosition) {
      throw new AppError('media-decode-failed', '碎片音频输出不是连续字节流。')
    }
    this.nextWritePosition += chunk.data.byteLength

    await this.waitForBufferCapacity(sourceBuffer)
    await this.removeExpiredBuffer(sourceBuffer)
    const bytes = new Uint8Array(chunk.data.byteLength)
    bytes.set(chunk.data)
    await appendSourceBuffer(sourceBuffer, bytes, this.controller.signal)
    if (!this.isReady && sourceBuffer.buffered.length > 0) {
      this.isReady = true
      this.ready.resolve()
    }
  }

  /** 限制前向缓冲，避免长音频被后台瞬间完整灌入 SourceBuffer 后触发 QuotaExceededError。 */
  private async waitForBufferCapacity(sourceBuffer: SourceBuffer): Promise<void> {
    while (
      readBufferedAheadSeconds(sourceBuffer.buffered, this.getPlaybackPositionSeconds()) >=
      MAX_BUFFER_AHEAD_SECONDS
    ) {
      // 串行等待正是背压边界；并行计时器会继续堆积读取任务，反而失去限流作用。
      // eslint-disable-next-line no-await-in-loop
      await waitForAbortableDelay(BUFFER_BACKPRESSURE_POLL_MS, this.controller.signal)
      this.throwIfAborted()
    }
  }

  /** 播放向前推进时释放已消费区间，令长达数小时的媒体也维持固定内存上限。 */
  private async removeExpiredBuffer(sourceBuffer: SourceBuffer): Promise<void> {
    const removeEndSeconds = this.getPlaybackPositionSeconds() - MAX_BUFFER_BEHIND_SECONDS
    if (removeEndSeconds <= 0 || sourceBuffer.buffered.length === 0) return
    const removeStartSeconds = sourceBuffer.buffered.start(0)
    if (removeEndSeconds <= removeStartSeconds) return
    await removeSourceBufferRange(
      sourceBuffer,
      removeStartSeconds,
      removeEndSeconds,
      this.controller.signal,
    )
  }

  private throwIfAborted(): void {
    if (!this.controller.signal.aborted) return
    throw new AppError('operation-cancelled', '原生兼容音频读取已中止。')
  }
}

/**
 * MSE 不接受上游编码时，仅通过 Range 读取音轨包并生成会话级原生媒体文件。
 * 与整段视频兜底相比，该路径不会复制视频轨，代价只是需要等音轨包准备完成后才能开始播放。
 */
export async function createNativeCompatibleAudioFile(
  track: Track,
  source: RemoteResolvedMediaSource,
  options: NativeCompatibleAudioFileOptions = {},
): Promise<NativeCompatibleAudioFile> {
  const controller = new AbortController()
  const removeExternalAbortListener = forwardAbort(options.signal, controller)
  let opened: OpenedAudioInput | undefined
  let output: Output | undefined
  try {
    opened = await openAudioInput(track, source, controller.signal)
    throwIfAborted(controller.signal)
    const codec = await opened.audioTrack.getCodec()
    const decoderConfig = await opened.audioTrack.getDecoderConfig()
    if (!codec || !decoderConfig) {
      throw new AppError('media-format-unsupported', '远程音轨缺少原生文件所需的编码信息。')
    }

    const isMp3 = codec === 'mp3'
    const target = new BufferTarget()
    output = new Output({
      format: isMp3 ? new Mp3OutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    })
    const packetSource = new EncodedAudioPacketSource(codec)
    output.addAudioTrack(packetSource, { decoderConfig })
    await output.start()

    const timestampOffsetSeconds = readPacketTimestampOffset(opened.firstPacket)
    let packetCount = 0
    for await (const packet of new EncodedPacketSink(opened.audioTrack).packets(
      opened.firstPacket,
    )) {
      throwIfAborted(controller.signal)
      // eslint-disable-next-line no-await-in-loop
      await packetSource.add(normalizeEncodedAudioPacketTimestamp(packet, timestampOffsetSeconds))
      packetCount += 1
    }
    if (packetCount === 0) {
      throw new AppError('media-format-unsupported', '远程媒体没有可抽取的音频包。')
    }
    await output.finalize()
    throwIfAborted(controller.signal)
    if (!target.buffer) {
      throw new AppError('media-decode-failed', '音轨抽取没有生成原生媒体文件。')
    }
    return {
      bytes: new Uint8Array(target.buffer),
      mimeType: isMp3 ? 'audio/mpeg' : 'audio/mp4',
    }
  } catch (error) {
    if (output?.state === 'started') await output.cancel().catch(() => undefined)
    throw error
  } finally {
    opened?.input.dispose()
    removeExternalAbortListener()
  }
}

/** MSE 的音频 SourceBuffer 使用 audio/mp4；编码参数仍沿用输入轨计算出的精确值。 */
export function createNativeAudioMimeType(codecParameter: string): string {
  const normalizedCodec = codecParameter.trim()
  if (!normalizedCodec || normalizedCodec.includes('"')) {
    throw new AppError('media-format-unsupported', '远程音轨返回了无效的编码参数。')
  }
  return `audio/mp4; codecs="${normalizedCodec}"`
}

/**
 * 抖音 MP4 常用负时间戳表达 AAC 编码器预卷；输出复用原始编码包，但 MP4 muxer 要求非负时间线。
 * 以首包为零点整体平移可以保留包间间隔和音质，同时避免两个兼容通道都退化到整段视频下载。
 */
export function normalizeEncodedAudioPacketTimestamp(
  packet: EncodedPacket,
  offsetSeconds: number,
): EncodedPacket {
  const timestamp = Math.max(0, packet.timestamp + offsetSeconds)
  return timestamp === packet.timestamp ? packet : packet.clone({ timestamp })
}

function readPacketTimestampOffset(firstPacket: EncodedPacket): number {
  return Math.max(0, -firstPacket.timestamp)
}

function readDeclaredDurationSeconds(
  track: Track,
  source: RemoteResolvedMediaSource,
): number | undefined {
  const durationMs = source.durationMs ?? track.durationMs
  return durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0
    ? durationMs / 1_000
    : undefined
}

async function openAudioInput(
  track: Track,
  source: RemoteResolvedMediaSource,
  signal: AbortSignal,
  startTimeSeconds = 0,
): Promise<OpenedAudioInput> {
  const urls = [...new Set([source.url, ...source.backupUrls])]
  const controllers = urls.map(() => new AbortController())
  const activeInputs = new Map<number, Input>()

  const attempts = urls.map(async (url, index) => {
    const controller = controllers[index]!
    const attemptSignal = AbortSignal.any([signal, controller.signal])
    await waitForAbortableDelay(index * MEDIA_NODE_HEDGE_DELAY_MS, attemptSignal)
    throwIfAborted(attemptSignal)

    const input = new Input({
      source: createRangeMediaSource(track, source, url, { signal: attemptSignal }),
      formats: ALL_FORMATS,
    })
    activeInputs.set(index, input)
    try {
      if (!(await input.canRead())) throw new Error('无法识别媒体封装格式')
      const audioTrack = await input.getPrimaryAudioTrack()
      if (!audioTrack) throw new Error('媒体中没有音轨')
      // 真正的启动延迟常发生在索引完成之后的首包随机读取；竞争必须覆盖到这一步，
      // 否则会过早锁定“能识别但首包很慢”的 CDN，并把健康备用节点全部取消。
      const firstPacket = await selectNativeAudioStartPacket(
        new EncodedPacketSink(audioTrack),
        startTimeSeconds,
      )
      if (!firstPacket) throw new Error('媒体音轨没有可读取的编码包')
      return { input, audioTrack, firstPacket, index }
    } catch (error) {
      activeInputs.delete(index)
      input.dispose()
      throw error
    }
  })

  try {
    // 备用 CDN 采用错峰竞争：健康主节点不会产生额外请求，主节点卡住时备用节点无需排队等超时。
    const winner = await Promise.any(attempts)
    for (const [index, controller] of controllers.entries()) {
      if (index !== winner.index) controller.abort()
    }
    for (const [index, input] of activeInputs) {
      if (index !== winner.index) input.dispose()
    }
    return {
      input: winner.input,
      audioTrack: winner.audioTrack,
      firstPacket: winner.firstPacket,
    }
  } catch (error) {
    for (const controller of controllers) controller.abort()
    for (const input of activeInputs.values()) input.dispose()
    throwIfAborted(signal)
    const causes = error instanceof AggregateError ? error.errors : [error]
    throw new NativeAudioInputUnavailableError(causes)
  }
}

/** seek 重建直接定位目标音频包，避免为了跳到中后段仍从文件开头顺序重封装。 */
export function selectNativeAudioStartPacket(
  sink: Pick<EncodedPacketSink, 'getFirstPacket' | 'getPacket'>,
  startTimeSeconds: number,
): Promise<EncodedPacket | null> {
  const normalizedStartTimeSeconds = normalizeStartTimeSeconds(startTimeSeconds)
  return normalizedStartTimeSeconds > 0
    ? sink.getPacket(normalizedStartTimeSeconds)
    : sink.getFirstPacket()
}

function normalizeStartTimeSeconds(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0
}

function waitForAbortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (delayMs <= 0) return Promise.resolve()
  if (signal.aborted) return Promise.reject(new AppError('operation-cancelled'))
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)
    const handleAbort = () => {
      globalThis.clearTimeout(timeoutId)
      signal.removeEventListener('abort', handleAbort)
      reject(new AppError('operation-cancelled'))
    }
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function forwardAbort(externalSignal: AbortSignal | undefined, controller: AbortController) {
  if (!externalSignal) return noop
  if (externalSignal.aborted) {
    controller.abort()
    return noop
  }
  const abort = () => controller.abort()
  externalSignal.addEventListener('abort', abort, { once: true })
  return () => externalSignal.removeEventListener('abort', abort)
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw new AppError('operation-cancelled', '原生兼容音频读取已中止。')
}

function noop(): void {}

function waitForMediaSourceOpen(mediaSource: MediaSource, signal: AbortSignal): Promise<void> {
  if (mediaSource.readyState === 'open') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      mediaSource.removeEventListener('sourceopen', handleOpen)
      signal.removeEventListener('abort', handleAbort)
    }
    const handleOpen = () => {
      cleanup()
      resolve()
    }
    const handleAbort = () => {
      cleanup()
      reject(new AppError('operation-cancelled', '原生兼容播放器已取消。'))
    }
    mediaSource.addEventListener('sourceopen', handleOpen, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function appendSourceBuffer(
  sourceBuffer: SourceBuffer,
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', handleUpdateEnd)
      sourceBuffer.removeEventListener('error', handleError)
      sourceBuffer.removeEventListener('abort', handleAbort)
      signal.removeEventListener('abort', handleAbort)
    }
    const handleUpdateEnd = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new AppError('media-decode-failed', '浏览器拒绝了兼容音频碎片。'))
    }
    const handleAbort = () => {
      cleanup()
      reject(new AppError('operation-cancelled', '兼容音频碎片写入已取消。'))
    }
    sourceBuffer.addEventListener('updateend', handleUpdateEnd, { once: true })
    sourceBuffer.addEventListener('error', handleError, { once: true })
    sourceBuffer.addEventListener('abort', handleAbort, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    try {
      sourceBuffer.appendBuffer(bytes)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function removeSourceBufferRange(
  sourceBuffer: SourceBuffer,
  startSeconds: number,
  endSeconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', handleUpdateEnd)
      sourceBuffer.removeEventListener('error', handleError)
      sourceBuffer.removeEventListener('abort', handleAbort)
      signal.removeEventListener('abort', handleAbort)
    }
    const handleUpdateEnd = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new AppError('media-decode-failed', '浏览器无法清理已播放的兼容音频缓冲。'))
    }
    const handleAbort = () => {
      cleanup()
      reject(new AppError('operation-cancelled', '兼容音频缓冲清理已取消。'))
    }
    sourceBuffer.addEventListener('updateend', handleUpdateEnd, { once: true })
    sourceBuffer.addEventListener('error', handleError, { once: true })
    sourceBuffer.addEventListener('abort', handleAbort, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    try {
      sourceBuffer.remove(startSeconds, endSeconds)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function readBufferedAheadSeconds(ranges: TimeRanges, positionSeconds: number): number {
  let bufferedEndSeconds = positionSeconds
  for (let index = 0; index < ranges.length; index += 1) {
    const rangeStartSeconds = ranges.start(index)
    const rangeEndSeconds = ranges.end(index)
    if (rangeStartSeconds <= positionSeconds && positionSeconds <= rangeEndSeconds) {
      bufferedEndSeconds = Math.max(bufferedEndSeconds, rangeEndSeconds)
    }
  }
  return Math.max(0, bufferedEndSeconds - positionSeconds)
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
