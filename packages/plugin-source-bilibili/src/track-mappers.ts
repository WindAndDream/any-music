import { MusicSourceError } from '@any-music/core'
import type { Track } from '@any-music/core'

import type {
  BilibiliAudioSong,
  BilibiliFavoriteMedia,
  BilibiliSearchVideo,
  BilibiliSeasonArchive,
  BilibiliUpperVideo,
  BilibiliVideoViewData,
} from './types'

const PLUGIN_ID = 'bilibili'

// Video summaries omit aggregate durations; the plugin fills in the selected part before publishing.
export function mapSearchVideo(video: BilibiliSearchVideo): Track {
  return createVideoTrack({
    bvid: video.bvid,
    title: stripSearchMarkup(video.title),
    artistId: video.mid,
    artistName: video.author,
    artworkUrl: video.pic,
    publishedAtMs: toMilliseconds(video.pubdate),
    description: video.description,
    sourceTags: video.tag
      ?.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    statistics: {
      playCount: video.play,
      danmakuCount: video.video_review,
      favoriteCount: video.favorites,
      commentCount: video.review,
      likeCount: video.like,
    },
  })
}

export function mapUpperVideo(video: BilibiliUpperVideo): Track {
  return createVideoTrack({
    bvid: video.bvid,
    title: video.title,
    artistId: video.mid,
    artistName: video.author,
    artworkUrl: video.pic,
    publishedAtMs: toMilliseconds(video.created),
    description: video.description,
    statistics: {
      playCount: video.play,
      danmakuCount: video.video_review,
      commentCount: video.comment,
    },
  })
}

export function mapSeasonArchive(
  archive: BilibiliSeasonArchive,
  owner: { mid: number; name: string },
): Track {
  return createVideoTrack({
    bvid: archive.bvid,
    title: archive.title,
    artistId: owner.mid,
    artistName: owner.name,
    artworkUrl: archive.pic,
    publishedAtMs: toMilliseconds(archive.pubdate),
    statistics: {
      playCount: archive.stat?.view,
      danmakuCount: archive.stat?.danmaku,
    },
  })
}

export function mapFavoriteMedia(media: BilibiliFavoriteMedia): Track | undefined {
  const bvid = media.bvid ?? media.bv_id
  if (!bvid || !media.upper) return undefined

  return createVideoTrack({
    bvid,
    cid: media.ugc?.first_cid,
    title: media.title,
    artistId: media.upper.mid,
    artistName: media.upper.name,
    artworkUrl: media.cover,
    publishedAtMs: toMilliseconds(media.pubtime),
    description: media.intro,
    statistics: {
      playCount: media.cnt_info?.play,
      danmakuCount: media.cnt_info?.danmaku,
      favoriteCount: media.cnt_info?.collect,
      commentCount: media.cnt_info?.reply,
    },
  })
}

export function mapAudioSong(song: BilibiliAudioSong): Track {
  return {
    id: `${PLUGIN_ID}:audio:${song.id}`,
    title: song.title,
    artists: [{ id: song.uid?.toString(), name: song.uname || '未知 UP 主' }],
    artworkUrl: normalizeUrl(song.cover),
    durationMs: song.duration === undefined ? undefined : song.duration * 1000,
    publishedAtMs: toMilliseconds(song.passtime),
    description: song.intro,
    statistics: {
      playCount: song.play_count,
      commentCount: song.reply_count,
    },
    source: {
      pluginId: PLUGIN_ID,
      mediaKind: 'audio',
      resourceId: String(song.id),
      pageUrl: `https://www.bilibili.com/audio/au${song.id}`,
    },
  }
}

export function mapVideoView(view: BilibiliVideoViewData, pageNumber = 1): Track {
  if (!view.pages?.length) {
    throw new MusicSourceError('invalid-response', 'B 站视频缺少可播放分 P。')
  }
  const page = view.pages.find((part) => part.page === pageNumber)
  if (!page) throw new MusicSourceError('not-found', `B 站视频不存在第 ${pageNumber} P。`)
  if (
    !Number.isSafeInteger(page.cid) ||
    page.cid <= 0 ||
    !Number.isFinite(page.duration) ||
    page.duration <= 0
  ) {
    throw new MusicSourceError('invalid-response', 'B 站视频分 P 缺少有效的媒体 ID 或时长。')
  }
  return createVideoTrack({
    bvid: view.bvid,
    cid: page.cid,
    pageNumber,
    title: view.pages.length > 1 ? page.part?.trim() || view.title : view.title,
    artistId: view.owner.mid,
    artistName: view.owner.name,
    artworkUrl: view.pic,
    // view.duration is the sum of every part, not the duration of the selected media.
    durationMs: page.duration * 1000,
    publishedAtMs: toMilliseconds(view.pubdate),
    description: view.desc,
  })
}

interface VideoTrackInput {
  bvid: string
  cid?: number
  pageNumber?: number
  title: string
  artistId: number
  artistName: string
  artworkUrl?: string
  durationMs?: number
  publishedAtMs?: number
  description?: string
  sourceTags?: readonly string[]
  statistics?: Track['statistics']
}

function createVideoTrack(input: VideoTrackInput): Track {
  const isLaterPart = input.pageNumber !== undefined && input.pageNumber > 1
  return {
    // Retain existing first-part IDs; later parts must not collide in queues, caches or exports.
    id: `${PLUGIN_ID}:video:${input.bvid}${isLaterPart ? `:${input.cid}` : ''}`,
    title: input.title,
    artists: [{ id: String(input.artistId), name: input.artistName }],
    artworkUrl: normalizeUrl(input.artworkUrl),
    durationMs: input.durationMs,
    publishedAtMs: input.publishedAtMs,
    description: input.description,
    sourceTags: input.sourceTags,
    statistics: input.statistics,
    source: {
      pluginId: PLUGIN_ID,
      mediaKind: 'video',
      resourceId: input.bvid,
      partId: input.cid?.toString(),
      pageUrl: `https://www.bilibili.com/video/${input.bvid}${isLaterPart ? `?p=${input.pageNumber}` : ''}`,
    },
  }
}

function stripSearchMarkup(value: string): string {
  // 搜索接口只会插入关键词高亮标签；按纯文本模型移除全部标签以阻断 HTML 注入。
  return value.replace(/<[^>]*>/g, '')
}

function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined
  return value.startsWith('//') ? `https:${value}` : value.replace(/^http:\/\//, 'https://')
}

function toMilliseconds(value?: number): number | undefined {
  return value === undefined ? undefined : value * 1000
}
