import { AppError } from '../errors/app-error'

export const MAX_TRACK_CUSTOM_NAME_LENGTH = 80

/** 空白表示恢复来源原名；所有编辑入口共用相同的规范化与长度规则。 */
export function normalizeTrackCustomName(input: string): string | undefined {
  const name = input.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (name.length > MAX_TRACK_CUSTOM_NAME_LENGTH) {
    throw new AppError(
      'invalid-input',
      `自定义名称不能超过 ${MAX_TRACK_CUSTOM_NAME_LENGTH} 个字符。`,
    )
  }
  return name || undefined
}
