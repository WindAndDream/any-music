/** 全局错误分类用于日志、筛选与 UI 分级；业务代码仍通过语义化 code 判断具体原因。 */
export type AppErrorCategory =
  | 'common'
  | 'authentication'
  | 'music-source'
  | 'network'
  | 'storage'
  | 'plugin'
  | 'media'
  | 'download'
  | 'library'

/** 严重级别只描述展示与观测优先级，不参与业务流程分支。 */
export type AppErrorSeverity = 'info' | 'warning' | 'error' | 'fatal'

export interface AppErrorDefinition {
  /** 对用户支持与日志稳定的编号；一经发布不得复用给其他语义。 */
  statusCode: `AM-${number}`
  category: AppErrorCategory
  defaultMessage: string
  severity: AppErrorSeverity
  isRetryable: boolean
}

/**
 * Any Music 的唯一错误目录。
 *
 * 编号段按职责预留：1xxx 通用、2xxx 鉴权、3xxx 音乐源、4xxx 网络、
 * 5xxx 存储、6xxx 插件清单、7xxx 媒体/下载、8xxx 本地资料库。
 */
export const APP_ERROR_DEFINITIONS = {
  unknown: {
    statusCode: 'AM-1000',
    category: 'common',
    defaultMessage: '发生未知错误。',
    severity: 'error',
    isRetryable: false,
  },
  'invalid-input': {
    statusCode: 'AM-1001',
    category: 'common',
    defaultMessage: '输入内容无效。',
    severity: 'warning',
    isRetryable: false,
  },
  'unsupported-operation': {
    statusCode: 'AM-1002',
    category: 'common',
    defaultMessage: '当前操作不受支持。',
    severity: 'warning',
    isRetryable: false,
  },
  conflict: {
    statusCode: 'AM-1003',
    category: 'common',
    defaultMessage: '当前操作与已有数据冲突。',
    severity: 'warning',
    isRetryable: false,
  },
  'not-found': {
    statusCode: 'AM-1004',
    category: 'common',
    defaultMessage: '请求的内容不存在或已失效。',
    severity: 'warning',
    isRetryable: false,
  },
  'operation-cancelled': {
    statusCode: 'AM-1005',
    category: 'common',
    defaultMessage: '操作已取消。',
    severity: 'info',
    isRetryable: true,
  },
  'limit-exceeded': {
    statusCode: 'AM-1006',
    category: 'common',
    defaultMessage: '已达到允许的数量或大小上限。',
    severity: 'warning',
    isRetryable: false,
  },
  'invariant-violation': {
    statusCode: 'AM-1900',
    category: 'common',
    defaultMessage: '应用内部状态不一致。',
    severity: 'fatal',
    isRetryable: false,
  },
  'not-authenticated': {
    statusCode: 'AM-2001',
    category: 'authentication',
    defaultMessage: '登录状态已失效，请重新登录后重试。',
    severity: 'warning',
    isRetryable: true,
  },
  'access-denied': {
    statusCode: 'AM-2002',
    category: 'authentication',
    defaultMessage: '没有权限访问该内容。',
    severity: 'warning',
    isRetryable: false,
  },
  'account-unavailable': {
    statusCode: 'AM-2003',
    category: 'authentication',
    defaultMessage: '当前操作没有可用账号，请检查账号配置。',
    severity: 'warning',
    isRetryable: true,
  },
  'unsupported-url': {
    statusCode: 'AM-3001',
    category: 'music-source',
    defaultMessage: '当前音乐源不支持该 URL。',
    severity: 'warning',
    isRetryable: false,
  },
  'upstream-error': {
    statusCode: 'AM-3002',
    category: 'music-source',
    defaultMessage: '音乐源服务暂时不可用。',
    severity: 'error',
    isRetryable: true,
  },
  'invalid-response': {
    statusCode: 'AM-3003',
    category: 'music-source',
    defaultMessage: '音乐源返回了无法识别的数据。',
    severity: 'error',
    isRetryable: true,
  },
  'rate-limited': {
    statusCode: 'AM-3004',
    category: 'music-source',
    defaultMessage: '请求过于频繁，请稍后重试。',
    severity: 'warning',
    isRetryable: true,
  },
  'verification-required': {
    statusCode: 'AM-3005',
    category: 'music-source',
    defaultMessage: '音乐源要求完成人工验证后再重试。',
    severity: 'warning',
    isRetryable: true,
  },
  'pagination-unavailable': {
    statusCode: 'AM-3006',
    category: 'music-source',
    defaultMessage: '音乐源暂时无法继续加载后续内容，请稍后重试。',
    severity: 'warning',
    isRetryable: true,
  },
  'network-error': {
    statusCode: 'AM-4001',
    category: 'network',
    defaultMessage: '网络请求失败，请检查连接后重试。',
    severity: 'error',
    isRetryable: true,
  },
  'request-aborted': {
    statusCode: 'AM-4002',
    category: 'network',
    defaultMessage: '网络请求已中止。',
    severity: 'info',
    isRetryable: true,
  },
  'request-timeout': {
    statusCode: 'AM-4003',
    category: 'network',
    defaultMessage: '网络请求超时，请稍后重试。',
    severity: 'warning',
    isRetryable: true,
  },
  'storage-read-failed': {
    statusCode: 'AM-5001',
    category: 'storage',
    defaultMessage: '本地数据读取失败。',
    severity: 'error',
    isRetryable: true,
  },
  'storage-write-failed': {
    statusCode: 'AM-5002',
    category: 'storage',
    defaultMessage: '本地数据保存失败。',
    severity: 'error',
    isRetryable: true,
  },
  'invalid-shape': {
    statusCode: 'AM-6001',
    category: 'plugin',
    defaultMessage: '插件清单结构无效。',
    severity: 'warning',
    isRetryable: false,
  },
  'invalid-id': {
    statusCode: 'AM-6002',
    category: 'plugin',
    defaultMessage: '插件标识无效。',
    severity: 'warning',
    isRetryable: false,
  },
  'invalid-origin': {
    statusCode: 'AM-6003',
    category: 'plugin',
    defaultMessage: '插件域名权限无效。',
    severity: 'warning',
    isRetryable: false,
  },
  'invalid-template': {
    statusCode: 'AM-6004',
    category: 'plugin',
    defaultMessage: '插件请求模板无效。',
    severity: 'warning',
    isRetryable: false,
  },
  'invalid-path': {
    statusCode: 'AM-6005',
    category: 'plugin',
    defaultMessage: '插件字段路径无效。',
    severity: 'warning',
    isRetryable: false,
  },
  'unsupported-version': {
    statusCode: 'AM-6006',
    category: 'plugin',
    defaultMessage: '插件清单版本不受支持。',
    severity: 'warning',
    isRetryable: false,
  },
  'media-unavailable': {
    statusCode: 'AM-7001',
    category: 'media',
    defaultMessage: '媒体资源不可用。',
    severity: 'error',
    isRetryable: true,
  },
  'media-format-unsupported': {
    statusCode: 'AM-7002',
    category: 'media',
    defaultMessage: '当前环境不支持该媒体格式。',
    severity: 'warning',
    isRetryable: false,
  },
  'media-decode-failed': {
    statusCode: 'AM-7003',
    category: 'media',
    defaultMessage: '媒体解码失败。',
    severity: 'error',
    isRetryable: false,
  },
  'media-range-invalid': {
    statusCode: 'AM-7004',
    category: 'media',
    defaultMessage: '媒体分段响应无效。',
    severity: 'error',
    isRetryable: true,
  },
  'export-unavailable': {
    statusCode: 'AM-7101',
    category: 'media',
    defaultMessage: '当前曲目无法导出。',
    severity: 'warning',
    isRetryable: false,
  },
  'export-failed': {
    statusCode: 'AM-7102',
    category: 'media',
    defaultMessage: '音频导出失败。',
    severity: 'error',
    isRetryable: true,
  },
  'download-failed': {
    statusCode: 'AM-7201',
    category: 'download',
    defaultMessage: '歌曲下载失败。',
    severity: 'error',
    isRetryable: true,
  },
  'download-interrupted': {
    statusCode: 'AM-7202',
    category: 'download',
    defaultMessage: '下载被页面关闭或刷新中断。',
    severity: 'warning',
    isRetryable: true,
  },
  'archive-failed': {
    statusCode: 'AM-7203',
    category: 'download',
    defaultMessage: '下载文件打包失败。',
    severity: 'error',
    isRetryable: true,
  },
  'collection-not-found': {
    statusCode: 'AM-8001',
    category: 'library',
    defaultMessage: '找不到指定的素材合集。',
    severity: 'warning',
    isRetryable: false,
  },
  'source-outside-collection': {
    statusCode: 'AM-8002',
    category: 'library',
    defaultMessage: '片段来源不属于当前素材合集。',
    severity: 'warning',
    isRetryable: false,
  },
  'empty-recipe': {
    statusCode: 'AM-8101',
    category: 'library',
    defaultMessage: '自定义歌曲至少需要一个片段。',
    severity: 'warning',
    isRetryable: false,
  },
  'invalid-range': {
    statusCode: 'AM-8102',
    category: 'library',
    defaultMessage: '音频片段区间无效。',
    severity: 'warning',
    isRetryable: false,
  },
  'source-not-found': {
    statusCode: 'AM-8103',
    category: 'library',
    defaultMessage: '找不到片段来源曲目。',
    severity: 'warning',
    isRetryable: false,
  },
  'duration-exceeded': {
    statusCode: 'AM-8104',
    category: 'library',
    defaultMessage: '片段区间超过来源曲目时长。',
    severity: 'warning',
    isRetryable: false,
  },
  'circular-reference': {
    statusCode: 'AM-8105',
    category: 'library',
    defaultMessage: '自定义歌曲存在循环引用。',
    severity: 'warning',
    isRetryable: false,
  },
} as const satisfies Record<string, AppErrorDefinition>

