import type { CatalogFilterContext } from '../components/music-sources/catalog-track-filter-presentation'
import type { ProductViewId } from './product-navigation'

export interface FilterHistorySettingsRegion {
  context: CatalogFilterContext
  title: string
  description: string
}

/** 只登记已支持历史的筛选区域；板块、子区域和实际筛选维度保持同一层级。 */
export const FILTER_HISTORY_SETTINGS_GROUPS: readonly {
  id: ProductViewId
  title: string
  regions: readonly FilterHistorySettingsRegion[]
}[] = [
  {
    id: 'catalog',
    title: '发现',
    regions: [
      {
        context: 'drawers',
        title: '音乐列表筛选',
        description: '用于搜索与导入后生成的音乐列表，按文本、平台、命名和搜索时间筛选。',
      },
      {
        context: 'tracks',
        title: '列表内歌曲筛选',
        description: '进入音乐列表后使用。各列表独立保存历史，共用此处的数量配置。',
      },
    ],
  },
  {
    id: 'queue',
    title: '待听',
    regions: [
      {
        context: 'queue',
        title: '待听歌曲筛选',
        description: '按文本、标签、歌曲时长、平台和加入待听的日期筛选。',
      },
    ],
  },
  {
    id: 'favorites',
    title: '我的喜欢',
    regions: [
      {
        context: 'favorites',
        title: '喜欢歌曲筛选',
        description: '按文本、标签、歌曲时长、平台和喜欢的日期筛选。',
      },
    ],
  },
  {
    id: 'downloads',
    title: '下载',
    regions: [
      {
        context: 'downloads',
        title: '下载歌曲筛选',
        description: '按文本、标签、歌曲时长、平台和创建下载任务的日期筛选。',
      },
    ],
  },
]
