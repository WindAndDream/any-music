import type { AppIconName } from '../components/app-icon'

/**
 * Shared product destinations are UI identities rather than runtime routes. Every host maps the
 * same identifier to its own controller action, so adding a feature does not fork navigation UI.
 */
export type ProductViewId =
  | 'catalog'
  | 'queue'
  | 'favorites'
  | 'tags'
  | 'playlists'
  | 'custom-tracks'
  | 'composer'
  | 'downloads'
  | 'history'
  | 'plugins'

/**
 * 正式产品导航只保存稳定标识和轻量展示信息；页面 loader 留在应用组合层，
 * 避免读取侧栏配置时提前执行资料库、媒体或插件模块。
 */
export interface ProductDestination {
  id: ProductViewId
  label: string
  shortLabel: string
  icon: AppIconName
  canHide: boolean
  mobileSlot?: 'discover' | 'favorites' | 'playlists'
}

export const PRODUCT_DESTINATIONS: readonly ProductDestination[] = [
  {
    id: 'catalog',
    label: '发现',
    shortLabel: '发现',
    icon: 'search',
    canHide: false,
    mobileSlot: 'discover',
  },
  { id: 'queue', label: '待听', shortLabel: '待听', icon: 'queue', canHide: true },
  {
    id: 'favorites',
    label: '我的喜欢',
    shortLabel: '喜欢',
    icon: 'heart',
    canHide: false,
    mobileSlot: 'favorites',
  },
  {
    id: 'playlists',
    label: '我的歌单',
    shortLabel: '歌单',
    icon: 'playlist',
    canHide: false,
    mobileSlot: 'playlists',
  },
  {
    id: 'custom-tracks',
    label: '自定义音乐',
    shortLabel: '作品',
    icon: 'waveform',
    canHide: true,
  },
  { id: 'tags', label: '标签管理', shortLabel: '标签', icon: 'tag', canHide: true },
  { id: 'composer', label: '片段创作', shortLabel: '片段', icon: 'segments', canHide: true },
  { id: 'downloads', label: '下载', shortLabel: '下载', icon: 'download', canHide: true },
  { id: 'history', label: '播放历史', shortLabel: '历史', icon: 'clock', canHide: true },
  { id: 'plugins', label: '插件中心', shortLabel: '插件', icon: 'plugin', canHide: true },
]

export const DEFAULT_DESTINATION_IDS = PRODUCT_DESTINATIONS.map(({ id }) => id)

/** 读取稳定导航描述符；未知标识不会回退到错误页面。 */
export function getProductDestination(id: ProductViewId): ProductDestination {
  return (
    PRODUCT_DESTINATIONS.find((destination) => destination.id === id) ?? PRODUCT_DESTINATIONS[0]
  )
}