/** 语义化错误码用于代码分支；新增值必须同时在上方目录分配唯一状态码。 */
export type AppErrorCode = keyof typeof APP_ERROR_DEFINITIONS

/** 对日志和用户支持稳定的错误状态码，例如 AM-3002。 */
export type AppErrorStatusCode = (typeof APP_ERROR_DEFINITIONS)[AppErrorCode]['statusCode']

/** 可安全放入 Vue 状态或持久化记录的错误快照，不携带不可序列化的 cause。 */
export interface AppErrorState {
  code: AppErrorCode
  statusCode: AppErrorStatusCode
  message: string
  category: AppErrorCategory
  severity: AppErrorSeverity
  isRetryable: boolean
}

/** 所有可预期、可展示业务错误的基类；原始平台错误应通过 cause 保留而非泄漏到通用层。 */
export class AppError extends Error {
  readonly code: AppErrorCode
  readonly statusCode: AppErrorStatusCode
  readonly category: AppErrorCategory
  readonly severity: AppErrorSeverity
  readonly isRetryable: boolean

  constructor(code: AppErrorCode, message?: string, options?: ErrorOptions) {
    const definition = APP_ERROR_DEFINITIONS[code]
    super(message?.trim() || definition.defaultMessage, options)
    this.name = 'AppError'
    this.code = code
    this.statusCode = definition.statusCode
    this.category = definition.category
    this.severity = definition.severity
    this.isRetryable = definition.isRetryable
  }

