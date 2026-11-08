import { MusicSourceError, selectMediaLoadingStrategy } from '@any-music/core'
import type { MediaQuality, MediaResolveOptions, ResolvedMediaSource, Track } from '@any-music/core'

import type {
  DouyinAweme,
  DouyinBitRate,
  DouyinMusic,
  DouyinResource,
  DouyinUrlResource,
  DouyinUser,
} from './types'

const PLUGIN_ID = 'douyin'
const EAGER_MEDIA_DURATION_MS = 10 * 60 * 1000

/** 将 API 与详情页回退数据统一映射为可持久化的作品引用。 */
export function mapDouyinAweme(aweme: DouyinAweme): Track | undefined {
  const awemeId = aweme.aweme_id ?? aweme.awemeId
  if (!awemeId) return undefined

  const author = aweme.author ?? aweme.author_info ?? aweme.authorInfo
  const video = aweme.video
  const music = aweme.music
  const isNote = isDouyinNote(aweme)
  const durationMs = normalizeDurationMs(video?.duration, music?.duration)
  const title = firstText(aweme.item_title, aweme.itemTitle, aweme.desc, music?.title)
  const tags = (aweme.text_extra ?? aweme.textExtra ?? [])
    .map((item) => item.hashtag_name ?? item.hashtagName)
    .filter((tag): tag is string => Boolean(tag))
  if (isNote) tags.unshift('图文')

  return {
    id: `${PLUGIN_ID}:video:${awemeId}`,
    title: title || `抖音作品 ${awemeId}`,
    artists: [mapArtist(author, music?.author)],
    artworkUrl: firstUrl(
      aweme.images?.[0],
      video?.cover,
      video?.origin_cover,
      video?.originCover,
      music?.cover_medium,
      music?.coverMedium,
    ),
    durationMs,
    publishedAtMs: toMilliseconds(aweme.create_time ?? aweme.createTime),
    description: aweme.desc,
    sourceTags: [...new Set(tags)],
    statistics: mapStatistics(aweme),
    source: {
      pluginId: PLUGIN_ID,
      mediaKind: 'video',
      resourceId: awemeId,
      partId: isNote ? 'note' : 'video',
      pageUrl: `https://www.douyin.com/${isNote ? 'note' : 'video'}/${awemeId}`,
    },
  }
}

/** 收藏音乐只持久化 music id；播放地址仍由 music/detail 在播放时重新解析。 */
export function mapDouyinMusic(music: DouyinMusic): Track | undefined {
  const musicId = stableMusicId(music)
  if (!musicId) return undefined
  return {
    id: `${PLUGIN_ID}:music:${musicId}`,
    title: music.title?.trim() || `抖音音乐 ${musicId}`,
    artists: [
      { name: music.author || music.owner_nickname || music.ownerNickname || '未知音乐人' },
    ],
    artworkUrl: firstUrl(
      music.cover_large,
      music.coverLarge,
      music.cover_medium,
      music.coverMedium,
      music.cover_thumb,
      music.coverThumb,
    ),
    durationMs: normalizeDurationMs(undefined, music.duration),
    statistics: {
      favoriteCount: music.music_collect_count ?? music.musicCollectCount,
      playCount: music.user_count ?? music.userCount,
    },
    source: {
      pluginId: PLUGIN_ID,
      mediaKind: 'audio',
      resourceId: musicId,
      partId: 'music',
    },
  }
}

/**
 * 普通视频优先真实视频/独立音频流，避免只播放配乐而丢失人声；图文没有视频轨，使用作品配乐。
 */
export function resolveDouyinAwemeMedia(
  aweme: DouyinAweme,
  fallbackDurationMs?: number,
  options: MediaResolveOptions = {},
): ResolvedMediaSource {
  const durationMs =
    normalizeDurationMs(aweme.video?.duration, aweme.music?.duration) ?? fallbackDurationMs
  const candidates = createAwemeQualityCandidates(aweme, durationMs)
  const selected = selectDouyinQuality(candidates, options.qualityId)
  const [url, ...backupUrls] = selected.urls
  if (!url) throw new MusicSourceError('not-found', '抖音未返回该作品的可播放媒体地址。')

  return {
    type: 'remote-url',
    url,
    backupUrls,
    quality: selected.quality,
    availableQualities: candidates.map((candidate) => candidate.quality),
    // GM 兼容回退和导出显式使用目标平台来源；原生播放器则以 no-referrer 避免宿主页污染。
    requestHeaders: { Referer: 'https://www.douyin.com/' },
    mimeType: selected.mimeType,
    durationMs,
    loadingStrategy: selectMediaLoadingStrategy(durationMs, EAGER_MEDIA_DURATION_MS),
  }
}

