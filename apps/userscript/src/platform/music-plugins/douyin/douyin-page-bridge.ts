import type {
  DouyinAweme,
  DouyinCursorAwemeData,
  DouyinUrlResource,
} from '@any-music/plugin-source-douyin/contracts'

import type { DouyinProtectedAwemeKind } from './douyin-page-capture'

export interface DouyinPageBridgeTask {
  version: 1
  taskId: string
  kind: DouyinProtectedAwemeKind
  cursor: number
}

export type DouyinPageBridgeFailureReason = 'sign-in-required' | 'timeout' | 'verification-required'

export type DouyinPageBridgeMessage =
  | {
      version: 1
      taskId: string
      kind: DouyinProtectedAwemeKind
      cursor: number
      status: 'success'
      page: DouyinCursorAwemeData
    }
  | {
      version: 1
      taskId: string
      kind: DouyinProtectedAwemeKind
      cursor: number
      status: 'unavailable'
      reason: DouyinPageBridgeFailureReason
    }

const BRIDGE_VERSION = '1'
const RESULT_KEY_PREFIX = 'any-music:userscript:douyin-protected-page:v1:'
const SESSION_TASK_KEY = 'any-music:userscript:douyin-page-fallback-task:v1'
const TASK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type BridgeSessionStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

/**
 * 页面回退任务只在 URL fragment 中携带随机任务 ID、列表类型与游标；fragment 不会随页面请求
 * 发送给抖音服务器，也不包含账号标识或任何安全字段。
 */
export function createDouyinPageBridgeUrl(task: DouyinPageBridgeTask): string {
  assertValidTask(task)
  const url = new URL(pageUrlForKind(task.kind))
  url.hash = new URLSearchParams({
    am_capture: BRIDGE_VERSION,
    am_task: task.taskId,
    am_kind: task.kind,
    am_cursor: String(task.cursor),
  }).toString()
  return url.href
}

/** 只接受脚本自己生成、且与当前抖音 self 子页一致的页面回退任务。 */
export function parseDouyinPageBridgeTask(rawUrl: string): DouyinPageBridgeTask | undefined {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return undefined
  }

  const fragment = new URLSearchParams(url.hash.slice(1))
  const kind = fragment.get('am_kind')
  const task: DouyinPageBridgeTask = {
    version: 1,
    taskId: fragment.get('am_task') ?? '',
    kind: isProtectedAwemeKind(kind) ? kind : 'self-favorites',
    cursor: Number(fragment.get('am_cursor')),
  }
  if (fragment.get('am_capture') !== BRIDGE_VERSION || kind !== task.kind) return undefined
  if (!isPageForKind(url, task.kind) || !isValidTask(task)) return undefined
  return task
}

/**
 * 登录或安全验证可能触发同源跳转并丢失 fragment；任务只在该标签页的 sessionStorage 中短暂保留，
 * 不进入 GM 存储，也不会跨标签页或浏览器会话传播。
 */
export function saveDouyinPageBridgeSessionTask(
  storage: BridgeSessionStorage,
  task: DouyinPageBridgeTask,
  expiresAtMs: number,
): void {
  assertValidTask(task)
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0) {
    throw new Error('Invalid Douyin page bridge expiry.')
  }
  storage.setItem(SESSION_TASK_KEY, JSON.stringify({ task, expiresAtMs }))
}

/** 恢复同一页面回退标签页中的未过期任务，并拒绝非抖音页面或被篡改的会话值。 */
export function readDouyinPageBridgeSessionTask(
  storage: BridgeSessionStorage,
  rawUrl: string,
  nowMs: number,
): DouyinPageBridgeTask | undefined {
  let url: URL
  try {
    url = new URL(rawUrl)
    if (!isDouyinHost(url.hostname)) return undefined
    const value = JSON.parse(storage.getItem(SESSION_TASK_KEY) ?? '') as unknown
    if (!isRecord(value) || !isRecord(value.task) || !isValidTaskRecord(value.task)) {
      storage.removeItem(SESSION_TASK_KEY)
      return undefined
    }
    const expiresAtMs = Number(value.expiresAtMs)
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) {
      storage.removeItem(SESSION_TASK_KEY)
      return undefined
    }
    return value.task
  } catch {
    return undefined
  }
}