  /** 丢弃 cause 后生成跨层传递所需的最小稳定数据。 */
  toState(): AppErrorState {
    return {
      code: this.code,
      statusCode: this.statusCode,
      message: this.message,
      category: this.category,
      severity: this.severity,
      isRetryable: this.isRetryable,
    }
  }
}

/** 把边界捕获到的 unknown 统一包装；原生 Error 文案会保留并挂到 cause。 */
export function normalizeAppError(
  error: unknown,
  fallbackCode: AppErrorCode = 'unknown',
  fallbackMessage?: string,
): AppError {
  if (error instanceof AppError) return error
  const message = error instanceof Error && error.message ? error.message : fallbackMessage
  return new AppError(fallbackCode, message, { cause: error })
}

/** 为响应式状态、跨线程消息和持久化记录创建统一错误快照。 */
export function toAppErrorState(
  error: unknown,
  fallbackCode: AppErrorCode = 'unknown',
  fallbackMessage?: string,
): AppErrorState {
  return normalizeAppError(error, fallbackCode, fallbackMessage).toState()
}

/** 从已知 code 创建不含异常堆栈的业务错误状态。 */
export function createAppErrorState(code: AppErrorCode, message?: string): AppErrorState {
  return new AppError(code, message).toState()
}

/** 校验持久化或跨线程传入的错误快照，并始终用当前目录重建派生元数据。 */
export function sanitizeAppErrorState(input: unknown): AppErrorState | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const candidate = input as Record<string, unknown>
  if (!isAppErrorCode(candidate.code)) return undefined
  const message = typeof candidate.message === 'string' ? candidate.message : undefined
  return createAppErrorState(candidate.code, message)
}

/** 在不使用 instanceof 的协议边界判断语义化错误码。 */
export function isAppErrorCode(input: unknown): input is AppErrorCode {
  return typeof input === 'string' && Object.hasOwn(APP_ERROR_DEFINITIONS, input)
}

/** 统一展示“文案 + 可检索状态码”；需要纯文案时显式关闭 includeStatusCode。 */
export function formatAppErrorMessage(
  error: Pick<AppErrorState, 'message' | 'statusCode'>,
  options: { includeStatusCode?: boolean } = {},
): string {
  return options.includeStatusCode === false
    ? error.message
    : `${error.message}（错误码：${error.statusCode}）`
}