export function resolveDouyinMusicMedia(
  music: DouyinMusic,
  fallbackDurationMs?: number,
  options: MediaResolveOptions = {},
): ResolvedMediaSource {
  const durationMs = normalizeDurationMs(undefined, music.duration) ?? fallbackDurationMs
  const candidates = createMusicQualityCandidates(music.play_url ?? music.playUrl, durationMs)
  const selected = selectDouyinQuality(candidates, options.qualityId)
  const [url, ...backupUrls] = selected.urls
  if (!url) throw new MusicSourceError('not-found', '抖音未返回该音乐的可播放地址。')
  return {
    type: 'remote-url',
    url,
    backupUrls,
    quality: selected.quality,
    availableQualities: candidates.map((candidate) => candidate.quality),
    requestHeaders: { Referer: 'https://www.douyin.com/' },
    mimeType: selected.mimeType,
    durationMs,
    loadingStrategy: selectMediaLoadingStrategy(durationMs, EAGER_MEDIA_DURATION_MS),
  }
}

export function isDouyinNote(aweme: DouyinAweme): boolean {
  return (aweme.aweme_type ?? aweme.awemeType) === 68 || (aweme.images?.length ?? 0) > 0
}

/** 页面回退只有携带当前会话可解析媒体时才算成功，避免元数据卡片制造 AM-1004。 */
export function hasPlayableDouyinAwemeMedia(aweme: DouyinAweme): boolean {
  const durationMs = normalizeDurationMs(aweme.video?.duration, aweme.music?.duration)
  return createAwemeQualityCandidates(aweme, durationMs).length > 0
}

export function resourceUrls(resource?: DouyinResource | DouyinUrlResource): string[] {
  if (!resource) return []
  if (typeof resource === 'string') return [normalizeUrl(resource)]
  if (Array.isArray(resource)) return resource.map(normalizeUrl).filter(Boolean)
  const objectResource = resource as DouyinUrlResource
  return (objectResource.url_list ?? objectResource.urlList ?? []).map(normalizeUrl).filter(Boolean)
}

function mapArtist(author?: DouyinUser, musicAuthor?: string): Track['artists'][number] {
  return {
    id: author?.sec_uid ?? author?.secUid ?? author?.uid,
    name: author?.nickname || musicAuthor || '未知抖音作者',
  }
}

function mapStatistics(aweme: DouyinAweme): Track['statistics'] {
  const statistics = aweme.statistics
  return {
    playCount: statistics?.play_count ?? statistics?.playCount,
    favoriteCount: statistics?.collect_count ?? statistics?.collectCount,
    commentCount: statistics?.comment_count ?? statistics?.commentCount,
    likeCount: statistics?.digg_count ?? statistics?.diggCount,
  }
}

interface DouyinQualityCandidate {
  quality: MediaQuality
  urls: readonly string[]
  mimeType: string
}

/**
 * 抖音优先暴露独立音频档位；没有独立音频时，只把确认不是 DASH 纯视频轨的完整作品流作为可切换音质。
 */
function createAwemeQualityCandidates(
  aweme: DouyinAweme,
  durationMs: number | undefined,
): readonly DouyinQualityCandidate[] {
  if (isDouyinNote(aweme)) {
    return createMusicQualityCandidates(aweme.music?.play_url ?? aweme.music?.playUrl, durationMs)
  }

  const video = aweme.video
  const audioStreams = video?.bit_rate_audio_list ?? video?.bitRateAudioList ?? []
  const audioCandidates = createBitRateQualityCandidates(audioStreams, 'audio', durationMs)
  if (audioCandidates.length > 0) return audioCandidates

  const directUrls = uniqueUrls([
    ...resourceUrls(video?.play_addr ?? video?.playAddr),
    ...resourceUrls(video?.play_addr_h264 ?? video?.playAddrH264),
  ]).filter((url) => !isSeparateVideoTrackUrl(url))
  if (directUrls.length > 0) {
    const bitrate = inferResourceBitrate(
      video?.play_addr ?? video?.playAddr,
      directUrls[0],
      durationMs,
    )
    return [
      {
        quality: createDouyinQuality('video', undefined, bitrate, directUrls[0], 0, 1),
        urls: directUrls,
        mimeType: inferMimeType('video', video?.play_addr ?? video?.playAddr, directUrls[0]),
      },
    ]
  }

  // bit_rate 在 DASH 响应中主要描述视频 representation；只有缺少完整播放地址时才尽力使用。
  const videoStreams = video?.bit_rate ?? video?.bitRate ?? []
  const videoCandidates = createBitRateQualityCandidates(videoStreams, 'video', durationMs).filter(
    (candidate) => !candidate.urls.every(isSeparateVideoTrackUrl),
  )
  if (videoCandidates.length > 0) return sortAndDeduplicateCandidates(videoCandidates)

  // 普通作品只有在所有完整作品地址都缺失时才回退配乐，避免把背景音乐冒充完整人声。
  return createMusicQualityCandidates(aweme.music?.play_url ?? aweme.music?.playUrl, durationMs)
}

