/** 歌曲列表只调整卡片密度；筛选、选择和播放状态不受展示方式切换影响。 */
export type CatalogTrackDisplayMode = 'comfortable' | 'standard' | 'compact'
export type MobileTrackColumns = 1 | 2

export const catalogTrackDisplayModes: readonly {
  id: CatalogTrackDisplayMode
  label: string
  description: string
  columns: number
}[] = [
  { id: 'comfortable', label: '宽松', description: '大封面与完整信息，宽屏约 2 列', columns: 2 },
  { id: 'standard', label: '标准', description: '信息与数量平衡，宽屏约 3 列', columns: 3 },
  { id: 'compact', label: '紧凑', description: '优先浏览更多歌曲，宽屏约 4 列', columns: 4 },
]
