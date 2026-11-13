import { AppError } from '../errors/app-error'
import type { AppErrorCode } from '../errors/app-error'
import type { MaterialCollection, SegmentRecipe } from './models'

export type MaterialCollectionErrorCode = Extract<
  AppErrorCode,
  'collection-not-found' | 'source-outside-collection'
>

/** 素材边界错误携带曲目 ID，UI 可直接定位越界的配方项。 */
export class MaterialCollectionError extends AppError {
  declare readonly code: MaterialCollectionErrorCode
  readonly sourceTrackId?: string

  constructor(code: MaterialCollectionErrorCode, message: string, sourceTrackId?: string) {
    super(code, message)
    this.name = 'MaterialCollectionError'
    this.sourceTrackId = sourceTrackId
  }
}

/**
 * 校验一次创作只使用一个素材合集中的直接素材节点。
 *
 * 自定义歌曲在这里被视为可复用的单个素材；其内部叶子来源由片段编译器递归展开，
 * 因此既保持合集边界清楚，也不阻止已有自定义歌曲参与后续创作。
 */
export function assertRecipeUsesMaterialCollection(
  collection: MaterialCollection | undefined,
  recipe: readonly SegmentRecipe[],
): void {
  if (!collection) {
    throw new MaterialCollectionError('collection-not-found', '找不到当前素材合集。')
  }

  const materialTrackIds = new Set(collection.trackIds)
  for (const segment of recipe) {
    if (materialTrackIds.has(segment.sourceTrackId)) continue
    throw new MaterialCollectionError(
      'source-outside-collection',
      `片段来源不属于素材合集“${collection.name}”：${segment.sourceTrackId}`,
      segment.sourceTrackId,
    )
  }
}