function createBitRateQualityCandidates(
  streams: readonly DouyinBitRate[],
  kind: 'audio' | 'video',
  durationMs: number | undefined,
): DouyinQualityCandidate[] {
  const candidates: DouyinQualityCandidate[] = []
  for (const [index, stream] of streams.entries()) {
    const resource = stream.play_addr ?? stream.playAddr
    const urls = uniqueUrls(resourceUrls(resource))
    const url = urls[0]
    if (!resource || !url) continue
    const declaredBitrate = readPositiveNumber(stream.bit_rate ?? stream.bitRate)
    const bitrate = declaredBitrate ?? inferResourceBitrate(resource, url, durationMs)
    candidates.push({
      // 接口缺少码率时使用其原始高到低顺序作为平台兜底规则，并保留可区分的序号标签。
      quality: createDouyinQuality(kind, stream, bitrate, url, index, streams.length - index),
      urls,
      mimeType: inferMimeType(kind, resource, url),
    })
  }
  return candidates.toSorted((left, right) => right.quality.rank - left.quality.rank)
}

function createMusicQualityCandidates(
  resource: DouyinResource | undefined,
  durationMs: number | undefined,
): readonly DouyinQualityCandidate[] {
  const urls = uniqueUrls(resourceUrls(resource))
  const url = urls[0]
  if (!url) return []
  const bitrate = inferResourceBitrate(resource, url, durationMs)
  return [
    {
      quality: createDouyinQuality('music', undefined, bitrate, url, 0, 1),
      urls,
      mimeType: inferMimeType('audio', resource, url),
    },
  ]
}

function createDouyinQuality(
  kind: 'audio' | 'video' | 'music',
  stream: DouyinBitRate | undefined,
  bitrate: number | undefined,
  url: string | undefined,
  index: number,
  fallbackRank: number,
): MediaQuality {
  const gearName = stream?.gear_name ?? stream?.gearName
  const qualityType = stream?.quality_type ?? stream?.qualityType
  const format = inferFormat(kind, url)
  const gearDescription = describeGearName(gearName)
  const bitrateDescription =
    bitrate === undefined ? undefined : `${Math.round(bitrate / 1_000)} kbps`
  const hasQualityDescription = gearDescription !== undefined || bitrateDescription !== undefined
  const parts = hasQualityDescription
    ? [gearDescription, format, bitrateDescription]
    : [`音质 ${index + 1}`, format]
  const qualityKeyParts: Array<string | number> = [
    kind,
    qualityType ?? 'unknown',
    bitrate ?? 'unknown',
    gearName ?? 'default',
  ]
  // 没有任何平台质量字段时，序号是区分同格式多个候选的唯一稳定会话标识。
  if (qualityType === undefined && bitrate === undefined && !gearName) qualityKeyParts.push(index)
  const qualityKey = qualityKeyParts
    .map((part) => encodeURIComponent(String(part).normalize('NFKC').toLocaleLowerCase()))
    .join(':')
  return {
    id: qualityKey,
    label: parts.filter((part): part is string => Boolean(part)).join(' · '),
    rank: bitrate ?? fallbackRank,
    bitrate,
  }
}

function selectDouyinQuality(
  candidates: readonly DouyinQualityCandidate[],
  qualityId: string | undefined,
): DouyinQualityCandidate {
  const selected = qualityId
    ? candidates.find(({ quality }) => quality.id === qualityId)
    : candidates[0]
  if (!selected) {
    throw new MusicSourceError(
      qualityId ? 'invalid-input' : 'not-found',
      qualityId ? '所选抖音音质当前不可用。' : '抖音未返回可播放的媒体音质。',
    )
  }
  return selected
}

function sortAndDeduplicateCandidates(
  candidates: readonly DouyinQualityCandidate[],
): DouyinQualityCandidate[] {
  const qualityIds = new Set<string>()
  const primaryUrls = new Set<string>()
  return candidates
    .toSorted((left, right) => right.quality.rank - left.quality.rank)
    .filter((candidate) => {
      const primaryUrl = candidate.urls[0]
      if (!primaryUrl || qualityIds.has(candidate.quality.id) || primaryUrls.has(primaryUrl)) {
        return false
      }
      qualityIds.add(candidate.quality.id)
      primaryUrls.add(primaryUrl)
      return true
    })
}

