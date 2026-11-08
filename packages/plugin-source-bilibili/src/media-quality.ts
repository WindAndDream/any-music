import { MusicSourceError } from '@any-music/core'
import type { MediaQuality } from '@any-music/core'

import type { BilibiliDashAudio, BilibiliPlayUrlData } from './types'

export interface BilibiliDashQualityCandidate {
  quality: MediaQuality
  stream: BilibiliDashAudio
}

/**
 * B 站 DASH 音频以接口 bandwidth 为排序事实源；representation id 与编码共同组成会话级选项 ID。
 */
export function createBilibiliDashQualityCandidates(
  streams: readonly BilibiliDashAudio[],
): readonly BilibiliDashQualityCandidate[] {
  const candidates = streams
    .map((stream, index) => {
      const url = stream.baseUrl ?? stream.base_url
      if (!url) return undefined
      const bitrate = readPositiveNumber(stream.bandwidth)
      const codecs = stream.codecs?.trim()
      const sourceId = stream.id === undefined ? `stream-${index + 1}` : String(stream.id)
      const quality: MediaQuality = {
        id: `dash:${sourceId}:${normalizeQualityIdPart(codecs ?? 'unknown')}`,
        label: createQualityLabel({
          bitrate,
          codecs,
          mimeType: stream.mimeType ?? stream.mime_type,
          url,
        }),
        rank: bitrate ?? streams.length - index,
        bitrate,
      }
      return { quality, stream }
    })
    .filter((candidate): candidate is BilibiliDashQualityCandidate => candidate !== undefined)
    .toSorted((left, right) => right.quality.rank - left.quality.rank)

  return deduplicateCandidates(candidates)
}

/** 老音频接口只返回一个 CDN 列表；大小与时长足够时才显示推导出的平均比特率。 */
export function createBilibiliLegacyAudioQuality(
  url: string,
  sizeBytes: number | undefined,
  durationMs: number | undefined,
): MediaQuality {
  const bitrate = inferAverageBitrate(sizeBytes, durationMs)
  return {
    id: 'legacy-audio:default',
    label: createQualityLabel({ bitrate, url }),
    rank: bitrate ?? 1,
    bitrate,
  }
}

/**
 * HTML5 兼容流使用平台 qn 与描述排序，并剔除高于本次实际授权结果的选项，避免把不可用清晰度展示为可切换音质。
 */
export function createBilibiliHtml5Qualities(data: BilibiliPlayUrlData): readonly MediaQuality[] {
  const actualQuality = readPositiveNumber(data.quality)
  const acceptedQualities = data.accept_quality ?? []
  const descriptions = data.accept_description ?? []
  const qualities = acceptedQualities
    .map((quality, index) => ({ quality, description: descriptions[index] }))
    .filter(({ quality }) => Number.isSafeInteger(quality) && quality > 0)
    .filter(({ quality }) => actualQuality === undefined || quality <= actualQuality)
    .map(({ quality, description }, index): MediaQuality => ({
      id: `html5:${quality}`,
      label: `${description?.trim() || `音质 ${index + 1}`} · 兼容流`,
      rank: quality,
    }))

  if (actualQuality !== undefined && !qualities.some((quality) => quality.rank === actualQuality)) {
    qualities.push({
      id: `html5:${actualQuality}`,
      label: `${data.format?.trim() || '音质 1'} · 兼容流`,
      rank: actualQuality,
    })
  }
  if (qualities.length === 0) {
    return [{ id: 'html5:default', label: '音质 1 · 兼容流', rank: 1 }]
  }
  return qualities.toSorted((left, right) => right.rank - left.rank)
}

/** 插件只接受本次解析实际声明的选项，未知 ID 不允许静默降级。 */
export function selectBilibiliQuality<T extends { quality: MediaQuality }>(
  candidates: readonly T[],
  qualityId: string | undefined,
): T {
  const candidate = qualityId
    ? candidates.find((item) => item.quality.id === qualityId)
    : candidates[0]
  if (!candidate) {
    throw new MusicSourceError(
      qualityId ? 'invalid-input' : 'not-found',
      qualityId ? '所选 B 站音质当前不可用。' : 'B 站没有返回可播放的音质。',
    )
  }
  return candidate
}

function deduplicateCandidates(
  candidates: readonly BilibiliDashQualityCandidate[],
): readonly BilibiliDashQualityCandidate[] {
  const ids = new Set<string>()
  return candidates.filter(({ quality }) => {
    if (ids.has(quality.id)) return false
    ids.add(quality.id)
    return true
  })
}

function createQualityLabel(options: {
  bitrate?: number
  codecs?: string
  mimeType?: string
  url?: string
}): string {
  const format = inferFormat(options.codecs, options.mimeType, options.url)
  const parts = [
    format,
    options.bitrate === undefined ? undefined : `${Math.round(options.bitrate / 1_000)} kbps`,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : '音质 1'
}

function inferFormat(codecs?: string, mimeType?: string, url?: string): string | undefined {
  const normalizedCodec = codecs?.toLocaleLowerCase()
  if (normalizedCodec?.startsWith('mp4a')) return 'AAC'
  if (normalizedCodec?.includes('flac')) return 'FLAC'
  if (normalizedCodec?.includes('ec-3')) return 'Dolby Digital Plus'
  const normalizedMimeType = mimeType?.split(';')[0]?.trim().toLocaleLowerCase()
  if (normalizedMimeType === 'audio/mpeg') return 'MP3'
  if (normalizedMimeType === 'audio/flac') return 'FLAC'
  if (normalizedMimeType === 'audio/mp4' || normalizedMimeType === 'audio/m4a') return 'M4A'
  const extension = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url ?? '')?.[1]?.toLocaleLowerCase()
  if (extension === 'mp3') return 'MP3'
  if (extension === 'flac') return 'FLAC'
  if (extension === 'm4a' || extension === 'm4s' || extension === 'mp4') return 'M4A'
  return undefined
}

function inferAverageBitrate(
  sizeBytes: number | undefined,
  durationMs: number | undefined,
): number | undefined {
  const size = readPositiveNumber(sizeBytes)
  const duration = readPositiveNumber(durationMs)
  if (size === undefined || duration === undefined) return undefined
  return Math.round((size * 8 * 1_000) / duration)
}

function readPositiveNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

function normalizeQualityIdPart(value: string): string {
  return encodeURIComponent(value.normalize('NFKC').trim().toLocaleLowerCase())
}
