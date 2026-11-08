import {
  preloadVirtualAudioChunks,
  createVirtualPlaybackChunks,
  selectVirtualPlaybackWindow,
} from '@any-music/audio-composition'
import {
  AppError,
  createAppErrorState,
  formatAppErrorMessage,
  getCompiledDurationMs,
  MusicSourceError,
  toAppErrorState,
} from '@any-music/core'
import type {
  AppErrorState,
  CompiledSegmentRecipe,
  MediaQuality,
  MediaResolveOptions,
  RemoteResolvedMediaSource,
  ResolvedMediaSource,
  Track,
} from '@any-music/core'
import { clampPlaybackPositionMs, seekNativeMedia } from '@any-music/ui'
import type { TrackPlaybackState } from '@any-music/ui'
import { computed, onScopeDispose, readonly, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import type { WorkbenchRuntime } from '../../runtime/workbench-runtime'
import {
  createCustomSegmentSeekTarget,
  createCustomSegmentStartTarget,
  hasReachedCustomSegmentSeekTarget,
  shouldAutoplayCustomSegment,
} from './custom-segment-seek'
import type { CustomSegmentSeekTarget } from './custom-segment-seek'
import {
  createNativeCompatibleAudioFile,
  NativeCompatibleAudioSession,
  shouldSkipNativeAudioExtraction,
} from './native-compatible-audio'
import {
  requiresManagedPlayback,
  selectNativeMediaReferrerPolicy,
  selectPlaybackResumePositionMs,
  shouldAutoplayAfterManagedSeek,
  shouldAutoplayNativeFallback,
  shouldRestartManagedPlaybackForSeek,
} from './playback-transport'
import { useStablePlaybackTimeline } from './use-stable-playback-timeline'
import { useVirtualAudioPlayback } from './use-virtual-audio-playback'
import { VirtualAudioBufferError } from './virtual-audio-buffer-loader'

const SEGMENTED_PREFETCH_LOOK_AHEAD_MS = 10_000
const SEGMENTED_PREFETCH_MINIMUM_CHUNK_COUNT = 3
const SEGMENTED_PREFETCH_MAXIMUM_CHUNK_COUNT = 12
const SEGMENTED_PREFETCH_CONCURRENCY = 3

/** 播放器只消费 core 媒体契约，平台短时 URL 的解析由注册表按 pluginId 路由。 */
export interface AudioPlayerProps {
  playbackEnvironment?: WorkbenchRuntime['playbackEnvironment']
  subscribeSourceInvalidation?: WorkbenchRuntime['subscribeSourceInvalidation']
  track?: Track
  virtualSegments?: readonly CompiledSegmentRecipe[]
  repeatOne: boolean
  downloadBusy: boolean
  resolveTrack: (trackId: string) => Track | undefined
  resolveMedia: (track: Track, options?: MediaResolveOptions) => Promise<ResolvedMediaSource>
  canPrefetchMedia: (track: Track) => boolean
  renderCustomMedia: (
    track: Track,
    segments: readonly CompiledSegmentRecipe[],
    options?: { signal?: AbortSignal; onSourceResolved?: (source: ResolvedMediaSource) => void },
  ) => Promise<ResolvedMediaSource>
  loadMediaFile: (
    track: Track,
    source: RemoteResolvedMediaSource,
    options?: { signal?: AbortSignal },
  ) => Promise<{ bytes: Uint8Array; mimeType?: string }>
}

export interface AudioPlayerEmits {
  playbackStateChange: [state: TrackPlaybackState | undefined]
  sourceInvalidated: []
  ended: []
  previous: []
  next: []
  download: [track: Track]
  progress: [positionMs: number, durationMs: number | undefined, completed: boolean]
  sessionExpired: [error: AppErrorState]
  trackUnavailable: [trackId: string, error: AppErrorState]
  trackAvailable: [trackId: string]
}

export type AudioPlayerEmit = <EventName extends keyof AudioPlayerEmits>(
  eventName: EventName,
  ...args: AudioPlayerEmits[EventName]
) => void

export interface UseAudioPlayerOptions {
  /** The stable workbench host owns the audio node, outside replaceable presentation roots. */
  audio: Readonly<ShallowRef<HTMLAudioElement | null>>
  props: Readonly<AudioPlayerProps>
  emit: AudioPlayerEmit
}

export type AudioPlayerController = ReturnType<typeof useAudioPlayer>

interface PlayableMedia {
  urls: readonly string[]
  preload: 'auto' | 'metadata'
}

interface LoadTrackMediaOptions {
  seekMs?: number
  autoplay: boolean
  qualityId?: string
  preserveCurrentPlayback?: boolean
}

interface CompatibilityPlaybackContext {
  track: Track
  source: RemoteResolvedMediaSource
  generation: number
}

interface PendingCustomSegmentSeek extends CustomSegmentSeekTarget {
  mediaUrl?: string
}

function getRootCause(cause: unknown): unknown {
  let current = cause
  const visited = new Set<unknown>()
  while (current instanceof Error && current.cause !== undefined && !visited.has(current)) {
    visited.add(current)
    current = current.cause
  }
  return current
}

function normalizeMediaUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href
  } catch {
    return url
  }
}

function readNativePositionMs(element: HTMLAudioElement | null): number | undefined {
  return element && Number.isFinite(element.currentTime) ? element.currentTime * 1_000 : undefined
}

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/**
 * 跨来源音频播放状态机。
 *
 * 返回值只包含可展示的只读状态与用户动作；正式版可以替换整套播放器标记，继续复用
 * 同一套解析、Range/MSE 兼容、虚拟片段预取和 seek 竞态保护逻辑。
 */
