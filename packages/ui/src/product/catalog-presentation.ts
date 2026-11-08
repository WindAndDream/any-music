import type { MusicPlaylist, MusicSourceImportUrlScope, Track } from '@any-music/core'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../components/music-sources/catalog-track-display-mode'
import type { CatalogDrawerListSummary } from '../composables/music-sources/use-catalog-drawer-list'
import type { CatalogDrawerView, CatalogTrackListSummary } from './catalog-drawer'

/** Controlled catalog presentation for the current host composition; no business instances. */
export type UiCatalogContextDetailsDialogProps = {
  open: boolean
  drawer?: Pick<CatalogDrawerView, 'title' | 'input' | 'kind'>
  suspended?: boolean
}

export type UiCatalogContextDetailsDialogEmits = { close: [] }

export type UiCatalogContextTitleProps = {
  title: string
  input: string
  pluginName: string
  expanded: boolean
}

export type UiCatalogContextTitleEmits = { showDetails: [] }

export type UiCatalogDisplayModeDialogProps = {
  open: boolean
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  /** 异步分页错误弹窗出现时暂停当前弹窗的焦点圈和快捷键。 */
  suspended?: boolean
}

export type UiCatalogDisplayModeDialogEmits = {
  close: []
  updateDisplayMode: [mode: CatalogTrackDisplayMode]
  updateMobileColumns: [columns: MobileTrackColumns]
}

export type UiCatalogDrawerProps = {
  drawer: CatalogDrawerView
  /** 缓存的歌曲页离开当前板块时暂停分页和子弹窗，保留筛选与选择。 */
  active?: boolean
  currentTrackId?: string
  invalidTrackIds: ReadonlySet<string>
  favoriteTrackIds: ReadonlySet<string>
  queuedTrackIds?: ReadonlySet<string>
  downloadedTrackIds?: ReadonlySet<string>
  customTagsByTrackId: ReadonlyMap<string, readonly string[]>
  playlists: readonly MusicPlaylist[]
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  downloadBusy?: boolean
  /** 壳层已在固定返回栏展示错误摘要时，关闭列表内部的重复提示。 */
  errorNoticeVisible?: boolean
  filterOpen?: boolean
  operatorOpen?: boolean
  operatorAutoFocus?: boolean
  panelsSuspended?: boolean
  overlayTarget?: HTMLElement | null
  operatorOverlayTarget?: HTMLElement | null
}

export type UiCatalogDrawerEmits = {
  play: [track: Track]
  addSelectedToQueue: [tracks: readonly Track[]]
  favorite: [track: Track]
  addSelectedToFavorites: [tracks: readonly Track[]]
  addSelectedToPlaylist: [playlistId: string, tracks: readonly Track[]]
  downloadSelected: [tracks: readonly Track[], drawerId: string]
  restoreNames: [trackIds: readonly string[]]
  requestCreatePlaylist: []
  loadMore: [drawerId: string]
  showError: [drawerId: string]
  showTrackActions: [track: Track]
  closeFilter: []
  closeOperator: []
  toggleAllVisible: [selectedCount: number]
  filterCountChange: [count: number]
  summaryChange: [summary: CatalogTrackListSummary]
  modalOpenChange: [isOpen: boolean]
}

export type UiCatalogDrawerActionsDialogProps = {
  open: boolean
  drawer?: CatalogDrawerView
  favoriteTrackIds: ReadonlySet<string>
  suspended?: boolean
}

export type UiCatalogDrawerActionsDialogEmits = {
  close: []
  favoriteAll: [drawerId: string]
  rename: [drawerId: string, title: string]
  togglePinned: [drawerId: string]
  refresh: [drawerId: string]
}

export type UiCatalogDrawerListProps = {
  drawers: readonly CatalogDrawerView[]
  /** 隐藏板块时保留筛选编辑与操作器开关，浮层移回隐藏内容树。 */
  active?: boolean
  invalidTrackIds: ReadonlySet<string>
  discoveryLabel: string
  /** 把发现入口放在顶部工具栏，操作器只保留集合管理；有 session 插槽时用账号替代标题。 */
  discoveryInHeader?: boolean
  filterOpen?: boolean
  operatorOpen?: boolean
  operatorAutoFocus?: boolean
  panelsSuspended?: boolean
  overlayTarget?: HTMLElement | null
  operatorOverlayTarget?: HTMLElement | null
}

export type UiCatalogDrawerListEmits = {
  discover: []
  view: [drawerId: string]
  showError: [drawerId: string]
  showActions: [drawerId: string]
  removeMany: [drawerIds: readonly string[]]
  restoreNames: [drawerIds: readonly string[]]
  closeFilter: []
  closeOperator: []
  toggleAllVisible: [selectedCount: number]
  summaryChange: [summary: CatalogDrawerListSummary]
  move: [drawerId: string, targetId: string, visibleIds: readonly string[]]
}

export type UiCatalogErrorDetailsProps = {
  drawer: CatalogDrawerView
}

export type UiCatalogErrorDetailsEmits = {
  retry: [drawerId: string]
  view: [drawerId: string]
  openPlugins: []
  verify: [drawerId: string]
  cancelVerification: [drawerId: string]
}

export type UiCatalogErrorNoticeProps = { drawer: CatalogDrawerView }

export type UiCatalogErrorNoticeEmits = { showError: [drawerId: string] }

export type UiCatalogHeadingHandleProps = {
  collapsed: boolean
  controls: string
  dragOnly?: boolean
  gestureTarget?: HTMLElement | null
}

export type UiCatalogHeadingHandleEmits = { updateCollapsed: [collapsed: boolean] }

export type UiMusicSourcePickerButtonProps = {
  sourceName: string
  expanded: boolean
  locked?: boolean
}

export type UiMusicSourcePickerButtonEmits = { open: [] }

export type UiMusicSourcePickerDialogProps = {
  open: boolean
  activeSourceId: string
  builtInSources: readonly { id: string; name: string }[]
  externalSources: readonly { id: string; name: string }[]
  suspended?: boolean
}

export type UiMusicSourcePickerDialogEmits = {
  select: [sourceId: string]
  close: []
}

export type UiCatalogTrackActionsDialogProps = {
  open: boolean
  playlists?: readonly MusicPlaylist[]
  track?: Track
  customTags: readonly string[]
  invalid: boolean
  favorite: boolean
  queued?: boolean
  downloadBusy?: boolean
  suspended?: boolean
  showQueueAction?: boolean
}

export type UiCatalogTrackActionsDialogEmits = {
  close: []
  addToPlaylist: [track: Track, playlistId: string]
  play: [track: Track]
  queue: [track: Track]
  favorite: [track: Track]
  download: [track: Track]
  compose: [track: Track]
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
  rename: [track: Track, name: string]
}

export type UiSourceToolbarProps = {
  pluginId: string
  supportsSearch: boolean
  supportsImport: boolean
  importUrlScopes: readonly MusicSourceImportUrlScope[]
}

export type UiSourceToolbarEmits = {
  search: [query: string]
  importUrl: [url: string]
}
