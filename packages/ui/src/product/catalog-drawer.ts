import type { AppErrorCode, Track, TrackListing } from '@any-music/core'

export type CatalogRequestKind = 'search' | 'import-url'
export type CatalogDrawerStateFilter = 'all' | 'available' | 'unavailable' | 'attention'

/** Selection and applied-filter counts share the currently loaded track scope, excluding unloaded pages. */
export interface CatalogTrackListSummary {
  selectedCount: number
  visibleCount: number
  totalCount: number
}

export type CatalogDrawerStatus =
  | 'idle'
  | 'restoring'
  | 'ready'
  | 'error'
  | 'invalid'
  /** The source is switched off; loaded results remain readable without new requests. */
  | 'disconnected'
  | 'paused'
  | 'missing'

/** Stable, immutable projection consumed by catalog presentation components across runtimes. */
export interface CatalogDrawerView {
  id: string
  pluginId: string
  pluginName: string
  /** 来自当前列表的公开账号投影，不能用当前选中账号替代历史请求身份。 */
  account?: TrackListing['account']
  /** False until this retained result is opened in the current session. */
  accountStatusVisible?: boolean
  accountStatus?: string
  kind: CatalogRequestKind
  input: string
  title: string
  /** 用户重命名独立于请求输入；旧消费者缺失时按原名展示。 */
  isCustomNamed?: boolean
  /** 原始搜索或导入请求的创建时间；恢复和重试不改写，旧的端级投影可暂缺。 */
  createdAtMs?: number
  /** Pinned recipes precede ordinary lists without changing their relative request order. */
  isPinned?: boolean
  sourceUrl?: string
  isExpanded: boolean
  isSourceEnabled: boolean
  loadedPageCount: number
  tracks: readonly Track[]
  total?: number
  hasMore: boolean
  isLoading: boolean
  status: CatalogDrawerStatus
  errorCode?: AppErrorCode
  /** Optional controlled runtime verification, scoped to this live listing. */
  canVerify?: boolean
  isVerifying?: boolean
  verificationPhase?:
    | 'idle'
    | 'opening'
    | 'waiting'
    | 'confirming'
    | 'restoring'
    | 'failed'
    | 'cancelled'
    | 'complete'
  verificationErrorMessage?: string
  failureOperation?: 'search' | 'import' | 'pagination' | 'restore'
  errorMessage: string
  invalidReason: string
}
