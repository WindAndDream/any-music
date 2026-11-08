import type { UiPluginCenterItem, UiPluginDevelopmentStatus } from './theme-features'

export const PLUGIN_DEVELOPMENT_STATUS_LABELS: Readonly<Record<UiPluginDevelopmentStatus, string>> =
  {
    stable: '正常',
    updating: '更新中',
    fixing: '修复中',
    developing: '开发中',
    disabled: '禁用中',
  }

export function getPluginFailure(item: UiPluginCenterItem): string | undefined {
  return item.status.status === 'error' || item.status.status === 'invalid'
    ? item.status.error.message
    : undefined
}

export function getPluginRuntimeStatusLabel(item: UiPluginCenterItem): string {
  return getPluginFailure(item)
    ? '加载失败'
    : item.status.status === 'loading'
      ? '正在加载'
      : item.enabled
        ? '已启用'
        : item.origin === 'external'
          ? '已撤销'
          : '已停用'
}

/** Retain runtime failures and user settings alongside the developer's maintenance notice. */
export function getPluginStatusLabel(item: UiPluginCenterItem): string {
  const runtime = getPluginRuntimeStatusLabel(item)
  return item.origin === 'builtin' && item.developmentStatus && item.developmentStatus !== 'stable'
    ? `${PLUGIN_DEVELOPMENT_STATUS_LABELS[item.developmentStatus]} · ${runtime}`
    : runtime
}
