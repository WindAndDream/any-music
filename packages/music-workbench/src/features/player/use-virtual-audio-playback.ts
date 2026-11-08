import type { VirtualPlaybackChunk } from '@any-music/audio-composition'
import {
  preloadVirtualAudioChunks,
  createVirtualPlaybackChunks,
  locateVirtualPlaybackChunk,
  selectVirtualPlaybackWindow,
} from '@any-music/audio-composition'
import { getCompiledDurationMs } from '@any-music/core'
import type { CompiledSegmentRecipe, ResolvedMediaSource, Track } from '@any-music/core'
import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

import { VirtualAudioBufferLoader } from './virtual-audio-buffer-loader'

const STARTUP_READY_LOOK_AHEAD_MS = 3_000
const ROLLING_LOOK_AHEAD_MS = 20_000
const REFILL_THRESHOLD_MS = 10_000
const RETAIN_DECODED_BEHIND_MS = 5_000
const PREFETCH_CONCURRENCY = 3
const SCHEDULE_LEAD_SECONDS = 0.04

const STARTUP_READY_WINDOW = {
  lookAheadMs: STARTUP_READY_LOOK_AHEAD_MS,
  minimumChunkCount: 1,
  maximumChunkCount: PREFETCH_CONCURRENCY,
} as const
const ROLLING_WINDOW = {
  lookAheadMs: ROLLING_LOOK_AHEAD_MS,
  minimumChunkCount: 3,
  maximumChunkCount: 32,
} as const

export interface UseVirtualAudioPlaybackOptions {
  resolveTrack: (trackId: string) => Track | undefined
  resolveMedia: (track: Track) => Promise<ResolvedMediaSource>
  canPrefetchMedia: (track: Track) => boolean
  onProgress: (positionMs: number, durationMs: number, completed: boolean) => void
  onEnded: () => void
  onError: (error: unknown, positionMs: number, autoplayRequested: boolean) => void
}

/**
 * 自定义歌曲的有界预取与无缝排程状态机。
 * PCM 块只有进入滚动窗口才会解码，AudioContext 则把已就绪的连续块排到同一时钟上，
 * 避免依赖低频 timeupdate 在拼接边界临时换 URL。
 */