export function useAudioPlayer(playerOptions: UseAudioPlayerOptions) {
  const { audio, emit, props } = playerOptions
  const status = shallowRef<'idle' | 'resolving' | 'ready' | 'error'>('idle')
  const error = shallowRef<AppErrorState>()
  const errorMessage = computed(() => (error.value ? formatAppErrorMessage(error.value) : ''))
  const qualityError = shallowRef<AppErrorState>()
  const qualityOptions = shallowRef<readonly MediaQuality[]>([])
  const selectedQualityId = shallowRef<string>()
  const isQualitySwitching = shallowRef(false)
  const playbackRate = shallowRef(1)
  const volume = shallowRef(1)
  const sourceUrls = shallowRef<readonly string[]>([])
  const sourceIndex = shallowRef(0)
  const pendingSeekMs = shallowRef<number>()
  const autoplayAfterLoad = shallowRef(false)
  const isCompatibilityLoading = shallowRef(false)
  const isNativeCompatibilityPlayback = shallowRef(false)
  const compatibilityStage = shallowRef<'idle' | 'media-source' | 'extracting' | 'complete'>('idle')
  const nativePositionMs = shallowRef(0)
  const nativeDurationMs = shallowRef<number>()
  const resolvedNativeDurationMs = shallowRef<number>()
  const nativeBufferedUntilMs = shallowRef(0)
  const nativeIsPlaying = shallowRef(false)
  const customPlaybackMode = shallowRef<'buffered' | 'segmented' | 'rendered'>('buffered')
  const customFallbackMessage = shallowRef('')
  const customSegmentIndex = shallowRef(0)
  const customPositionMs = shallowRef(0)
  const customDurationMs = shallowRef(0)
  const customBufferedUntilMs = shallowRef(0)
  const customAutoplayIntent = shallowRef(false)
  const pendingCustomSeek = shallowRef<PendingCustomSegmentSeek>()
  const resolvedMediaCache = new Map<string, Promise<ResolvedMediaSource>>()
  const heldMedia = new Set<ResolvedMediaSource>()
  const playbackAccountIds = new Set<string>()
  const objectUrls = new Set<string>()
  let mediaLoadGeneration = 0
  let isAdvancingCustomSegment = false
  let activeMediaTrackId: string | undefined
  let activeMediaTrack: Track | undefined
  let activeRemoteSource: RemoteResolvedMediaSource | undefined
  let activeCompatibilityContext: CompatibilityPlaybackContext | undefined
  let compatibilityLoadAttempted = false
  let compatibilityCompleteLoadAttempted = false
  let compatibilityLoadController: AbortController | undefined
  let nativeCompatibilitySession: NativeCompatibleAudioSession | undefined
  let customRenderController: AbortController | undefined
  let mediaRequestController = new AbortController()
  let nativeSeekRestartTimer: ReturnType<typeof globalThis.setTimeout> | undefined
  let ignoredNativeSeekingPositionMs: number | undefined
  let pendingNativeMediaUrl: string | undefined
  let loadedCustomSegmentIndex: number | undefined
  const interruptedPositionMs = shallowRef<number>()

  const virtualPlayback = useVirtualAudioPlayback({
    resolveTrack: props.resolveTrack,
    resolveMedia: async (track) => {
      const generation = mediaLoadGeneration
      const source = await props.resolveMedia(track, getMediaResolveOptions())
      if (generation !== mediaLoadGeneration) {
        source.release?.()
        throw new AppError('operation-cancelled')
      }
      if (source.accountId) playbackAccountIds.add(source.accountId)
      return source
    },
    canPrefetchMedia: props.canPrefetchMedia,
    onProgress: (positionMs, durationMs, completed) =>
      emit('progress', positionMs, durationMs, completed),
    onEnded: handleBufferedCustomEnded,
    onError: handleVirtualPlaybackError,
  })
  const unsubscribeSourceInvalidation = props.subscribeSourceInvalidation?.((event) => {
    // 判断实际解析会话；同一首歌经另一账号下载时不能结束当前播放。
    if (event.accountId && playbackAccountIds.has(event.accountId)) {
      resetPlaybackSession()
      emit('sourceInvalidated')
    }
  })

  const isCustomTrack = computed(() => props.track?.source.mediaKind === 'custom')
  const isBufferedCustomPlayback = computed(
    () => isCustomTrack.value && customPlaybackMode.value === 'buffered',
  )
  const isSegmentedCustomPlayback = computed(
    () => isCustomTrack.value && customPlaybackMode.value === 'segmented',
  )
  const isControlledCustomPlayback = computed(
    () => isBufferedCustomPlayback.value || isSegmentedCustomPlayback.value,
  )
  const {
    displayedPositionMs: stableNativePositionMs,
    displayedDurationMs: stableNativeDurationMs,
  } = useStablePlaybackTimeline({
    positionMs: nativePositionMs,
    durationMs: nativeDurationMs,
    pendingPositionMs: pendingSeekMs,
    resolvedDurationMs: resolvedNativeDurationMs,
  })
  const displayedPositionMs = computed(() =>
    isBufferedCustomPlayback.value
      ? virtualPlayback.positionMs.value
      : isSegmentedCustomPlayback.value
        ? (pendingCustomSeek.value?.virtualPositionMs ?? customPositionMs.value)
        : stableNativePositionMs.value,
  )
  const displayedDurationMs = computed(() =>
    isBufferedCustomPlayback.value
      ? virtualPlayback.durationMs.value
      : isSegmentedCustomPlayback.value
        ? customDurationMs.value
        : stableNativeDurationMs.value,
  )
  const displayedBufferedUntilMs = computed(() =>
    isBufferedCustomPlayback.value
      ? virtualPlayback.bufferedUntilMs.value
      : isSegmentedCustomPlayback.value
        ? customBufferedUntilMs.value
        : nativeBufferedUntilMs.value,
  )
  const isSeekDisabled = computed(
    () => !props.track || (status.value === 'resolving' && !isSegmentedCustomPlayback.value),
  )
  const displayedIsPlaying = computed(() =>
    isBufferedCustomPlayback.value
      ? virtualPlayback.isPlaying.value
      : isSegmentedCustomPlayback.value
        ? customAutoplayIntent.value
        : nativeIsPlaying.value,
  )
  const playbackState = computed<TrackPlaybackState | undefined>(() => {
    if (!props.track || status.value === 'error') return undefined
    if (displayedIsPlaying.value) return { trackId: props.track.id, status: 'playing' }
    const isPaused = isBufferedCustomPlayback.value
      ? virtualPlayback.status.value === 'paused'
      : status.value === 'ready' && !autoplayAfterLoad.value
    return isPaused ? { trackId: props.track.id, status: 'paused' } : undefined
  })
  // 原生媒体与虚拟片段统一上报实际曲目，避免试听或换曲时沿用队列的选中标记。
  watch(playbackState, (state) => emit('playbackStateChange', state), {
    immediate: true,
    flush: 'post',
  })
  const statusLabel = computed(() => {
    if (status.value === 'error') return errorMessage.value
    if (interruptedPositionMs.value !== undefined) return '播放已中断，点击播放继续'
    if (qualityError.value) return formatAppErrorMessage(qualityError.value)
    if (isBufferedCustomPlayback.value) return virtualPlayback.statusLabel.value
    if (status.value === 'resolving') {
      if (isCompatibilityLoading.value) {
        if (compatibilityStage.value === 'extracting') return '正在抽取音轨并准备原生播放器…'
        if (compatibilityStage.value === 'complete') {
          return '正在快速读取媒体兼容兜底…'
        }
        return '正在建立原生跨站音频流…'
      }
      if (isQualitySwitching.value) {
        const quality = qualityOptions.value.find(({ id }) => id === selectedQualityId.value)
        return `正在切换到${quality?.label ?? '所选音质'}…`
      }
      if (isCustomTrack.value) {
        return customPlaybackMode.value === 'segmented'
          ? `正在准备第 ${customSegmentIndex.value + 1} 个流式片段…`
          : customFallbackMessage.value || '正在生成兼容播放音频…'
      }
      return '正在按需解析音频流…'
    }
    if (isSegmentedCustomPlayback.value) {
      const prefix = customFallbackMessage.value ? `${customFallbackMessage.value} · ` : ''
      return `${prefix}分段流式 ${formatTime(customPositionMs.value)} / ${formatTime(customDurationMs.value)}`
    }
    if (
      isCustomTrack.value &&
      customPlaybackMode.value === 'rendered' &&
      customFallbackMessage.value
    ) {
      return `${customFallbackMessage.value} · ${props.track?.artists.map((artist) => artist.name).join(' / ')}`
    }
    if (props.track) return props.track.artists.map((artist) => artist.name).join(' / ')
    return '从列表选择一首音乐'
  })

  watch([() => props.track, () => props.virtualSegments], ([track]) => loadCurrentTrack(track))

  async function loadCurrentTrack(track: Track | undefined, startPositionMs = 0) {
    resetPlaybackSession()
    if (!track) {
      status.value = 'idle'
      return
    }

    if (props.playbackEnvironment?.isBlocked()) {
      parkInterruptedPlayback(startPositionMs, track.durationMs)
      return
    }

    if (track.source.mediaKind === 'custom') {
      customDurationMs.value = getCompiledDurationMs(props.virtualSegments ?? [])
      if (customDurationMs.value <= 0) {
        setError(createAppErrorState('media-unavailable', '自定义歌曲没有可播放的叶子片段。'))
        return
      }
      if (props.playbackEnvironment?.preferMediaElement) {
        customPlaybackMode.value = 'segmented'
        const target = createCustomSegmentSeekTarget(props.virtualSegments ?? [], startPositionMs)
        const segment = target ? props.virtualSegments?.[target.segmentIndex] : undefined
        if (target && segment)
          await loadCustomSegment(
            target.segmentIndex,
            target.virtualPositionMs - segment.virtualStartMs,
            true,
            target,
          )
      } else {
        customPlaybackMode.value = 'buffered'
        await virtualPlayback.load(props.virtualSegments ?? [], true, startPositionMs)
      }
      return
    }
    await loadTrackMedia(track, { autoplay: true, seekMs: startPositionMs || undefined })
  }

  /** Drop revoked grants/loads while retaining only the logical position for an explicit retry. */
  function parkInterruptedPlayback(positionMs: number, durationMs: number | undefined): void {
    resetPlaybackSession()
    interruptedPositionMs.value = positionMs
    nativePositionMs.value = positionMs
    resolvedNativeDurationMs.value = durationMs
    if (isCustomTrack.value) {
      customPlaybackMode.value = 'segmented'
      customPositionMs.value = positionMs
      customDurationMs.value = getCompiledDurationMs(props.virtualSegments ?? [])
    }
    status.value = 'ready'
    emit('progress', positionMs, durationMs, false)
  }

  function interruptPlayback(): void {
    if (!props.track) return
    parkInterruptedPlayback(displayedPositionMs.value, displayedDurationMs.value)
  }

  const unsubscribePlaybackInterruption =
    props.playbackEnvironment?.subscribeInterruption(interruptPlayback)

  function resetPlaybackSession() {
    interruptedPositionMs.value = undefined
    mediaLoadGeneration += 1
    mediaRequestController.abort()
    mediaRequestController = new AbortController()
    virtualPlayback.reset()
    clearNativeSeekRestart()
    ignoredNativeSeekingPositionMs = undefined
    pendingNativeMediaUrl = undefined
    loadedCustomSegmentIndex = undefined
    isAdvancingCustomSegment = false
    customRenderController?.abort()
    customRenderController = undefined
    activeCompatibilityContext = undefined
    compatibilityLoadController?.abort()
    compatibilityLoadController = undefined
    const previousNativeSession = nativeCompatibilitySession
    nativeCompatibilitySession = undefined
    const element = audio.value
    element?.pause()
    if (element) {
      element.removeAttribute('src')
      element.removeAttribute('referrerpolicy')
      element.load()
    }
    previousNativeSession?.dispose()
    revokeObjectUrls()
    sourceUrls.value = []
    sourceIndex.value = 0
    qualityOptions.value = []
    selectedQualityId.value = undefined
    isQualitySwitching.value = false
    qualityError.value = undefined
    pendingSeekMs.value = undefined
    autoplayAfterLoad.value = false
    isCompatibilityLoading.value = false
    isNativeCompatibilityPlayback.value = false
    compatibilityStage.value = 'idle'
    nativePositionMs.value = 0
    nativeDurationMs.value = undefined
    resolvedNativeDurationMs.value = undefined
    nativeBufferedUntilMs.value = 0
    nativeIsPlaying.value = false
    customPlaybackMode.value = 'buffered'
    customFallbackMessage.value = ''
    customSegmentIndex.value = 0
    customPositionMs.value = 0
    customDurationMs.value = 0
    customBufferedUntilMs.value = 0
    customAutoplayIntent.value = false
    pendingCustomSeek.value = undefined
    resolvedMediaCache.clear()
    for (const source of heldMedia) source.release?.()
    heldMedia.clear()
    playbackAccountIds.clear()
    status.value = 'idle'
    error.value = undefined
    activeMediaTrackId = undefined
    activeMediaTrack = undefined
    activeRemoteSource = undefined
    compatibilityLoadAttempted = false
    compatibilityCompleteLoadAttempted = false
  }

  /**
   * 无法范围预解码的来源继续复用普通播放通道；短时描述按前向窗口并发解析，避免一秒级
   * 片段在每个边界才开始网络请求。该路径也是 Web Audio 预取失败后的第一层兼容兜底。
   */
  async function loadCustomSegment(
    index: number,
    offsetMs: number,
    autoplay: boolean,
    requestedTarget?: CustomSegmentSeekTarget,
  ): Promise<void> {
    const segments = props.virtualSegments ?? []
    const target = requestedTarget ?? createCustomSegmentStartTarget(segments, index, offsetMs)
    const segment = target ? segments[target.segmentIndex] : undefined
    if (!segment || !target) return
    const sourceTrack = props.resolveTrack(segment.sourceTrackId)
    if (!sourceTrack || sourceTrack.source.mediaKind === 'custom') {
      setError(
        createAppErrorState(
          'source-not-found',
          `找不到自定义歌曲的叶子素材：${segment.sourceTrackId}`,
        ),
      )
      return
    }

    beginCustomSegmentSeek(target, autoplay)
    audio.value?.pause()
    // 当前段加载和后续窗口地址解析互不依赖；预热失败会在真正切换时按正常错误路径重试。
    void prefetchCustomSegments(target.segmentIndex + 1)
    await loadTrackMedia(sourceTrack, {
      seekMs: target.sourcePositionMs,
      autoplay,
    })
  }

  /** 换源期间锁住用户选择的虚拟位置，直到正确叶子媒体的原生时钟真正接管。 */
  function beginCustomSegmentSeek(target: CustomSegmentSeekTarget, autoplay: boolean): void {
    customAutoplayIntent.value = autoplay
    customSegmentIndex.value = target.segmentIndex
    customPositionMs.value = target.virtualPositionMs
    customBufferedUntilMs.value = target.virtualPositionMs
    pendingCustomSeek.value = {
      ...target,
    }
  }

  async function prefetchCustomSegments(startIndex: number): Promise<void> {
    const segments = props.virtualSegments ?? []
    const firstSegment = segments[startIndex]
    if (!firstSegment) return
    const chunks = createVirtualPlaybackChunks(segments)
    const window = selectVirtualPlaybackWindow(chunks, firstSegment.virtualStartMs, {
      lookAheadMs: SEGMENTED_PREFETCH_LOOK_AHEAD_MS,
      minimumChunkCount: SEGMENTED_PREFETCH_MINIMUM_CHUNK_COUNT,
      maximumChunkCount: SEGMENTED_PREFETCH_MAXIMUM_CHUNK_COUNT,
    })
    const generation = mediaLoadGeneration
    await preloadVirtualAudioChunks(window, {
      concurrency: SEGMENTED_PREFETCH_CONCURRENCY,
      shouldContinue: () => generation === mediaLoadGeneration && isSegmentedCustomPlayback.value,
      loadChunk: async (chunk) => {
        const track = props.resolveTrack(chunk.sourceTrackId)
        if (!track || track.source.mediaKind === 'custom' || !props.canPrefetchMedia(track)) return
        await getSessionResolvedMedia(track)
      },
    }).catch(() => undefined)
  }

  function getSessionResolvedMedia(track: Track): Promise<ResolvedMediaSource> {
    const cached = resolvedMediaCache.get(track.id)
    if (cached) return cached
    const pending = props
      .resolveMedia(track, getMediaResolveOptions())
      .then((source) => {
        if (resolvedMediaCache.get(track.id) !== pending) {
          source.release?.()
          throw new AppError('operation-cancelled')
        }
        heldMedia.add(source)
        if (source.accountId) playbackAccountIds.add(source.accountId)
        return source
      })
      .catch((cause: unknown) => {
        if (resolvedMediaCache.get(track.id) === pending) resolvedMediaCache.delete(track.id)
        throw cause
      })
    resolvedMediaCache.set(track.id, pending)
    return pending
  }

  function handleBufferedCustomEnded(): void {
    if (props.repeatOne) void virtualPlayback.seek(0, true)
    else emit('ended')
  }

  /** 范围解码不被当前来源或浏览器支持时，保留虚拟位置并退回逐片流式通道。 */
  function handleVirtualPlaybackError(
    cause: unknown,
    positionMs: number,
    autoplayRequested: boolean,
  ): void {
    const rootCause = getRootCause(cause)
    if (rootCause instanceof AppError && rootCause.code === 'operation-cancelled') {
      resetPlaybackSession()
      emit('sourceInvalidated')
      return
    }
    const sourceTrackId = cause instanceof VirtualAudioBufferError ? cause.sourceTrackId : undefined
    // 错误回调可能与滚动窗口的其他 worker 并行；先使整代读取失效，再决定错误或兜底分支。
    virtualPlayback.reset()
    if (rootCause instanceof MusicSourceError && rootCause.code === 'not-authenticated') {
      const appError = toAppErrorState(rootCause, 'media-unavailable', '解析音频失败。')
      setError(appError)
      emit('sessionExpired', appError)
      return
    }
    if (
      rootCause instanceof MusicSourceError &&
      (rootCause.code === 'not-found' ||
        rootCause.code === 'invalid-response' ||
        rootCause.code === 'unsupported-url')
    ) {
      const appError = toAppErrorState(rootCause, 'media-unavailable', '解析音频失败。')
      setError(appError)
      if (sourceTrackId) emit('trackUnavailable', sourceTrackId, appError)
      return
    }
    if (sourceTrackId && !props.resolveTrack(sourceTrackId)) {
      const appError = createAppErrorState(
        'source-not-found',
        `找不到自定义歌曲的叶子素材：${sourceTrackId}`,
      )
      setError(appError)
      emit('trackUnavailable', sourceTrackId, appError)
      return
    }

    customPlaybackMode.value = 'segmented'
    customFallbackMessage.value = '当前来源不支持范围预加载，已切换分段流式播放'
    const target = createCustomSegmentSeekTarget(props.virtualSegments ?? [], positionMs)
    const segment = target ? props.virtualSegments?.[target.segmentIndex] : undefined
    if (!target || !segment) {
      setError(toAppErrorState(rootCause, 'media-unavailable', '预加载音频失败。'))
      return
    }
    void loadCustomSegment(
      target.segmentIndex,
      target.virtualPositionMs - segment.virtualStartMs,
      autoplayRequested,
      target,
    )
  }

  async function loadTrackMedia(track: Track, options: LoadTrackMediaOptions) {
    const generation = ++mediaLoadGeneration
    const previousQualityId = selectedQualityId.value
    activeMediaTrackId = track.id
    activeMediaTrack = track
    status.value = 'resolving'
    error.value = undefined
    qualityError.value = undefined
    isQualitySwitching.value = options.preserveCurrentPlayback === true
    if (options.qualityId) selectedQualityId.value = options.qualityId
    try {
      const source = await resolvePlaybackMedia(track, options.qualityId)
      if (generation !== mediaLoadGeneration) {
        source.release?.()
        return
      }
      heldMedia.add(source)
      if (source.accountId) playbackAccountIds.add(source.accountId)
      const seekMs = options.preserveCurrentPlayback
        ? (readCurrentPlaybackPositionMs() ?? options.seekMs)
        : options.seekMs
      const autoplay = options.preserveCurrentPlayback
        ? isCurrentPlaybackRunning()
        : options.autoplay
      // 只为仍处于活动状态的异步解析创建 Object URL，避免快速切歌遗留已失效的大 Blob。
      applyResolvedQualities(source)
      // 来源描述中的总时长在重建 MediaSource 时仍然稳定，可用于遮蔽 audio 的瞬时 0 / NaN。
      resolvedNativeDurationMs.value = source.durationMs ?? track.durationMs
      applyNativeMediaReferrerPolicy(source)
      activeRemoteSource = source.type === 'remote-url' ? source : undefined
      compatibilityLoadAttempted = false
      compatibilityCompleteLoadAttempted = false
      if (source.type === 'remote-url' && requiresManagedPlayback(source)) {
        await loadCompatibilityMedia(track, source, { seekMs, autoplay })
        return
      }
      stopCompatibilityPlayback()
      const playable = createPlayableMedia(source)
      sourceUrls.value = playable.urls
      sourceIndex.value = 0
      loadCurrentUrl(playable.preload, seekMs, autoplay)
      // 音质切换成功后旧二进制媒体已不再被 audio 使用，立即释放可避免反复切换累积整曲 Blob。
      revokeObjectUrlsExcept(playable.urls)
      if (track.source.mediaKind === 'custom' && customPlaybackMode.value === 'rendered') {
        customFallbackMessage.value = '分段流式不可用，已切换为兼容音频'
      }
      status.value = 'ready'
    } catch (cause) {
      if (generation !== mediaLoadGeneration) return
      const appError = toAppErrorState(cause, 'media-unavailable', '解析音频失败。')
      if (appError.code === 'operation-cancelled') {
        resetPlaybackSession()
        emit('sourceInvalidated')
        return
      }
      if (options.preserveCurrentPlayback) {
        // 切换失败时旧媒体仍然有效；恢复选项并让播放继续，只把失败原因显示给用户。
        selectedQualityId.value = previousQualityId
        qualityError.value = appError
        status.value = 'ready'
        if (cause instanceof MusicSourceError && cause.code === 'not-authenticated') {
          // 保留已加载媒体不代表会话仍然在线；后续平台请求必须停止复用过期登录态。
          emit('sessionExpired', appError)
        }
        return
      }
      setError(appError)
      if (cause instanceof MusicSourceError && cause.code === 'not-authenticated') {
        emit('sessionExpired', appError)
      } else if (
        cause instanceof MusicSourceError &&
        (cause.code === 'not-found' ||
          cause.code === 'invalid-response' ||
          cause.code === 'unsupported-url')
      ) {
        emit('trackUnavailable', track.id, appError)
      }
    } finally {
      if (generation === mediaLoadGeneration) isQualitySwitching.value = false
    }
  }

  function resolvePlaybackMedia(track: Track, qualityId?: string): Promise<ResolvedMediaSource> {
    if (track.source.mediaKind !== 'custom') {
      return isSegmentedCustomPlayback.value && !qualityId
        ? getSessionResolvedMedia(track)
        : props.resolveMedia(track, getMediaResolveOptions(qualityId))
    }

    // 完整 MP3 只保留为分段流式不可用时的兼容兜底，并允许切歌立即中断旧渲染。
    customRenderController?.abort()
    const controller = new AbortController()
    customRenderController = controller
    const generation = mediaLoadGeneration
    return props
      .renderCustomMedia(track, props.virtualSegments ?? [], {
        signal: controller.signal,
        // 完整渲染后叶子 grant 已释放，但当前播放仍属于这些账号。
        onSourceResolved: (source) => {
          if (generation !== mediaLoadGeneration || controller.signal.aborted) {
            source.release?.()
            throw new AppError('operation-cancelled')
          }
          if (source.accountId) playbackAccountIds.add(source.accountId)
        },
      })
      .finally(() => {
        if (customRenderController === controller) customRenderController = undefined
      })
  }

  /** 来源解析与读取同属当前播放会话，平台移除、切歌和卸载会同时撤销它们。 */
  function getMediaResolveOptions(qualityId?: string): MediaResolveOptions {
    const signal = mediaRequestController.signal
    return {
      qualityId,
      cancellation: {
        isCancelled: () => signal.aborted,
        subscribe(listener) {
          signal.addEventListener('abort', listener, { once: true })
          return () => signal.removeEventListener('abort', listener)
        },
      },
    }
  }

  function applyResolvedQualities(source: ResolvedMediaSource): void {
    const qualityIds = new Set<string>()
    const qualities = source.availableQualities.toSorted((left, right) => right.rank - left.rank)
    for (const quality of qualities) {
      if (!quality.id.trim() || !quality.label.trim() || !Number.isFinite(quality.rank)) {
        throw new MusicSourceError('invalid-response', '音乐源返回了无效的音质描述。')
      }
      if (qualityIds.has(quality.id)) {
        throw new MusicSourceError('invalid-response', '音乐源返回了重复的音质 ID。')
      }
      qualityIds.add(quality.id)
    }
    if (qualities.length === 0 || !qualityIds.has(source.quality.id)) {
      throw new MusicSourceError('invalid-response', '当前音质不在音乐源声明的可用列表中。')
    }
    qualityOptions.value = qualities
    selectedQualityId.value = source.quality.id
  }

  /** 在赋值 src 前同步配置来源策略，避免 Vue 下一轮渲染晚于浏览器发起媒体请求。 */
  function applyNativeMediaReferrerPolicy(source: ResolvedMediaSource): void {
    const element = audio.value
    if (!element) return
    const policy =
      source.type === 'remote-url'
        ? selectNativeMediaReferrerPolicy(source, window.location.origin)
        : undefined
    if (policy) element.setAttribute('referrerpolicy', policy)
    else element.removeAttribute('referrerpolicy')
  }

  function createPlayableMedia(source: ResolvedMediaSource): PlayableMedia {
    return source.type === 'complete-binary'
      ? createBinaryPlayable(source)
      : {
          urls: [source.url, ...source.backupUrls],
          preload: source.loadingStrategy === 'eager' ? 'auto' : 'metadata',
        }
  }

  function createBinaryPlayable(source: Extract<ResolvedMediaSource, { type: 'complete-binary' }>) {
    // 复制到明确的 ArrayBuffer，避免 SharedArrayBuffer 进入 Blob，并隔离插件持有的可变视图。
    const buffer = new ArrayBuffer(source.bytes.byteLength)
    new Uint8Array(buffer).set(source.bytes)
    const objectUrl = URL.createObjectURL(new Blob([buffer], { type: source.mimeType }))
    objectUrls.add(objectUrl)
    return { urls: [objectUrl], preload: 'auto' as const }
  }

  function loadCurrentUrl(
    preload: 'auto' | 'metadata',
    seekMs: number | undefined,
    autoplay: boolean,
  ) {
    const element = audio.value
    const url = sourceUrls.value[sourceIndex.value]
    if (!element || !url) return
    ensurePendingCustomSeek(seekMs, autoplay)
    pendingSeekMs.value = seekMs
    autoplayAfterLoad.value = autoplay
    element.src = url
    pendingNativeMediaUrl = normalizeMediaUrl(element.src)
    bindPendingCustomSeekToMedia(element.src)
    element.preload = preload
    element.playbackRate = playbackRate.value
    nativePositionMs.value = seekMs ?? 0
    nativeDurationMs.value = resolvedNativeDurationMs.value
    nativeBufferedUntilMs.value = 0
    element.load()
  }

  function handleLoadedMetadata() {
    if (interruptedPositionMs.value !== undefined) return
    const element = audio.value
    if (!element) return
    if (pendingNativeMediaUrl && !isExpectedMediaResource(element, pendingNativeMediaUrl)) {
      // 快速跨来源 seek 时旧资源可能仍派发已排队的 metadata 事件，不能让它消费新目标。
      return
    }
    if (pendingSeekMs.value !== undefined) {
      // 换源后的定位是当前重建流程的一部分，不应被原生 seeking 事件误判为第二次用户拖动。
      ignoredNativeSeekingPositionMs = pendingSeekMs.value
      try {
        element.currentTime = pendingSeekMs.value / 1000
      } catch {
        // 个别媒体会在 duration 就绪前先派发一次 metadata；保留目标等待下一次有效事件。
        return
      }
    }
    const customSeek = pendingCustomSeek.value
    if (customSeek?.mediaUrl && isExpectedMediaResource(element, customSeek.mediaUrl)) {
      loadedCustomSegmentIndex = customSeek.segmentIndex
    }
    updateNativeMediaState()
    // 原生时钟已接管目标位置后再释放占位值，避免换源事件将可见进度短暂写回 0。
    pendingSeekMs.value = undefined
    pendingNativeMediaUrl = undefined
    settlePendingCustomSeek()
    if (
      !props.playbackEnvironment?.isBlocked() &&
      interruptedPositionMs.value === undefined &&
      (autoplayAfterLoad.value || (isSegmentedCustomPlayback.value && customAutoplayIntent.value))
    ) {
      void element.play().catch(() => undefined)
    }
    autoplayAfterLoad.value = false
  }

  function handleMediaError() {
    if (interruptedPositionMs.value !== undefined) return
    const element = audio.value
    const autoplay = isSegmentedCustomPlayback.value
      ? readCustomAutoplayIntent()
      : shouldAutoplayNativeFallback(autoplayAfterLoad.value, element?.paused ?? true)
    if (nativeCompatibilitySession) {
      void fallbackFromNativeCompatibility(nativeCompatibilitySession)
      return
    }
    if (sourceIndex.value + 1 < sourceUrls.value.length) {
      const resumeAtMs = readFallbackResumePositionMs(element)
      sourceIndex.value += 1
      loadCurrentUrl(element?.preload === 'auto' ? 'auto' : 'metadata', resumeAtMs, autoplay)
      return
    }
    if (!compatibilityLoadAttempted && activeRemoteSource && activeMediaTrack) {
      void loadCompatibilityMedia(activeMediaTrack, activeRemoteSource, {
        seekMs: readFallbackResumePositionMs(element),
        autoplay,
      })
      return
    }
    if (
      compatibilityStage.value === 'extracting' &&
      !compatibilityCompleteLoadAttempted &&
      activeRemoteSource &&
      activeMediaTrack
    ) {
      compatibilityCompleteLoadAttempted = true
      void loadCompleteCompatibilityMedia(
        activeMediaTrack,
        activeRemoteSource,
        {
          seekMs: readFallbackResumePositionMs(element),
          autoplay,
        },
        mediaLoadGeneration,
      )
      return
    }
    finishMediaFailure()
  }

  /** 备用 URL 或兼容通道换源也要保护当前自定义歌曲位置，不能只保护显式拖动。 */
  function ensurePendingCustomSeek(seekMs: number | undefined, autoplay: boolean): void {
    if (!isSegmentedCustomPlayback.value || pendingCustomSeek.value || seekMs === undefined) return
    const segments = props.virtualSegments ?? []
    const segmentIndex = loadedCustomSegmentIndex ?? customSegmentIndex.value
    const segment = segments[segmentIndex]
    if (!segment) return
    const target = createCustomSegmentStartTarget(segments, segmentIndex, seekMs - segment.startMs)
    if (target) beginCustomSegmentSeek(target, autoplay)
  }

  /**
   * 原生节点不能满足跨站请求头时，先用 GM Range 抽取音轨并通过 MSE 交回原生 audio；
   * 浏览器不接受该编码时生成音频专用 Object URL，最后才完整读取原媒体兜底。
   */
  async function loadCompatibilityMedia(
    track: Track,
    source: RemoteResolvedMediaSource,
    options: { seekMs?: number; autoplay: boolean },
  ) {
    compatibilityLoadAttempted = true
    const generation = mediaLoadGeneration
    compatibilityLoadController?.abort()
    compatibilityLoadController = undefined
    activeCompatibilityContext = { track, source, generation }
    compatibilityStage.value = 'media-source'
    isCompatibilityLoading.value = true
    status.value = 'resolving'
    try {
      await loadNativeCompatibilityMedia(track, source, options, generation)
      return
    } catch (cause) {
      if (generation !== mediaLoadGeneration) return
      if (compatibilityStage.value !== 'media-source') return
      await continueAfterNativeCompatibilityFailure(track, source, options, generation, cause)
      return
    }
  }

  /**
   * MSE 把 GM Range 抽取出的音轨交给原生 audio；首个媒体碎片进入 buffered 后就解除加载态，
   * 后续音频包继续在后台写入，不阻塞原生控制条。
   */
  async function loadNativeCompatibilityMedia(
    track: Track,
    source: RemoteResolvedMediaSource,
    options: { seekMs?: number; autoplay: boolean },
    generation: number,
  ): Promise<void> {
    const previousNativeSession = nativeCompatibilitySession
    nativeCompatibilitySession = undefined
    previousNativeSession?.dispose()
    clearNativeMedia()
    const session = new NativeCompatibleAudioSession(track, source, {
      getPlaybackPositionSeconds: () => audio.value?.currentTime ?? 0,
      startTimeSeconds: (options.seekMs ?? 0) / 1_000,
    })
    nativeCompatibilitySession = session
    isNativeCompatibilityPlayback.value = true
    sourceUrls.value = [session.url]
    sourceIndex.value = 0
    loadCurrentUrl('metadata', options.seekMs, options.autoplay)

    try {
      await session.start()
      if (generation !== mediaLoadGeneration || nativeCompatibilitySession !== session) return
      isCompatibilityLoading.value = false
      status.value = 'ready'
      void session.whenComplete().catch((cause: unknown) => {
        void fallbackFromNativeCompatibility(session, cause)
      })
    } catch (cause) {
      if (nativeCompatibilitySession === session) {
        nativeCompatibilitySession = undefined
        isNativeCompatibilityPlayback.value = false
        clearNativeMedia()
        session.dispose()
      }
      throw cause
    }
  }

  async function fallbackFromNativeCompatibility(
    session: NativeCompatibleAudioSession,
    cause: unknown = session.failure,
  ): Promise<void> {
    const context = activeCompatibilityContext
    if (!context || nativeCompatibilitySession !== session) return
    const element = audio.value
    const seekMs = readFallbackResumePositionMs(element)
    const autoplay = isSegmentedCustomPlayback.value
      ? readCustomAutoplayIntent()
      : element !== null && !element.paused
    nativeCompatibilitySession = undefined
    isNativeCompatibilityPlayback.value = false
    clearNativeMedia()
    session.dispose()
    isCompatibilityLoading.value = true
    status.value = 'resolving'
    await continueAfterNativeCompatibilityFailure(
      context.track,
      context.source,
      { seekMs, autoplay },
      context.generation,
      cause,
    )
  }

  /** Range 输入本身不可用时，音轨抽取只会重复相同探测，因此直接进入完整媒体兜底。 */
  async function continueAfterNativeCompatibilityFailure(
    track: Track,
    source: RemoteResolvedMediaSource,
    options: { seekMs?: number; autoplay: boolean },
    generation: number,
    cause: unknown,
  ): Promise<void> {
    if (shouldSkipNativeAudioExtraction(cause)) {
      compatibilityCompleteLoadAttempted = true
      await loadCompleteCompatibilityMedia(track, source, options, generation)
      return
    }
    await loadExtractedCompatibilityMedia(track, source, options, generation)
  }

  /** MSE 不可用时只抽取音轨生成原生媒体，避免再次显示独立的 Web Audio 控制条。 */
  async function loadExtractedCompatibilityMedia(
    track: Track,
    source: RemoteResolvedMediaSource,
    options: { seekMs?: number; autoplay: boolean },
    generation: number,
  ): Promise<void> {
    if (generation !== mediaLoadGeneration) return
    compatibilityStage.value = 'extracting'
    isNativeCompatibilityPlayback.value = false
    compatibilityLoadController?.abort()
    const controller = new AbortController()
    compatibilityLoadController = controller
    isCompatibilityLoading.value = true
    status.value = 'resolving'
    clearNativeMedia()
    revokeObjectUrls()
    try {
      const file = await createNativeCompatibleAudioFile(track, source, {
        signal: controller.signal,
      })
      if (controller.signal.aborted || generation !== mediaLoadGeneration) return
      const playable = createBinaryPlayable({
        type: 'complete-binary',
        bytes: file.bytes,
        mimeType: file.mimeType,
        quality: source.quality,
        availableQualities: source.availableQualities,
        durationMs: source.durationMs,
        loadingStrategy: 'eager',
      })
      sourceUrls.value = playable.urls
      sourceIndex.value = 0
      loadCurrentUrl(playable.preload, options.seekMs, options.autoplay)
      status.value = 'ready'
    } catch {
      if (controller.signal.aborted || generation !== mediaLoadGeneration) return
      compatibilityCompleteLoadAttempted = true
      await loadCompleteCompatibilityMedia(track, source, options, generation)
    } finally {
      if (compatibilityLoadController === controller) compatibilityLoadController = undefined
      if (generation === mediaLoadGeneration) isCompatibilityLoading.value = false
    }
  }

  /** Range 不可用或音轨抽取失败时完整读取原媒体，保证所有成功路径仍交给原生 audio。 */
  async function loadCompleteCompatibilityMedia(
    track: Track,
    source: RemoteResolvedMediaSource,
    options: { seekMs?: number; autoplay: boolean },
    generation: number,
  ) {
    activeCompatibilityContext = undefined
    nativeCompatibilitySession?.dispose()
    nativeCompatibilitySession = undefined
    isNativeCompatibilityPlayback.value = false
    compatibilityStage.value = 'complete'
    compatibilityLoadController?.abort()
    const controller = new AbortController()
    compatibilityLoadController = controller
    isCompatibilityLoading.value = true
    status.value = 'resolving'
    clearNativeMedia()
    revokeObjectUrls()
    try {
      const file = await props.loadMediaFile(track, source, { signal: controller.signal })
      if (controller.signal.aborted || generation !== mediaLoadGeneration) return
      const playable = createBinaryPlayable({
        type: 'complete-binary',
        bytes: file.bytes,
        mimeType: file.mimeType || source.mimeType || 'audio/mp4',
        quality: source.quality,
        availableQualities: source.availableQualities,
        durationMs: source.durationMs,
        loadingStrategy: 'eager',
      })
      sourceUrls.value = playable.urls
      sourceIndex.value = 0
      loadCurrentUrl(playable.preload, options.seekMs, options.autoplay)
      status.value = 'ready'
    } catch {
      if (controller.signal.aborted || generation !== mediaLoadGeneration) return
      finishMediaFailure()
    } finally {
      if (compatibilityLoadController === controller) compatibilityLoadController = undefined
      if (generation === mediaLoadGeneration) isCompatibilityLoading.value = false
    }
  }

  function stopCompatibilityPlayback(): void {
    activeCompatibilityContext = undefined
    compatibilityLoadController?.abort()
    compatibilityLoadController = undefined
    nativeCompatibilitySession?.dispose()
    nativeCompatibilitySession = undefined
    isNativeCompatibilityPlayback.value = false
    isCompatibilityLoading.value = false
    compatibilityStage.value = 'idle'
  }

  function clearNativeMedia(): void {
    const element = audio.value
    element?.pause()
    if (!element) return
    element.removeAttribute('src')
    element.load()
  }

  /** 仅撤销当前播放会话创建的 Blob URL，远程短时 URL 仍由平台解析器管理。 */
  function revokeObjectUrls(): void {
    for (const url of objectUrls) URL.revokeObjectURL(url)
    objectUrls.clear()
  }

  function revokeObjectUrlsExcept(retainedUrls: readonly string[]): void {
    const retained = new Set(retainedUrls)
    for (const url of objectUrls) {
      if (retained.has(url)) continue
      URL.revokeObjectURL(url)
      objectUrls.delete(url)
    }
  }

  function finishMediaFailure() {
    activeCompatibilityContext = undefined
    compatibilityLoadController?.abort()
    compatibilityLoadController = undefined
    nativeCompatibilitySession?.dispose()
    nativeCompatibilitySession = undefined
    isNativeCompatibilityPlayback.value = false
    isCompatibilityLoading.value = false
    compatibilityStage.value = 'idle'
    const customTrack = isSegmentedCustomPlayback.value ? props.track : undefined
    if (customTrack?.source.mediaKind === 'custom') {
      const seekMs = customPositionMs.value
      const autoplay = customAutoplayIntent.value
      // 叶子媒体的所有流式路径都失败后才生成完整音频；切换模式可防止兼容音频失败时递归回退。
      pendingCustomSeek.value = undefined
      loadedCustomSegmentIndex = undefined
      customPlaybackMode.value = 'rendered'
      customFallbackMessage.value = '分段流式不可用，正在生成兼容播放音频…'
      void loadTrackMedia(customTrack, { seekMs, autoplay })
      return
    }
    const mediaError = createAppErrorState(
      'media-unavailable',
      '原生节点与跨站兼容通道均播放失败，请重新解析。',
    )
    setError(mediaError)
    if (activeMediaTrackId) {
      emit('trackUnavailable', activeMediaTrackId, mediaError)
    }
  }

  function handleTimeUpdate() {
    if (interruptedPositionMs.value !== undefined) return
    updateNativeMediaState()
    if (isSegmentedCustomPlayback.value) {
      settlePendingCustomSeek()
      const pendingSeek = pendingCustomSeek.value
      if (pendingSeek) {
        customPositionMs.value = pendingSeek.virtualPositionMs
        emit('progress', pendingSeek.virtualPositionMs, customDurationMs.value, false)
        return
      }
      const segmentIndex = loadedCustomSegmentIndex ?? customSegmentIndex.value
      const segment = props.virtualSegments?.[segmentIndex]
      if (!segment) return
      if (nativePositionMs.value >= segment.endMs - 40) {
        void advanceCustomSegment()
        return
      }
      customPositionMs.value = Math.min(
        segment.virtualEndMs,
        segment.virtualStartMs + Math.max(0, nativePositionMs.value - segment.startMs),
      )
      emit('progress', customPositionMs.value, customDurationMs.value, false)
      return
    }
    emit('progress', nativePositionMs.value, nativeDurationMs.value, false)
  }

  function handleEnded() {
    if (interruptedPositionMs.value !== undefined) return
    if (isSegmentedCustomPlayback.value) {
      // 换源时收到的旧 ended 事件不属于目标片段；正确媒体就绪后会解除 seek 锁。
      if (pendingCustomSeek.value) return
      void advanceCustomSegment()
      return
    }
    const durationMs = audio.value ? getOrdinaryDurationMs(audio.value) : props.track?.durationMs
    customAutoplayIntent.value = false
    autoplayAfterLoad.value = false
    nativeIsPlaying.value = false
    nativePositionMs.value = durationMs ?? nativePositionMs.value
    nativeDurationMs.value = durationMs
    emit('progress', durationMs ?? 0, durationMs, true)
    if (!props.repeatOne) emit('ended')
  }

  async function advanceCustomSegment(): Promise<void> {
    if (
      isAdvancingCustomSegment ||
      interruptedPositionMs.value !== undefined ||
      props.playbackEnvironment?.isBlocked() ||
      !customAutoplayIntent.value
    )
      return
    isAdvancingCustomSegment = true
    audio.value?.pause()
    const nextIndex = (loadedCustomSegmentIndex ?? customSegmentIndex.value) + 1
    try {
      if (nextIndex < (props.virtualSegments?.length ?? 0)) {
        await loadCustomSegment(nextIndex, 0, true)
        return
      }
      customPositionMs.value = customDurationMs.value
      customBufferedUntilMs.value = customDurationMs.value
      emit('progress', customDurationMs.value, customDurationMs.value, true)
      if (props.repeatOne) await loadCustomSegment(0, 0, true)
      else {
        customAutoplayIntent.value = false
        emit('ended')
      }
    } finally {
      isAdvancingCustomSegment = false
    }
  }

  function seekBy(seconds: number) {
    handlePrecisionSeek(displayedPositionMs.value + seconds * 1_000)
  }

  function setPlaybackRate(nextRate: number) {
    if (!Number.isFinite(nextRate) || nextRate <= 0) return
    playbackRate.value = nextRate
    if (isBufferedCustomPlayback.value) virtualPlayback.setPlaybackRate(playbackRate.value)
    if (audio.value) audio.value.playbackRate = playbackRate.value
  }

  /** 原生媒体与自定义片段共用一次音量设置，切换播放通道时不丢失用户的选择。 */
  function setVolume(nextVolume: number): void {
    if (!Number.isFinite(nextVolume)) return
    volume.value = Math.min(1, Math.max(0, nextVolume))
    if (audio.value) audio.value.volume = volume.value
    virtualPlayback.setVolume(volume.value)
  }

  function handleNativePlay(): void {
    if (props.playbackEnvironment?.isBlocked() || interruptedPositionMs.value !== undefined) {
      interruptPlayback()
      return
    }
    nativeIsPlaying.value = true
    if (isSegmentedCustomPlayback.value) customAutoplayIntent.value = true
  }

  /** The play event records intent; playing confirms that the resource can actually start. */
  function handleNativePlaying(): void {
    if (activeMediaTrackId) emit('trackAvailable', activeMediaTrackId)
  }

  function handleNativePause(): void {
    nativeIsPlaying.value = false
    // Source replacement also emits pause. Only a pause of the settled leaf clears intent;
    // WebView may resume that same leaf after transient focus gain.
    if (
      props.playbackEnvironment &&
      !audio.value?.ended &&
      !pendingCustomSeek.value &&
      !isAdvancingCustomSegment &&
      !pendingNativeMediaUrl
    ) {
      customAutoplayIntent.value = false
      autoplayAfterLoad.value = false
    }
  }

  function toggleCustomPlayback(): void {
    if (props.playbackEnvironment?.isBlocked()) return
    if (interruptedPositionMs.value !== undefined) {
      const durationMs = displayedDurationMs.value
      const positionMs = interruptedPositionMs.value
      void loadCurrentTrack(
        props.track,
        durationMs !== undefined && positionMs >= durationMs ? 0 : positionMs,
      )
      return
    }
    if (isBufferedCustomPlayback.value) {
      void virtualPlayback.toggle()
      return
    }
    if (
      isSegmentedCustomPlayback.value &&
      customDurationMs.value > 0 &&
      customPositionMs.value >= customDurationMs.value
    ) {
      void loadCustomSegment(0, 0, true)
      return
    }
    const element = audio.value
    if (!element) return
    if (customAutoplayIntent.value || nativeIsPlaying.value || autoplayAfterLoad.value) {
      customAutoplayIntent.value = false
      autoplayAfterLoad.value = false
      element.pause()
      return
    }

    customAutoplayIntent.value = true
    if (status.value === 'resolving') {
      autoplayAfterLoad.value = true
      return
    }
    void element.play().catch(() => {
      customAutoplayIntent.value = false
    })
  }

  /** 精细进度条按当前模式路由到虚拟时钟或原生媒体元素。 */
  function handlePrecisionSeek(positionMs: number): void {
    if (interruptedPositionMs.value !== undefined) {
      const durationMs = displayedDurationMs.value
      const nextPositionMs = Math.max(0, Math.min(positionMs, durationMs ?? positionMs))
      interruptedPositionMs.value = nextPositionMs
      nativePositionMs.value = nextPositionMs
      customPositionMs.value = nextPositionMs
      emit('progress', nextPositionMs, durationMs, false)
      return
    }
    if (isBufferedCustomPlayback.value) {
      void virtualPlayback.seek(positionMs, virtualPlayback.isPlaying.value)
      return
    }
    if (isSegmentedCustomPlayback.value) {
      handleCustomSegmentSeek(positionMs)
      return
    }
    const element = audio.value
    if (!element) return
    const durationMs = getOrdinaryDurationMs(element)
    if (durationMs === undefined) return
    const nextPositionMs = clampPlaybackPositionMs(positionMs, durationMs)
    const autoplay = shouldAutoplayAfterManagedSeek(autoplayAfterLoad.value, element.paused)
    if (
      shouldRestartManagedPlaybackForSeek(
        nativeCompatibilitySession !== undefined,
        element.buffered,
        nextPositionMs / 1_000,
      )
    ) {
      restartNativeCompatibilityAt(nextPositionMs, autoplay)
    } else {
      writeNativeSeek(element, nextPositionMs, durationMs)
    }
    nativePositionMs.value = nextPositionMs
    emit('progress', nextPositionMs, durationMs, false)
  }

  /** 同一叶子内直接 seek；只有跨来源或 MSE 窗口外目标才重建流。 */
  function handleCustomSegmentSeek(positionMs: number): void {
    const segments = props.virtualSegments ?? []
    const target = createCustomSegmentSeekTarget(segments, positionMs)
    const segment = target ? segments[target.segmentIndex] : undefined
    if (!target || !segment) return
    const autoplay = readCustomAutoplayIntent()
    const element = audio.value
    const canSeekLoadedSegment =
      element !== null &&
      status.value === 'ready' &&
      loadedCustomSegmentIndex === target.segmentIndex &&
      activeMediaTrackId === segment.sourceTrackId &&
      Boolean(element.currentSrc)

    if (!canSeekLoadedSegment || !element) {
      void loadCustomSegment(
        target.segmentIndex,
        target.virtualPositionMs - segment.virtualStartMs,
        autoplay,
        target,
      )
      return
    }

    beginCustomSegmentSeek(target, autoplay)
    if (
      shouldRestartManagedPlaybackForSeek(
        nativeCompatibilitySession !== undefined,
        element.buffered,
        target.sourcePositionMs / 1_000,
      )
    ) {
      restartNativeCompatibilityAt(target.sourcePositionMs, autoplay)
      return
    }

    bindPendingCustomSeekToMedia(element.currentSrc)
    const durationMs = getOrdinaryDurationMs(element)
    if (durationMs === undefined) {
      void loadCustomSegment(
        target.segmentIndex,
        target.virtualPositionMs - segment.virtualStartMs,
        autoplay,
        target,
      )
      return
    }
    writeNativeSeek(element, target.sourcePositionMs, durationMs)
    nativePositionMs.value = target.sourcePositionMs
    customPositionMs.value = target.virtualPositionMs
    settlePendingCustomSeek()
    emit('progress', target.virtualPositionMs, customDurationMs.value, false)
  }

  /** 原生 controls 的拖动也必须覆盖窗口外 seek；短防抖防止拖动滑块时反复重建网络会话。 */
  function handleNativeSeeking(): void {
    updateNativeMediaState()
    const element = audio.value
    const positionMs = readNativePositionMs(element)
    if (!element || positionMs === undefined) return
    if (
      ignoredNativeSeekingPositionMs !== undefined &&
      Math.abs(ignoredNativeSeekingPositionMs - positionMs) < 100
    ) {
      // 部分浏览器会为同一次程序化定位发送多次 seeking；直到 seeked 才解除抑制。
      return
    }
    ignoredNativeSeekingPositionMs = undefined
    if (
      !shouldRestartManagedPlaybackForSeek(
        nativeCompatibilitySession !== undefined,
        element.buffered,
        positionMs / 1_000,
      )
    ) {
      clearNativeSeekRestart()
      return
    }

    clearNativeSeekRestart()
    nativeSeekRestartTimer = globalThis.setTimeout(() => {
      nativeSeekRestartTimer = undefined
      const currentElement = audio.value
      const currentPositionMs = readNativePositionMs(currentElement)
      if (
        !currentElement ||
        currentPositionMs === undefined ||
        !shouldRestartManagedPlaybackForSeek(
          nativeCompatibilitySession !== undefined,
          currentElement.buffered,
          currentPositionMs / 1_000,
        )
      ) {
        return
      }
      restartNativeCompatibilityAt(
        currentPositionMs,
        shouldAutoplayAfterManagedSeek(autoplayAfterLoad.value, currentElement.paused),
      )
    }, 120)
  }

  function handleNativeSeeked(): void {
    ignoredNativeSeekingPositionMs = undefined
    updateNativeMediaState()
    settlePendingCustomSeek()
    const element = audio.value
    const positionMs = readNativePositionMs(element)
    if (
      element &&
      positionMs !== undefined &&
      !shouldRestartManagedPlaybackForSeek(
        nativeCompatibilitySession !== undefined,
        element.buffered,
        positionMs / 1_000,
      )
    ) {
      clearNativeSeekRestart()
    }
  }

  function restartNativeCompatibilityAt(positionMs: number, autoplay: boolean): void {
    const context = activeCompatibilityContext
    if (!context || !nativeCompatibilitySession) return
    clearNativeSeekRestart()
    // 在旧 MediaSource 被清理前先锁定可见目标，遮蔽重建期间产生的 0 秒 timeupdate。
    pendingSeekMs.value = positionMs
    nativePositionMs.value = positionMs
    // 新 generation 让旧 seek 的启动失败/兜底无权覆盖最后一次用户选择。
    const generation = ++mediaLoadGeneration
    void loadCompatibilityMedia(context.track, context.source, {
      seekMs: positionMs,
      autoplay,
    }).catch(() => {
      if (generation !== mediaLoadGeneration) return
      finishMediaFailure()
    })
  }

  function writeNativeSeek(
    element: HTMLAudioElement,
    positionMs: number,
    durationMs: number,
  ): void {
    ignoredNativeSeekingPositionMs = positionMs
    if (seekNativeMedia(element, positionMs, durationMs) === undefined) {
      ignoredNativeSeekingPositionMs = undefined
    }
  }

  function bindPendingCustomSeekToMedia(mediaUrl: string): void {
    const pendingSeek = pendingCustomSeek.value
    if (!pendingSeek) return
    pendingCustomSeek.value = {
      ...pendingSeek,
      mediaUrl: normalizeMediaUrl(mediaUrl),
    }
  }

  /** 旧片段即使回报相同秒数，也必须等目标资源与目标片段同时匹配后才能解除锁定。 */
  function settlePendingCustomSeek(): boolean {
    const pendingSeek = pendingCustomSeek.value
    const element = audio.value
    if (
      !pendingSeek?.mediaUrl ||
      !element ||
      !isExpectedMediaResource(element, pendingSeek.mediaUrl) ||
      !hasReachedCustomSegmentSeekTarget(
        pendingSeek,
        loadedCustomSegmentIndex,
        readNativePositionMs(element),
      )
    ) {
      return false
    }
    customPositionMs.value = pendingSeek.virtualPositionMs
    pendingCustomSeek.value = undefined
    return true
  }

  function isExpectedMediaResource(element: HTMLAudioElement, expectedUrl: string): boolean {
    if (element.readyState < 1) return false
    const currentSourceMatches =
      Boolean(element.currentSrc) && normalizeMediaUrl(element.currentSrc) === expectedUrl
    // load() 会同步清空 readyState；因此这个分支既容纳 CDN 重定向后的 currentSrc，
    // 又不会把新 src 赋值后仍排队的旧 metadata 事件认作新资源。
    const assignedSourceHasMetadata = normalizeMediaUrl(element.src) === expectedUrl
    return currentSourceMatches || assignedSourceHasMetadata
  }

  function clearNativeSeekRestart(): void {
    if (nativeSeekRestartTimer === undefined) return
    globalThis.clearTimeout(nativeSeekRestartTimer)
    nativeSeekRestartTimer = undefined
  }

  /** 同步原生进度、时长和缓冲末端，供精细进度条显示而不接管播放状态。 */
  function updateNativeMediaState(): void {
    if (interruptedPositionMs.value !== undefined) return
    const element = audio.value
    if (!element) return
    nativePositionMs.value = readNativePositionMs(element) ?? 0
    nativeDurationMs.value = getOrdinaryDurationMs(element)

    let bufferedUntilMs = 0
    for (let index = 0; index < element.buffered.length; index += 1) {
      bufferedUntilMs = Math.max(bufferedUntilMs, element.buffered.end(index) * 1_000)
    }
    nativeBufferedUntilMs.value = nativeDurationMs.value
      ? Math.min(bufferedUntilMs, nativeDurationMs.value)
      : bufferedUntilMs

    const segment = isSegmentedCustomPlayback.value
      ? props.virtualSegments?.[customSegmentIndex.value]
      : undefined
    if (segment) {
      if (pendingCustomSeek.value) {
        customBufferedUntilMs.value = pendingCustomSeek.value.virtualPositionMs
        return
      }
      customBufferedUntilMs.value = Math.min(
        segment.virtualEndMs,
        segment.virtualStartMs + Math.max(0, bufferedUntilMs - segment.startMs),
      )
    }
  }

  function selectQuality(qualityId: string): void {
    if (interruptedPositionMs.value !== undefined || props.playbackEnvironment?.isBlocked()) return
    if (!props.track) return
    if (!qualityId || qualityId === selectedQualityId.value) return
    void loadTrackMedia(props.track, {
      autoplay: false,
      qualityId,
      preserveCurrentPlayback: true,
    })
  }

  function requestDownload(): void {
    if (!props.track || props.downloadBusy) return
    // 下载必须回到应用导出管线，不能直接保存会过期且可能返回风控 HTML 的 CDN 地址。
    emit('download', props.track)
  }

  function setError(nextError: AppErrorState) {
    status.value = 'error'
    error.value = nextError
  }

  function getOrdinaryDurationMs(element: HTMLAudioElement): number | undefined {
    return Number.isFinite(element.duration)
      ? element.duration * 1000
      : (resolvedNativeDurationMs.value ?? props.track?.durationMs)
  }

  function readFallbackResumePositionMs(element: HTMLAudioElement | null): number | undefined {
    return selectPlaybackResumePositionMs({
      customSourcePositionMs: isSegmentedCustomPlayback.value
        ? pendingCustomSeek.value?.sourcePositionMs
        : undefined,
      pendingNativePositionMs: pendingSeekMs.value,
      nativePositionMs: readNativePositionMs(element),
    })
  }

  function readCurrentPlaybackPositionMs(): number | undefined {
    return isSegmentedCustomPlayback.value
      ? customPositionMs.value
      : readNativePositionMs(audio.value)
  }

  function isCurrentPlaybackRunning(): boolean {
    const element = audio.value
    return element !== null && !element.paused
  }

  /** 自动换源造成的临时 pause 不应覆盖用户在自定义歌曲上的播放意图。 */
  function readCustomAutoplayIntent(): boolean {
    return shouldAutoplayCustomSegment(
      customAutoplayIntent.value,
      nativeIsPlaying.value,
      autoplayAfterLoad.value,
    )
  }

  onScopeDispose(() => {
    unsubscribeSourceInvalidation?.()
    unsubscribePlaybackInterruption?.()
    resetPlaybackSession()
  })

  return {
    errorState: readonly(error),
    retry: () => (status.value === 'error' ? loadCurrentTrack(props.track) : Promise.resolve()),
    displayedBufferedUntilMs,
    displayedDurationMs,
    displayedIsPlaying,
    displayedPositionMs,
    handleEnded,
    handleLoadedMetadata,
    handleMediaError,
    handleNativePause,
    handleNativePlay,
    handleNativePlaying,
    handleNativeSeeked,
    handleNativeSeeking,
    handlePrecisionSeek,
    handleTimeUpdate,
    isControlledCustomPlayback,
    isSeekDisabled,
    playbackRate: readonly(playbackRate),
    qualityOptions: readonly(qualityOptions),
    requestDownload,
    seekBy,
    selectQuality,
    selectedQualityId: readonly(selectedQualityId),
    setPlaybackRate,
    setVolume,
    status: readonly(status),
    statusLabel,
    toggleCustomPlayback,
    updateNativeMediaState,
    volume: readonly(volume),
  }
}
