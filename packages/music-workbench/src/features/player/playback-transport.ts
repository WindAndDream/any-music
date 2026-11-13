import type { RemoteResolvedMediaSource } from '@any-music/core'

interface BufferedMediaRanges {
  readonly length: number
  start(index: number): number
  end(index: number): number
}

export interface PlaybackResumePositionOptions {
  /** 自定义歌曲当前叶子的目标来源时间，优先级最高。 */
  customSourcePositionMs?: number
  /** src 尚未完成 metadata/seek 时仍待应用的原生目标。 */
  pendingNativePositionMs?: number
  /** 媒体元素当前实际位置，只在没有待处理目标时使用。 */
  nativePositionMs?: number
}

/**
 * 原生媒体元素不能设置任意自定义请求头；Referer 是唯一例外，播放器会用 no-referrer
 * 避免把宿主页来源发送给 CDN，并优先保留浏览器自己的流式播放能力。
 */
export function requiresManagedPlayback(source: RemoteResolvedMediaSource): boolean {
  const headers = Object.entries(source.requestHeaders ?? {})
  if (headers.length === 0) return false
  return headers.some(([name]) => name.toLocaleLowerCase() !== 'referer')
}

/** 跨站播放不发送宿主页 Referer；同站播放保留浏览器默认值，兼容要求站内来源的 CDN。 */
export function selectNativeMediaReferrerPolicy(
  source: RemoteResolvedMediaSource,
  currentOrigin: string,
): 'no-referrer' | undefined {
  const referer = Object.entries(source.requestHeaders ?? {}).find(
    ([name]) => name.toLocaleLowerCase() === 'referer',
  )?.[1]
  if (!referer) return undefined
  try {
    return new URL(referer).origin === currentOrigin ? undefined : 'no-referrer'
  } catch {
    return 'no-referrer'
  }
}

/**
 * MSE 只保留播放点附近的有界窗口；seek 到窗口外时必须重建 Range 会话，否则原生元素会
 * 永久等待一个已经被清理、且顺序写入器不会再次生成的时间段。
 */
export function shouldRestartManagedPlaybackForSeek(
  isManagedPlaybackActive: boolean,
  buffered: BufferedMediaRanges,
  positionSeconds: number,
): boolean {
  if (!isManagedPlaybackActive || !Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return false
  }
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= positionSeconds && positionSeconds < buffered.end(index)) {
      return false
    }
  }
  return true
}

/** seek 重建期间沿用用户意图：正在播放或已有待播放请求才在新片段就绪后续播。 */
export function shouldAutoplayAfterManagedSeek(
  hasPendingAutoplay: boolean,
  isMediaPaused: boolean,
): boolean {
  return hasPendingAutoplay || !isMediaPaused
}

/** 备用 URL 延续当前播放意图，避免已暂停的曲目在首个地址失败后自行恢复播放。 */
export function shouldAutoplayNativeFallback(
  hasPendingAutoplay: boolean,
  isMediaPaused: boolean,
): boolean {
  return hasPendingAutoplay || !isMediaPaused
}

/**
 * 媒体失败通常会先把 currentTime 重置为 0；fallback 必须优先沿用尚未落地的逻辑目标，
 * 否则跨叶子 seek 会从原曲开头读取，并在虚拟位置上表现为长时间卡住。
 */
export function selectPlaybackResumePositionMs(
  options: PlaybackResumePositionOptions,
): number | undefined {
  const candidates = [
    options.customSourcePositionMs,
    options.pendingNativePositionMs,
    options.nativePositionMs,
  ]
  return candidates.find(
    (positionMs): positionMs is number =>
      positionMs !== undefined && Number.isFinite(positionMs) && positionMs >= 0,
  )
}
