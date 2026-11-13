/**
 * 抖音接口的最小原始类型集合。
 *
 * Web API 返回 snake_case，而视频/图文详情页的 React Flight 数据使用 camelCase；
 * 适配器同时接受两者，防止页面回退路径把平台字段扩散到 core。
 */
export interface DouyinUrlResource {
  uri?: string
  url_list?: string[]
  urlList?: string[]
  data_size?: number
  dataSize?: number
  mime_type?: string
  mimeType?: string
  codecs?: string
}

export type DouyinResource = DouyinUrlResource | readonly string[] | string

export interface DouyinImage {
  url_list?: string[]
  urlList?: string[]
  download_url_list?: string[]
  downloadUrlList?: string[]
}

export interface DouyinUser {
  uid?: string
  short_id?: string
  shortId?: string
  sec_uid?: string
  secUid?: string
  nickname?: string
  avatar_thumb?: DouyinUrlResource
  avatarThumb?: DouyinUrlResource
}

export interface DouyinMusic {
  id?: string | number
  id_str?: string
  idStr?: string
  title?: string
  author?: string
  owner_nickname?: string
  ownerNickname?: string
  duration?: number
  play_url?: DouyinUrlResource
  playUrl?: DouyinUrlResource
  cover_large?: DouyinUrlResource
  coverLarge?: DouyinUrlResource
  cover_medium?: DouyinUrlResource
  coverMedium?: DouyinUrlResource
  cover_thumb?: DouyinUrlResource
  coverThumb?: DouyinUrlResource
  music_collect_count?: number
  musicCollectCount?: number
  user_count?: number
  userCount?: number
}

export interface DouyinMusicDetailData extends DouyinApiEnvelope {
  music_info?: DouyinMusic
  musicInfo?: DouyinMusic
}

export interface DouyinBitRate {
  bit_rate?: number
  bitRate?: number
  gear_name?: string
  gearName?: string
  quality_type?: number
  qualityType?: number
  play_addr?: DouyinUrlResource
  playAddr?: DouyinUrlResource
}

export interface DouyinVideo {
  duration?: number
  cover?: DouyinUrlResource
  origin_cover?: DouyinUrlResource
  originCover?: DouyinUrlResource
  dynamic_cover?: DouyinUrlResource
  dynamicCover?: DouyinUrlResource
  play_addr?: DouyinResource
  playAddr?: DouyinResource
  play_addr_h264?: DouyinResource
  playAddrH264?: DouyinResource
  bit_rate?: DouyinBitRate[]
  bitRate?: DouyinBitRate[]
  bit_rate_audio_list?: DouyinBitRate[]
  bitRateAudioList?: DouyinBitRate[]
}

export interface DouyinStatistics {
  play_count?: number
  playCount?: number
  digg_count?: number
  diggCount?: number
  comment_count?: number
  commentCount?: number
  collect_count?: number
  collectCount?: number
  share_count?: number
  shareCount?: number
}

export interface DouyinTextExtra {
  hashtag_name?: string
  hashtagName?: string
}

export interface DouyinMixInfo {
  mix_id?: string
  mixId?: string
  mix_name?: string
  mixName?: string
  desc?: string
  cover_url?: DouyinUrlResource
  coverUrl?: DouyinUrlResource
  total_episode?: number
  totalEpisode?: number
  statis?: {
    updated_to_episode?: number
    updatedToEpisode?: number
    play_vv?: number
    playVv?: number
  }
}

export interface DouyinAweme {
  aweme_id?: string
  awemeId?: string
  aweme_type?: number
  awemeType?: number
  media_type?: number
  mediaType?: number
  desc?: string
  item_title?: string
  itemTitle?: string
  create_time?: number
  createTime?: number
  author?: DouyinUser
  author_info?: DouyinUser
  authorInfo?: DouyinUser
  video?: DouyinVideo
  music?: DouyinMusic
  images?: DouyinImage[]
  statistics?: DouyinStatistics
  text_extra?: DouyinTextExtra[]
  textExtra?: DouyinTextExtra[]
  mix_info?: DouyinMixInfo
  mixInfo?: DouyinMixInfo
}

export interface DouyinApiEnvelope {
  status_code?: number
  statusCode?: number
  status_msg?: string
  statusMsg?: string
}

export interface DouyinSearchEntry {
  type?: number
  doc_type?: number
  aweme_info?: DouyinAweme
  awemeInfo?: DouyinAweme
}

export interface DouyinSearchData extends DouyinApiEnvelope {
  data?: DouyinSearchEntry[]
  result_status?: number
  has_more?: number | boolean
  hasMore?: number | boolean
  cursor?: number
  search_nil_info?: { search_nil_type?: string }
  searchNilInfo?: { searchNilType?: string }
  extra?: { logid?: string }
}

export interface DouyinCursorAwemeData extends DouyinApiEnvelope {
  aweme_list?: DouyinAweme[]
  awemeList?: DouyinAweme[]
  has_more?: number | boolean
  hasMore?: number | boolean
  max_cursor?: number
  maxCursor?: number
  min_cursor?: number
  minCursor?: number
  cursor?: number
}

export interface DouyinDetailData extends DouyinApiEnvelope {
  aweme_detail?: DouyinAweme
  awemeDetail?: DouyinAweme
}

export interface DouyinMixListData extends DouyinApiEnvelope {
  mix_infos?: DouyinMixInfo[]
  mixInfos?: DouyinMixInfo[]
  has_more?: number | boolean
  hasMore?: number | boolean
  cursor?: number
  total?: number
}

/** 登录账号“收藏/视频”使用 POST 表单，但返回的作品页仍沿用通用游标结构。 */
export type DouyinCollectedAwemeData = DouyinCursorAwemeData

export interface DouyinCollectedMusicData extends DouyinApiEnvelope {
  mc_list?: DouyinMusic[]
  mcList?: DouyinMusic[]
  has_more?: number | boolean
  hasMore?: number | boolean
  cursor?: number
}

export interface DouyinCollectsInfo {
  collects_id?: string
  collectsId?: string
  collects_id_str?: string
  collectsIdStr?: string
  collects_name?: string
  collectsName?: string
  aweme_count?: number
  awemeCount?: number
}

export interface DouyinCollectsListData extends DouyinApiEnvelope {
  collects_list?: DouyinCollectsInfo[]
  collectsList?: DouyinCollectsInfo[]
  has_more?: number | boolean
  hasMore?: number | boolean
  cursor?: number
  total_number?: number
  totalNumber?: number
}

export interface DouyinProfileData extends DouyinApiEnvelope {
  user?: DouyinUser
}