export function useVirtualAudioPlayback(options: UseVirtualAudioPlaybackOptions) {
  const status = shallowRef<'idle' | 'buffering' | 'ready' | 'playing' | 'paused' | 'error'>('idle')
  const positionMs = shallowRef(0)
  const durationMs = shallowRef(0)
  const bufferedUntilMs = shallowRef(0)
  const isPlaying = shallowRef(false)
  const playbackRate = shallowRef(1)
  const volume = shallowRef(1)

  let audioContext: AudioContext | undefined
  let outputGain: GainNode | undefined
  let loader: VirtualAudioBufferLoader | undefined
  let chunks: readonly VirtualPlaybackChunk[] = []
  let sessionGeneration = 0
  let prepareGeneration = 0
  let monitorFrame: number | undefined
  let refillPromise: Promise<void> | undefined
  let refillOperation = 0
  let scheduledThroughIndex = -1
  let scheduledUntilMs = 0
  let anchorPositionMs = 0
  let anchorContextTime = 0
  const decodedBuffers = new Map<string, AudioBuffer>()
  const bufferPromises = new Map<string, Promise<AudioBuffer>>()
  const scheduledSources = new Set<AudioBufferSourceNode>()

  const statusLabel = computed(() => {
    if (status.value === 'buffering') {
      return `正在预解析播放窗口… 已准备到 ${formatTime(bufferedUntilMs.value)}`
    }
    const stateLabel = status.value === 'paused' ? '已暂停' : '无缝预取'
    return `虚拟时间轴 ${formatTime(positionMs.value)} / ${formatTime(durationMs.value)} · ${stateLabel}至 ${formatTime(bufferedUntilMs.value)}`
  })

  async function load(
    segments: readonly CompiledSegmentRecipe[],
    autoplay: boolean,
    startPositionMs = 0,
  ): Promise<void> {
    reset()
    const generation = sessionGeneration
    chunks = createVirtualPlaybackChunks(segments)
    durationMs.value = getCompiledDurationMs(segments)
    if (chunks.length === 0 || durationMs.value <= 0) {
      status.value = 'error'
      options.onError(new Error('自定义歌曲没有可播放的叶子片段。'), 0, autoplay)
      return
    }

    const initialPositionMs = Math.min(
      Math.max(0, Math.round(startPositionMs)),
      Math.max(0, durationMs.value - 1),
    )
    positionMs.value = initialPositionMs
    let context: AudioContext
    try {
      context = ensureAudioContext()
    } catch (error) {
      status.value = 'error'
      options.onError(error, initialPositionMs, autoplay)
      return
    }
    loader = new VirtualAudioBufferLoader({
      audioContext: context,
      resolveTrack: options.resolveTrack,
      resolveMedia: options.resolveMedia,
      canPrefetchMedia: options.canPrefetchMedia,
    })
    await prepareAt(initialPositionMs, autoplay, generation)
  }

  async function toggle(): Promise<void> {
    if (isPlaying.value) {
      pause()
      return
    }
    const restartPosition = positionMs.value >= durationMs.value ? 0 : positionMs.value
    await seek(restartPosition, true)
  }

  function pause(): void {
    if (!isPlaying.value) return
    const currentPositionMs = getClockPositionMs()
    stopScheduledSources()
    stopMonitor()
    positionMs.value = currentPositionMs
    isPlaying.value = false
    status.value = 'paused'
    options.onProgress(positionMs.value, durationMs.value, false)
  }

  async function seek(nextPositionMs: number, autoplay = isPlaying.value): Promise<void> {
    if (durationMs.value <= 0 || chunks.length === 0) return
    const clampedPositionMs = Math.min(
      Math.max(0, Math.round(nextPositionMs)),
      Math.max(0, durationMs.value - 1),
    )
    stopScheduledSources()
    stopMonitor()
    isPlaying.value = false
    positionMs.value = clampedPositionMs
    const generation = sessionGeneration
    await prepareAt(clampedPositionMs, autoplay, generation)
  }

  function setPlaybackRate(nextRate: number): void {
    if (!Number.isFinite(nextRate) || nextRate <= 0 || nextRate === playbackRate.value) return
    const currentPositionMs = isPlaying.value ? getClockPositionMs() : positionMs.value
    const shouldResume = isPlaying.value
    playbackRate.value = nextRate
    if (!shouldResume) return
    stopScheduledSources()
    positionMs.value = currentPositionMs
    void startAt(currentPositionMs, sessionGeneration)
  }

  /** Web Audio 片段不经过隐藏的 media 元素，必须在共享输出节点上应用控制栏音量。 */
  function setVolume(nextVolume: number): void {
    if (!Number.isFinite(nextVolume)) return
    volume.value = Math.min(1, Math.max(0, nextVolume))
    if (outputGain) outputGain.gain.value = volume.value
  }

  function reset(): void {
    sessionGeneration += 1
    prepareGeneration += 1
    stopScheduledSources()
    stopMonitor()
    loader?.dispose()
    loader = undefined
    chunks = []
    decodedBuffers.clear()
    bufferPromises.clear()
    refillPromise = undefined
    positionMs.value = 0
    durationMs.value = 0
    bufferedUntilMs.value = 0
    isPlaying.value = false
    status.value = 'idle'
  }

  async function dispose(): Promise<void> {
    reset()
    const context = audioContext
    audioContext = undefined
    outputGain = undefined
    if (context && context.state !== 'closed') await context.close().catch(() => undefined)
  }

  async function prepareAt(
    nextPositionMs: number,
    autoplay: boolean,
    generation: number,
  ): Promise<void> {
    const operation = ++prepareGeneration
    status.value = 'buffering'
    try {
      const startupChunks = selectVirtualPlaybackWindow(
        chunks,
        nextPositionMs,
        STARTUP_READY_WINDOW,
      )
      const rollingChunks = selectVirtualPlaybackWindow(chunks, nextPositionMs, ROLLING_WINDOW)
      // 先让完整滚动窗口占满并发槽，再只等待连续启动窗；一秒级片段会并发准备前三段，
      // 后续片段在播放真正开始前就已接力加载。
      void loadChunks(rollingChunks, generation).catch(() => undefined)
      await loadChunks(startupChunks, generation)
      if (generation !== sessionGeneration || operation !== prepareGeneration) return
      updateBufferedUntil(nextPositionMs)
      if (autoplay) await startAt(nextPositionMs, generation, operation)
      else status.value = 'ready'
      void refill(nextPositionMs, generation, operation)
    } catch (error) {
      if (generation !== sessionGeneration || operation !== prepareGeneration) return
      status.value = 'error'
      isPlaying.value = false
      options.onError(error, nextPositionMs, autoplay)
    }
  }

  async function startAt(
    nextPositionMs: number,
    generation: number,
    operation = prepareGeneration,
  ): Promise<void> {
    const context = ensureAudioContext()
    try {
      await context.resume()
    } catch {
      if (generation === sessionGeneration) status.value = 'ready'
      return
    }
    if (generation !== sessionGeneration) return

    stopScheduledSources()
    anchorPositionMs = nextPositionMs
    anchorContextTime = context.currentTime + SCHEDULE_LEAD_SECONDS
    positionMs.value = nextPositionMs
    scheduledThroughIndex = findChunkIndex(nextPositionMs) - 1
    scheduledUntilMs = nextPositionMs
    scheduleDecodedChunks(nextPositionMs)
    if (scheduledUntilMs <= nextPositionMs) {
      status.value = 'buffering'
      return
    }
    isPlaying.value = true
    status.value = 'playing'
    startMonitor()
    void refill(nextPositionMs, generation, operation)
  }

  function scheduleDecodedChunks(nextPositionMs: number): void {
    const context = audioContext
    if (!context) return
    let index = scheduledThroughIndex + 1
    while (index < chunks.length) {
      const chunk = chunks[index]
      if (!chunk) break
      const buffer = decodedBuffers.get(chunk.key)
      if (!buffer) break
      const offsetMs =
        index === findChunkIndex(nextPositionMs)
          ? Math.max(0, nextPositionMs - chunk.virtualStartMs)
          : 0
      const source = context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = playbackRate.value
      source.connect(outputGain ?? context.destination)
      const when =
        anchorContextTime +
        (Math.max(chunk.virtualStartMs, anchorPositionMs) - anchorPositionMs) /
          1000 /
          playbackRate.value
      const playableDurationSeconds = Math.max(
        0,
        (chunk.virtualEndMs - chunk.virtualStartMs - offsetMs) / 1000,
      )
      source.start(when, offsetMs / 1000)
      source.stop(when + playableDurationSeconds / playbackRate.value)
      scheduledSources.add(source)
      source.addEventListener(
        'ended',
        () => {
          scheduledSources.delete(source)
          source.disconnect()
        },
        { once: true },
      )
      scheduledThroughIndex = index
      scheduledUntilMs = chunk.virtualEndMs
      index += 1
    }
    bufferedUntilMs.value = Math.max(bufferedUntilMs.value, scheduledUntilMs)
  }

  function startMonitor(): void {
    stopMonitor()
    const update = () => {
      if (!isPlaying.value) return
      const currentPositionMs = getClockPositionMs()
      positionMs.value = currentPositionMs
      options.onProgress(currentPositionMs, durationMs.value, false)
      evictOldBuffers(currentPositionMs)

      if (currentPositionMs >= durationMs.value - 5) {
        completePlayback()
        return
      }
      if (currentPositionMs >= scheduledUntilMs - 5 && scheduledUntilMs < durationMs.value) {
        void recoverFromUnderflow(scheduledUntilMs)
        return
      }
      if (bufferedUntilMs.value - currentPositionMs <= REFILL_THRESHOLD_MS) {
        void refill(currentPositionMs, sessionGeneration, prepareGeneration)
      }
      monitorFrame = requestAnimationFrame(update)
    }
    monitorFrame = requestAnimationFrame(update)
  }

  async function recoverFromUnderflow(recoveryPositionMs: number): Promise<void> {
    stopScheduledSources()
    stopMonitor()
    positionMs.value = recoveryPositionMs
    isPlaying.value = false
    status.value = 'buffering'
    // 滚动补窗失败时先重试当前目标启动窗；重试仍失败才交给组件切换原生兼容播放。
    await prepareAt(recoveryPositionMs, true, sessionGeneration)
  }

  function completePlayback(): void {
    stopScheduledSources()
    stopMonitor()
    positionMs.value = durationMs.value
    bufferedUntilMs.value = durationMs.value
    isPlaying.value = false
    status.value = 'ready'
    options.onProgress(durationMs.value, durationMs.value, true)
    options.onEnded()
  }

  function refill(nextPositionMs: number, generation: number, operation: number): Promise<void> {
    if (refillPromise && refillOperation === operation) return refillPromise
    const targetChunks = selectVirtualPlaybackWindow(chunks, nextPositionMs, ROLLING_WINDOW)
    refillOperation = operation
    const pending = loadChunks(targetChunks, generation)
      .then(() => {
        if (generation !== sessionGeneration || operation !== prepareGeneration) return
        updateBufferedUntil(nextPositionMs)
        if (isPlaying.value) scheduleDecodedChunks(anchorPositionMs)
      })
      .catch(() => undefined)
      .finally(() => {
        if (refillOperation === operation) refillPromise = undefined
      })
    refillPromise = pending
    return pending
  }

  async function loadChunks(
    targetChunks: readonly VirtualPlaybackChunk[],
    generation: number,
  ): Promise<void> {
    await preloadVirtualAudioChunks(targetChunks, {
      concurrency: PREFETCH_CONCURRENCY,
      shouldContinue: () => generation === sessionGeneration,
      loadChunk: async (chunk) => void (await getBuffer(chunk, generation)),
      onChunkLoaded: () => {
        if (!isPlaying.value) return
        updateBufferedUntil(getClockPositionMs())
        scheduleDecodedChunks(anchorPositionMs)
      },
    })
  }

  function getBuffer(chunk: VirtualPlaybackChunk, generation: number): Promise<AudioBuffer> {
    const ready = decodedBuffers.get(chunk.key)
    if (ready) return Promise.resolve(ready)
    const cached = bufferPromises.get(chunk.key)
    if (cached) return cached
    let pending: Promise<AudioBuffer>
    pending = Promise.resolve()
      .then(() => {
        if (!loader) throw new Error('虚拟音频加载器尚未初始化。')
        return loader.load(chunk)
      })
      .then((buffer) => {
        if (bufferPromises.get(chunk.key) === pending) bufferPromises.delete(chunk.key)
        if (generation === sessionGeneration) decodedBuffers.set(chunk.key, buffer)
        return buffer
      })
      .catch((error: unknown) => {
        if (bufferPromises.get(chunk.key) === pending) bufferPromises.delete(chunk.key)
        throw error
      })
    bufferPromises.set(chunk.key, pending)
    return pending
  }

  function updateBufferedUntil(nextPositionMs: number): void {
    const activeIndex = findChunkIndex(nextPositionMs)
    let endMs = nextPositionMs
    for (let index = activeIndex; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      if (!chunk || !decodedBuffers.has(chunk.key)) break
      endMs = chunk.virtualEndMs
    }
    bufferedUntilMs.value = endMs
  }

  function evictOldBuffers(currentPositionMs: number): void {
    const retainAfterMs = currentPositionMs - RETAIN_DECODED_BEHIND_MS
    for (const chunk of chunks) {
      if (chunk.virtualEndMs >= retainAfterMs) break
      decodedBuffers.delete(chunk.key)
      bufferPromises.delete(chunk.key)
    }
  }

  function getClockPositionMs(): number {
    const context = audioContext
    if (!context || !isPlaying.value) return positionMs.value
    const elapsedSeconds = Math.max(0, context.currentTime - anchorContextTime)
    return Math.min(durationMs.value, anchorPositionMs + elapsedSeconds * 1000 * playbackRate.value)
  }

  function findChunkIndex(nextPositionMs: number): number {
    const chunk = locateVirtualPlaybackChunk(chunks, nextPositionMs)
    return chunk ? chunks.indexOf(chunk) : -1
  }

  function stopScheduledSources(): void {
    for (const source of scheduledSources) {
      try {
        source.stop()
      } catch {
        // 已自然结束的 AudioBufferSourceNode 不能再次停止；清理集合即可。
      }
      source.disconnect()
    }
    scheduledSources.clear()
    scheduledThroughIndex = -1
    scheduledUntilMs = positionMs.value
  }

  function stopMonitor(): void {
    if (monitorFrame !== undefined) cancelAnimationFrame(monitorFrame)
    monitorFrame = undefined
  }

  function ensureAudioContext(): AudioContext {
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContext({ latencyHint: 'playback' })
      outputGain = audioContext.createGain()
      outputGain.gain.value = volume.value
      outputGain.connect(audioContext.destination)
    }
    return audioContext
  }

  onScopeDispose(() => {
    void dispose()
  })

  return {
    status: readonly(status),
    statusLabel,
    positionMs: readonly(positionMs),
    durationMs: readonly(durationMs),
    bufferedUntilMs: readonly(bufferedUntilMs),
    isPlaying: readonly(isPlaying),
    load,
    toggle,
    pause,
    seek,
    setPlaybackRate,
    setVolume,
    reset,
    dispose,
  }
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
