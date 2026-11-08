import type { AppErrorCode } from '@any-music/core'

import type { CatalogDrawerView } from '../../product/catalog-drawer'

export interface CatalogErrorGuide {
  title: string
  steps: readonly string[]
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

/** 使用本地日期与分钟展示请求时间，与日期筛选的本地日历边界一致。 */
export function formatCatalogDrawerCreatedAt(createdAtMs: number | undefined): string {
  if (createdAtMs === undefined || !Number.isFinite(createdAtMs)) return '时间未知'
  const date = new Date(createdAtMs)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`
}

/** 来源开关属于可用性状态，优先于旧请求的错误，不能触发错误处理。 */
export function isCatalogDrawerDisconnected(drawer: CatalogDrawerView): boolean {
  return drawer.status === 'disconnected' || drawer.status === 'missing' || !drawer.isSourceEnabled
}

export function getCatalogDrawerDisconnectedMessage(drawer: CatalogDrawerView): string {
  const sourceState = drawer.status === 'missing' ? '音乐源已卸载' : '音乐源已停用'
  const nextStep =
    drawer.status === 'missing' ? '重新安装音乐源后可重试加载。' : '在设置中重新启用后可继续加载。'
  return drawer.tracks.length > 0
    ? `${sourceState}，已保留 ${drawer.tracks.length} 首歌曲供查看，暂不加载新歌曲。${nextStep}`
    : `${sourceState}，暂不加载歌曲。${nextStep}`
}

/** 列表级故障接管主操作；来源断开和单首歌曲失效仍允许查看已有歌曲。 */
export function hasCatalogDrawerError(drawer: CatalogDrawerView): boolean {
  if (drawer.errorCode === 'operation-cancelled' && drawer.errorMessage) return true
  if (isCatalogDrawerDisconnected(drawer)) return false
  return drawer.status === 'error' || drawer.status === 'invalid' || drawer.status === 'paused'
}

/** 列表卡牌和详情弹框共享同一组状态文案，避免同一错误在不同入口呈现不同含义。 */
export function getCatalogDrawerKindLabel(drawer: CatalogDrawerView): string {
  return drawer.kind === 'search' ? '搜索' : '链接导入'
}

/** 标题区只呈现歌曲概况，加载、故障和来源可用性在统计前独立展示。 */
export function getCatalogDrawerTrackSummary(drawer: CatalogDrawerView): string {
  if (drawer.tracks.length === 0 && drawer.status !== 'ready') return '等待查看'
  return drawer.total === undefined
    ? `已加载 ${drawer.tracks.length}`
    : `${drawer.tracks.length} / ${drawer.total} 首`
}

export function getCatalogDrawerNoticeLabel(drawer: CatalogDrawerView): string | undefined {
  if (drawer.errorCode === 'operation-cancelled' && drawer.errorMessage) return '加载已取消'
  if (isCatalogDrawerDisconnected(drawer))
    return drawer.status === 'missing' ? '音乐源已卸载' : '音乐源已停用'
  if (drawer.status === 'restoring') return '加载第一页中'
  if (drawer.status === 'invalid')
    return getCatalogDrawerFailureLabel(drawer.errorCode) ?? '内容已失效'
  if (drawer.status === 'error')
    return (
      getCatalogDrawerFailureLabel(drawer.errorCode) ??
      (drawer.tracks.length > 0 ? '翻页失败' : '加载失败')
    )
  if (drawer.status === 'paused') return '音乐源暂不可用'
  if (drawer.isLoading) return '加载歌曲中'
  return undefined
}

export function getCatalogDrawerStatusLabel(drawer: CatalogDrawerView): string {
  if (isCatalogDrawerDisconnected(drawer))
    return drawer.status === 'missing' ? '音乐源已卸载' : '音乐源已停用'
  if (drawer.status === 'idle') return '等待查看'
  if (drawer.status === 'restoring') return '加载第一页中'
  if (drawer.status === 'invalid')
    return getCatalogDrawerFailureLabel(drawer.errorCode) ?? '内容已失效'
  if (drawer.status === 'error') {
    const failureLabel = getCatalogDrawerFailureLabel(drawer.errorCode)
    return drawer.tracks.length > 0
      ? `已加载 ${drawer.tracks.length} · ${failureLabel ?? '翻页失败'}`
      : (failureLabel ?? '加载失败')
  }
  if (drawer.status === 'paused') return '音乐源暂不可用'
  return drawer.total === undefined
    ? `已加载 ${drawer.tracks.length}`
    : `${drawer.tracks.length} / ${drawer.total} 首`
}

/** 卡片只放可快速扫描的原因类别；原始消息始终留在错误详情里。 */
function getCatalogDrawerFailureLabel(errorCode?: AppErrorCode): string | undefined {
  if (errorCode === 'verification-required') return '需要验证'
  if (errorCode === 'not-authenticated') return '需要登录'
  if (errorCode === 'account-unavailable') return '没有可用账号'
  if (errorCode === 'access-denied') return '权限受限'
  if (errorCode === 'rate-limited') return '请求受限'
  if (errorCode === 'network-error' || errorCode === 'request-timeout') return '网络异常'
  if (errorCode === 'pagination-unavailable') return '翻页失败'
  if (errorCode === 'upstream-error' || errorCode === 'invalid-response') return '来源异常'
  return undefined
}

export function getCatalogDrawerErrorMessage(drawer: CatalogDrawerView): string {
  if (drawer.errorCode === 'operation-cancelled') return drawer.errorMessage
  return drawer.invalidReason || drawer.errorMessage
}

/** 来源不可用时不能重试，优先给出能让重试重新可用的恢复路径。 */
export function getCatalogDrawerErrorGuide(drawer: CatalogDrawerView): CatalogErrorGuide {
  if (drawer.status === 'missing') {
    return {
      title: '重新安装音乐源',
      steps: ['打开插件中心，重新安装这个列表使用的音乐源。', '回到音乐列表，点击“重试”。'],
    }
  }
  if (drawer.status === 'paused' || !drawer.isSourceEnabled) {
    return {
      title: '启用音乐源',
      steps: ['打开插件中心，确认该音乐源已启用且可用。', '回到音乐列表，点击“重试”。'],
    }
  }
  if (drawer.status === 'invalid' && !drawer.errorCode) {
    return {
      title: '检查原始内容',
      steps: [
        '在来源页面确认原始内容仍可访问，且其中包含可用歌曲。',
        '内容恢复后重试；若链接已失效，请用新链接创建列表。',
      ],
    }
  }
  return getCatalogErrorGuide(drawer.errorCode)
}

/** 搜索页由来源 listing 提供；通用 UI 只验证跳转协议，不拼接平台 URL。 */
export function getCatalogDrawerSourcePageUrl(drawer: CatalogDrawerView): string | undefined {
  const canOpenSourcePage =
    drawer.errorCode === 'verification-required' ||
    (drawer.errorCode === 'pagination-unavailable' && drawer.kind === 'search')
  if (!canOpenSourcePage || !drawer.sourceUrl) return undefined
  try {
    const url = new URL(drawer.sourceUrl)
    // 只允许来源提供的 HTTPS 页面，避免把当前会话降级到明文传输。
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

/** 指引先覆盖用户可自行处理的常见错误；未知错误保留稳定的通用恢复路径。 */
export function getCatalogErrorGuide(errorCode?: AppErrorCode): CatalogErrorGuide {
  if (errorCode === 'verification-required') {
    return {
      title: '完成来源验证后重试',
      steps: ['打开来源页面并完成验证码或安全验证。', '返回 Any Music，点击“重试”。'],
    }
  }
  if (errorCode === 'not-authenticated' || errorCode === 'account-unavailable') {
    return {
      title: '更新当前音乐源的登录状态',
      steps: [
        '确认此音乐源有可用账号；桌面端在账号设置中添加、启用或登录账号。',
        '刷新登录状态后，点击“重试”。',
      ],
    }
  }
  if (errorCode === 'operation-cancelled') {
    return {
      title: '确认音乐源与账号后重试',
      steps: [
        '在设置中确认该音乐源已启用，并有可用账号。',
        '点击“重试”后重新选择可用账号，从第一页加载；已加载歌曲可先收藏。',
      ],
    }
  }
  if (errorCode === 'access-denied') {
    return {
      title: '确认内容权限',
      steps: ['检查当前账号是否能在来源页面打开该内容。', '私密、下架或受限内容无法继续导入。'],
    }
  }
  if (errorCode === 'unsupported-url' || errorCode === 'invalid-input') {
    return {
      title: '检查搜索词或链接',
      steps: ['确认链接属于当前音乐源支持的内容类型。', '修正输入后重新创建音乐列表。'],
    }
  }
  if (errorCode === 'rate-limited') {
    return {
      title: '稍后再试',
      steps: ['来源服务正在限制请求频率。', '等待几分钟后点击“重试”，期间避免连续刷新。'],
    }
  }
  if (errorCode === 'pagination-unavailable') {
    return {
      title: '先处理已加载歌曲',
      steps: [
        '先查看或收藏当前已加载的歌曲。',
        '稍后点击“重试”；操作会从第一页重新加载，后续页能否恢复取决于来源。',
      ],
    }
  }
  if (errorCode === 'invalid-response' || errorCode === 'upstream-error') {
    return {
      title: '等待来源恢复',
      steps: [
        '来源返回的内容暂时无法使用；已加载的歌曲仍可查看和收藏。',
        '稍后点击“重试”；若持续失败，请记录错误原因和来源页面供排查。',
      ],
    }
  }
  if (errorCode === 'network-error' || errorCode === 'request-timeout') {
    return {
      title: '检查网络后重试',
      steps: [
        '确认设备网络或代理设置可访问当前音乐源。',
        '连接恢复后点击“重试”；已加载歌曲可先继续查看。',
      ],
    }
  }
  return {
    title: '重试加载当前列表',
    steps: [
      '先处理需要保留的已加载歌曲；重试会从第一页重新加载。',
      '若问题持续，可切换音乐源或重新创建列表。',
    ],
  }
}
