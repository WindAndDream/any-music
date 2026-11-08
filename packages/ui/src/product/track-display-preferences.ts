import type { AppErrorState } from '@any-music/core'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../components/music-sources/catalog-track-display-mode'

export type CollectionItemStyle = 'default' | 'minimal'

export interface TrackDisplayPreferences {
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  itemStyle?: CollectionItemStyle
}

export type CollectionDisplayId =
  | 'catalog'
  | 'queue'
  | 'favorites'
  | 'playlists'
  | 'downloads'
  | 'history'
  | 'custom-tracks'
  | 'tags'
  | 'plugins'
export type CollectionDisplayRegion = 'tracks' | 'playlist-cards' | 'associated-tracks'
export interface CollectionDisplayPreferences extends TrackDisplayPreferences {
  layout?: 'grid' | 'list' | 'fill' | 'rows'
}
export type CollectionDisplayDefaults = Partial<
  Record<
    CollectionDisplayId,
    Partial<Record<CollectionDisplayRegion, CollectionDisplayPreferences>>
  >
>
export type SetCollectionDisplayDefault = (
  collection: CollectionDisplayId,
  region: CollectionDisplayRegion,
  patch: Partial<CollectionDisplayPreferences>,
) => AppErrorState | void

/** Stable regions shared by settings and collection fallback resolution. */
export const COLLECTION_DISPLAY_GROUPS: readonly {
  id: CollectionDisplayId
  title: string
  regions: readonly {
    id: CollectionDisplayRegion
    title: string
    subject: string
    hideArrangement?: boolean
    layoutOptions?: readonly {
      id: 'grid' | 'list' | 'fill' | 'rows'
      label: string
      description: string
    }[]
  }[]
}[] = [
  {
    id: 'catalog',
    title: '发现',
    regions: [{ id: 'tracks', title: '列表内歌曲', subject: '歌曲' }],
  },
  { id: 'queue', title: '待听', regions: [{ id: 'tracks', title: '待听歌曲', subject: '歌曲' }] },
  {
    id: 'favorites',
    title: '我的喜欢',
    regions: [{ id: 'tracks', title: '喜欢歌曲', subject: '歌曲' }],
  },
  {
    id: 'playlists',
    title: '我的歌单',
    regions: [
      { id: 'playlist-cards', title: '歌单封面', subject: '歌单' },
      { id: 'tracks', title: '歌单内歌曲', subject: '歌曲' },
    ],
  },
  {
    id: 'downloads',
    title: '下载管理',
    regions: [{ id: 'tracks', title: '下载歌曲', subject: '歌曲' }],
  },
  {
    id: 'history',
    title: '播放历史',
    regions: [{ id: 'tracks', title: '历史歌曲', subject: '歌曲', hideArrangement: true }],
  },
  {
    id: 'custom-tracks',
    title: '自定义音乐',
    regions: [{ id: 'tracks', title: '自定义歌曲', subject: '歌曲', hideArrangement: true }],
  },
  {
    id: 'tags',
    title: '标签管理',
    regions: [
      {
        id: 'tracks',
        title: '标签',
        subject: '标签',
        hideArrangement: true,
        layoutOptions: [
          {
            id: 'fill',
            label: '默认撑满',
            description: '标签按名称长度排列，最多一行；行尾标签占用剩余宽度，超出文字省略。',
          },
          { id: 'rows', label: '单独一行', description: '每个标签独占一行，方便逐个查看和整理。' },
        ],
      },
      { id: 'associated-tracks', title: '关联音乐', subject: '歌曲' },
    ],
  },
  {
    id: 'plugins',
    title: '插件中心',
    regions: [
      {
        id: 'tracks',
        title: '插件',
        subject: '插件',
        hideArrangement: true,
        layoutOptions: [
          { id: 'grid', label: '卡片', description: '以卡片浏览插件。' },
          { id: 'list', label: '列表', description: '逐行查看插件。' },
        ],
      },
    ],
  },
]

/** Each collection view has its own density and phone columns, including unseen views. */
export function getTrackDisplayPreferences(
  state: TrackDisplayPreferences & {
    displayPreferences?: Readonly<Record<string, TrackDisplayPreferences>>
    defaultDisplayPreferences?: TrackDisplayPreferences
  },
  scope: string,
): TrackDisplayPreferences {
  return state.displayPreferences
    ? (state.displayPreferences[scope] ??
        state.defaultDisplayPreferences ?? { displayMode: 'standard', mobileColumns: 1 })
    : state
}
