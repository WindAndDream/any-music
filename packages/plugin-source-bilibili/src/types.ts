/** 只声明适配器实际消费的字段，B 站新增无关字段不会扩散到业务层。 */
export interface BilibiliApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface BilibiliNavData {
  isLogin: boolean
  mid: number
  uname: string
  face?: string
  wbi_img?: {
    img_url: string
    sub_url: string
  }
}

export interface BilibiliSearchVideo {
  author: string
  mid: number
  bvid: string
  title: string
  description?: string
  pic?: string
  play?: number
  video_review?: number
  favorites?: number
  review?: number
  like?: number
  pubdate?: number
  duration?: string
  tag?: string
}

export interface BilibiliSearchData {
  page: number
  pagesize: number
  numResults: number
  result?: BilibiliSearchVideo[]
}

export interface BilibiliUpperVideo {
  author: string
  mid: number
  bvid: string
  title: string
  description?: string
  pic?: string
  play?: number
  video_review?: number
  comment?: number
  created?: number
  length?: string
}

export interface BilibiliUpperVideoData {
  list?: { vlist?: BilibiliUpperVideo[] }
  page: { pn: number; ps: number; count: number }
}

export interface BilibiliSeasonArchive {
  bvid: string
  duration?: number
  pic?: string
  pubdate?: number
  title: string
  stat?: { view?: number; danmaku?: number }
}

export interface BilibiliSeasonData {
  archives?: BilibiliSeasonArchive[]
  meta: { mid: number; name?: string; title: string; total: number }
  page: { page_num: number; page_size: number; total: number }
}

export interface BilibiliFavoriteMedia {
  title: string
  cover?: string
  intro?: string
  duration?: number
  pubtime?: number
  bvid?: string
  bv_id?: string
  upper?: { mid: number; name: string }
  cnt_info?: { play?: number; danmaku?: number; collect?: number; reply?: number }
  ugc?: { first_cid?: number }
}

export interface BilibiliFavoriteData {
  info: { id: number; title: string; media_count: number }
  medias?: BilibiliFavoriteMedia[]
  has_more: boolean
}

export interface BilibiliAudioSong {
  id: number
  uid?: number
  uname?: string
  title: string
  cover?: string
  intro?: string
  duration?: number
  passtime?: number
  play_count?: number
  reply_count?: number
}

export interface BilibiliUpperAudioData {
  curPage: number
  pageSize: number
  totalSize: number
  data?: BilibiliAudioSong[]
}

export interface BilibiliVideoPage {
  cid: number
  page: number
  part: string
  duration: number
}

export interface BilibiliVideoViewData {
  bvid: string
  aid: number
  title: string
  duration: number
  pic?: string
  pubdate?: number
  desc?: string
  owner: { mid: number; name: string }
  pages?: BilibiliVideoPage[]
}

export interface BilibiliDashAudio {
  id: number
  baseUrl?: string
  base_url?: string
  backupUrl?: string[]
  backup_url?: string[]
  mimeType?: string
  mime_type?: string
  codecs?: string
  bandwidth?: number
}

/** HTML5 兼容模式返回音视频合并流；仅在跨站原生播放 DASH 被 CDN 拒绝时使用。 */
export interface BilibiliProgressiveMedia {
  url: string
  backupUrl?: string[]
  backup_url?: string[]
  length?: number
  size?: number
}

export interface BilibiliPlayUrlData {
  quality?: number
  format?: string
  accept_quality?: number[]
  accept_description?: string[]
  timelength?: number
  dash?: { audio?: BilibiliDashAudio[] }
  durl?: BilibiliProgressiveMedia[]
}

export interface BilibiliAudioUrlData {
  cdns?: string[]
  size?: number
}
