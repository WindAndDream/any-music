import type { CollectionItemStyle } from '@any-music/ui/library'

/** Build-owned styles are presentation choices, independent of complete themes and dialogs. */
export const collectionItemStyles: readonly {
  id: CollectionItemStyle
  label: string
  description: string
}[] = [
  { id: 'minimal', label: '留白', description: '突出封面与内容，操作收进三点菜单' },
  { id: 'default', label: '直显', description: '常用操作直接显示在卡片中' },
]

export function playbackProgress(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) return 0
  // Ended tracks return to the origin; a looping player supplies its next real position.
  return positionMs >= durationMs ? 0 : Math.max(0, positionMs / durationMs)
}