export function clearDouyinPageBridgeSessionTask(storage: BridgeSessionStorage): void {
  storage.removeItem(SESSION_TASK_KEY)
}

export function createDouyinPageBridgeResultKey(taskId: string): string {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error('Invalid Douyin page bridge task id.')
  return `${RESULT_KEY_PREFIX}${taskId}`
}

export function createDouyinPageBridgeSuccess(
  task: DouyinPageBridgeTask,
  data: DouyinCursorAwemeData,
): DouyinPageBridgeMessage {
  return {
    ...task,
    status: 'success',
    page: projectDouyinAwemePage(data),
  }
}

export function createDouyinPageBridgeFailure(
  task: DouyinPageBridgeTask,
  reason: DouyinPageBridgeFailureReason,
): DouyinPageBridgeMessage {
  return { ...task, status: 'unavailable', reason }
}

/**
 * GM value 消息视作不可信输入重新校验，并再次投影业务字段。这样即使旧版本留下异常值，
 * 也不会让签名、Cookie、播放地址或平台未声明字段穿过跨标签页边界。
 */
export function parseDouyinPageBridgeMessage(
  value: unknown,
  expectedTask: DouyinPageBridgeTask,
): DouyinPageBridgeMessage | undefined {
  if (!isRecord(value)) return undefined
  if (
    value.version !== 1 ||
    value.taskId !== expectedTask.taskId ||
    value.kind !== expectedTask.kind ||
    value.cursor !== expectedTask.cursor
  ) {
    return undefined
  }

  if (value.status === 'success' && isCursorAwemePage(value.page)) {
    return createDouyinPageBridgeSuccess(expectedTask, value.page)
  }
  if (value.status === 'unavailable' && isFailureReason(value.reason)) {
    return createDouyinPageBridgeFailure(expectedTask, value.reason)
  }
  return undefined
}

/**
 * 跨标签页只传递映射 Track 所需的稳定业务字段。所有播放地址、下载地址、bit_rate、
 * 请求 extra 以及安全字段都会在写入临时 GM value 前被丢弃。
 */
export function projectDouyinAwemePage(data: DouyinCursorAwemeData): DouyinCursorAwemeData {
  const sourceAwemes = data.aweme_list ?? data.awemeList ?? []
  return {
    status_code: 0,
    aweme_list: sourceAwemes.map(projectAweme).filter((aweme) => aweme.aweme_id),
    has_more: data.has_more ?? data.hasMore,
    max_cursor: data.max_cursor ?? data.maxCursor,
    min_cursor: data.min_cursor ?? data.minCursor,
    cursor: data.cursor,
  }
}

