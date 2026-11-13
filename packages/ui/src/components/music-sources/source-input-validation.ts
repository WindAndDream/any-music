import type { MusicSourceImportUrlScope } from '@any-music/core'

/**
 * 在请求进入音乐源插件前提供即时 URL 范围反馈。
 * 最终提交仍由插件自己的 validateImportUrl 执行，避免界面提示成为安全边界。
 */
export function getImportUrlScopeError(
  input: string,
  scopes: readonly MusicSourceImportUrlScope[],
): string {
  const value = input.trim()
  if (!value) return ''

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return '请输入包含 https:// 的完整网址。'
  }

  const isAccepted = scopes.some(
    (scope) => parsed.origin === scope.origin && parsed.pathname.startsWith(scope.pathnamePrefix),
  )
  return isAccepted ? '' : '该网址不在当前音乐源声明的可导入范围内。'
}