function describeGearName(gearName: string | undefined): string | undefined {
  if (!gearName) return undefined
  const resolution = /(?:^|_)(\d{3,4})(?:_|$)/.exec(gearName)?.[1]
  const profile = gearName.startsWith('normal_')
    ? '标准'
    : gearName.startsWith('adapt_')
      ? '自适应'
      : gearName.startsWith('low_') || gearName.startsWith('lower_')
        ? '低码率'
        : undefined
  const parts = [resolution && `${resolution}P`, profile].filter((part): part is string =>
    Boolean(part),
  )
  return parts.length > 0 ? parts.join(' ') : gearName
}

function inferFormat(
  kind: 'audio' | 'video' | 'music',
  url: string | undefined,
): string | undefined {
  const normalized = url?.toLocaleLowerCase() ?? ''
  if (normalized.includes('media-audio') || kind === 'audio') {
    if (normalized.includes('mp4a')) return 'AAC'
  }
  if (/\.mp3(?:$|[?#])/.test(normalized)) return 'MP3'
  if (/\.(?:m4a|m4s)(?:$|[?#])/.test(normalized)) return 'M4A'
  if (/\.mp4(?:$|[?#])/.test(normalized) || readUrlQueryValue(url, 'mime_type') === 'video_mp4') {
    return kind === 'music' ? 'MP4 音频' : 'MP4'
  }
  return undefined
}

function inferMimeType(
  kind: 'audio' | 'video',
  resource: DouyinResource | undefined,
  url: string | undefined,
): string {
  if (isDouyinUrlResource(resource)) {
    const declared = (resource.mime_type ?? resource.mimeType)?.trim().toLocaleLowerCase()
    if (declared?.startsWith('audio/') || declared?.startsWith('video/')) return declared
  }
  if (/\.mp3(?:$|[?#])/i.test(url ?? '')) return 'audio/mpeg'
  return kind === 'audio' ? 'audio/mp4' : 'video/mp4'
}

function inferResourceBitrate(
  resource: DouyinResource | undefined,
  url: string | undefined,
  durationMs: number | undefined,
): number | undefined {
  const urlBitrate = readPositiveNumber(Number(readUrlQueryValue(url, 'br')) * 1_000)
  if (urlBitrate !== undefined) return urlBitrate
  if (!isDouyinUrlResource(resource)) return undefined
  const sizeBytes = readPositiveNumber(resource.data_size ?? resource.dataSize)
  const duration = readPositiveNumber(durationMs)
  if (sizeBytes === undefined || duration === undefined) return undefined
  return Math.round((sizeBytes * 8 * 1_000) / duration)
}

function readUrlQueryValue(url: string | undefined, key: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).searchParams.get(key) ?? undefined
  } catch {
    return undefined
  }
}

function isSeparateVideoTrackUrl(url: string): boolean {
  try {
    return /\/media-video-(?:avc1|hvc1)\//i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

function readPositiveNumber(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

function isDouyinUrlResource(resource: DouyinResource | undefined): resource is DouyinUrlResource {
  return resource !== undefined && typeof resource === 'object' && !Array.isArray(resource)
}

function firstUrl(
  ...resources: Array<DouyinResource | DouyinUrlResource | undefined>
): string | undefined {
  return resources.flatMap((resource) => resourceUrls(resource)).find(Boolean)
}

function uniqueUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.filter(Boolean))]
}

function normalizeUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`
  return value.replace(/^http:\/\//, 'https://')
}

function normalizeDurationMs(videoDuration?: number, musicDuration?: number): number | undefined {
  if (videoDuration !== undefined && Number.isFinite(videoDuration) && videoDuration > 0) {
    return videoDuration
  }
  if (musicDuration !== undefined && Number.isFinite(musicDuration) && musicDuration > 0) {
    return musicDuration * 1000
  }
  return undefined
}

function toMilliseconds(value?: number): number | undefined {
  return value === undefined ? undefined : value * 1000
}

function firstText(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())?.trim()
}

function stableMusicId(music: DouyinMusic): string | undefined {
  if (music.id_str) return music.id_str
  if (music.idStr) return music.idStr
  if (typeof music.id === 'string') return music.id
  // JSON number 无法无损表示抖音 19 位 ID；没有 id_str 时只接受安全整数。
  return Number.isSafeInteger(music.id) ? String(music.id) : undefined
}