function projectAweme(aweme: DouyinAweme): DouyinAweme {
  const author = aweme.author ?? aweme.author_info ?? aweme.authorInfo
  const music = aweme.music
  const video = aweme.video
  const firstImage = aweme.images?.[0]
  const textExtra = aweme.text_extra ?? aweme.textExtra

  return {
    aweme_id: aweme.aweme_id ?? aweme.awemeId,
    aweme_type: aweme.aweme_type ?? aweme.awemeType,
    media_type: aweme.media_type ?? aweme.mediaType,
    desc: aweme.desc,
    item_title: aweme.item_title ?? aweme.itemTitle,
    create_time: aweme.create_time ?? aweme.createTime,
    author: author && {
      uid: author.uid,
      sec_uid: author.sec_uid ?? author.secUid,
      nickname: author.nickname,
    },
    video: video && {
      duration: video.duration,
      cover: projectUrlResource(video.cover),
      origin_cover: projectUrlResource(video.origin_cover ?? video.originCover),
      dynamic_cover: projectUrlResource(video.dynamic_cover ?? video.dynamicCover),
    },
    music: music && {
      id: music.id,
      id_str: music.id_str ?? music.idStr,
      title: music.title,
      author: music.author,
      owner_nickname: music.owner_nickname ?? music.ownerNickname,
      duration: music.duration,
      cover_large: projectUrlResource(music.cover_large ?? music.coverLarge),
      cover_medium: projectUrlResource(music.cover_medium ?? music.coverMedium),
      cover_thumb: projectUrlResource(music.cover_thumb ?? music.coverThumb),
    },
    images: firstImage
      ? [
          {
            url_list: [...(firstImage.url_list ?? firstImage.urlList ?? [])].slice(0, 3),
          },
        ]
      : undefined,
    statistics: aweme.statistics && {
      play_count: aweme.statistics.play_count ?? aweme.statistics.playCount,
      digg_count: aweme.statistics.digg_count ?? aweme.statistics.diggCount,
      comment_count: aweme.statistics.comment_count ?? aweme.statistics.commentCount,
      collect_count: aweme.statistics.collect_count ?? aweme.statistics.collectCount,
      share_count: aweme.statistics.share_count ?? aweme.statistics.shareCount,
    },
    text_extra: textExtra?.map((item) => ({
      hashtag_name: item.hashtag_name ?? item.hashtagName,
    })),
  }
}

function projectUrlResource(
  resource: DouyinUrlResource | undefined,
): DouyinUrlResource | undefined {
  if (!resource) return undefined
  return {
    uri: resource.uri,
    url_list: [...(resource.url_list ?? resource.urlList ?? [])].slice(0, 3),
  }
}

function pageUrlForKind(kind: DouyinProtectedAwemeKind): string {
  if (kind === 'self-recommendations') {
    return 'https://www.douyin.com/user/self?from_tab_name=main&showTab=recommend'
  }
  const showTab = kind === 'self-favorites' ? 'like' : 'favorite_collection'
  return `https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=${showTab}`
}

function isPageForKind(url: URL, kind: DouyinProtectedAwemeKind): boolean {
  if (url.hostname !== 'www.douyin.com' || url.pathname !== '/user/self') return false
  if (kind === 'self-recommendations') return url.searchParams.get('showTab') === 'recommend'
  const expectedTab = kind === 'self-favorites' ? 'like' : 'favorite_collection'
  return url.searchParams.get('showTab') === expectedTab
}

function assertValidTask(task: DouyinPageBridgeTask): void {
  if (!isValidTask(task)) throw new Error('Invalid Douyin page bridge task.')
}

function isValidTask(task: DouyinPageBridgeTask): boolean {
  return (
    task.version === 1 &&
    TASK_ID_PATTERN.test(task.taskId) &&
    isProtectedAwemeKind(task.kind) &&
    Number.isSafeInteger(task.cursor) &&
    task.cursor >= 0
  )
}

function isValidTaskRecord(
  value: Record<string, unknown>,
): value is Record<string, unknown> & DouyinPageBridgeTask {
  return isValidTask(value as unknown as DouyinPageBridgeTask)
}

function isProtectedAwemeKind(value: unknown): value is DouyinProtectedAwemeKind {
  return (
    value === 'self-favorites' ||
    value === 'self-collected-videos' ||
    value === 'self-recommendations'
  )
}

function isCursorAwemePage(value: unknown): value is DouyinCursorAwemeData {
  if (!isRecord(value)) return false
  return Array.isArray(value.aweme_list ?? value.awemeList)
}

function isFailureReason(value: unknown): value is DouyinPageBridgeFailureReason {
  return value === 'sign-in-required' || value === 'timeout' || value === 'verification-required'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDouyinHost(hostname: string): boolean {
  return hostname === 'douyin.com' || hostname.endsWith('.douyin.com')
}
