import type { MediaLoadingStrategy } from './plugin'

/** 平台可接受的分页范围；不同来源只需声明自己的默认值与上限。 */
export interface PageSizePolicy {
  defaultSize: number
  maxSize: number
  minSize?: number
}

/**
 * 把 UI 建议页大小归一为平台允许的正整数。
 *
 * `undefined`、`NaN` 与无穷值使用默认值；策略本身无效时抛出 `RangeError`，避免错误的
 * 平台常量在运行时悄悄产生空页或无限分页。
 */
export function normalizePageSize(value: number | undefined, policy: PageSizePolicy): number {
  const minSize = policy.minSize ?? 1
  if (
    !Number.isInteger(minSize) ||
    !Number.isInteger(policy.defaultSize) ||
    !Number.isInteger(policy.maxSize) ||
    minSize < 1 ||
    policy.defaultSize < minSize ||
    policy.defaultSize > policy.maxSize
  ) {
    throw new RangeError('分页策略必须满足 1 <= minSize <= defaultSize <= maxSize。')
  }

  const candidate = value === undefined || !Number.isFinite(value) ? policy.defaultSize : value
  return Math.min(policy.maxSize, Math.max(minSize, Math.floor(candidate)))
}

/** 根据媒体时长选择浏览器预加载策略；未知或异常时长一律采用更保守的 Range。 */
export function selectMediaLoadingStrategy(
  durationMs: number | undefined,
  eagerThresholdMs: number,
): MediaLoadingStrategy {
  if (!Number.isFinite(eagerThresholdMs) || eagerThresholdMs < 0) {
    throw new RangeError('媒体 eager 阈值必须是非负有限毫秒数。')
  }
  return durationMs !== undefined &&
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    durationMs <= eagerThresholdMs
    ? 'eager'
    : 'range'
}
