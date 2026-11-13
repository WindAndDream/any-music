import { formatAppErrorMessage } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'

import type { AppIconName } from '../components/app-icon'

/** 产品操作提示的唯一文案目录；领域错误仍保留自己的 AppErrorState 与状态码。 */
export const ACTION_FEEDBACK_MESSAGES = {
  settings: { label: '设置操作', success: '设置已保存。' },
  displaySettings: { label: '展示方式保存', success: '默认展示方式已保存。' },
  profile: { label: '创作者名称保存', success: '创作者名称已保存。' },
  historySettings: { label: '播放历史设置保存', success: '播放历史设置已保存。' },
  downloadSettings: { label: '下载设置保存', success: '下载设置已保存。' },
  proxySettings: { label: '代理配置保存', success: '代理配置已保存。' },
  proxyEnabled: { label: '启用请求代理', success: '请求代理已启用。' },
  proxyDisabled: { label: '关闭请求代理', success: '请求代理已关闭。' },
  filterHistorySettings: { label: '筛选历史设置保存', success: '筛选历史设置已保存。' },
  favorite: { label: '添加喜欢', success: '已添加到我的喜欢。' },
  unfavorite: { label: '取消喜欢', success: '已取消喜欢。' },
  playlistAdd: { label: '加入歌单', success: '已加入歌单，已有歌曲保持不变。' },
  playlistCreate: { label: '创建歌单', success: '歌单已创建。' },
  playlistDelete: { label: '删除歌单', success: '歌单已删除。' },
  playlistRemove: { label: '从歌单移除', success: '歌曲已从歌单移除。' },
  trackRename: { label: '歌曲命名', success: '歌曲名称已更新。' },
  drawerRename: { label: '音乐列表命名', success: '音乐列表名称已更新。' },
  drawerPin: { label: '音乐列表置顶', success: '音乐列表置顶状态已更新。' },
  drawerReorder: { label: '音乐列表排序', success: '音乐列表顺序已保存。' },
  drawerDelete: { label: '删除音乐列表', success: '已删除选中的音乐列表。' },
  trackRestore: { label: '恢复歌曲原名', success: '已恢复歌曲原名。' },
  drawerRestore: { label: '恢复音乐列表原名', success: '已恢复音乐列表原名。' },
  tagAdd: { label: '添加标签', success: '标签已添加。' },
  tagRemove: { label: '移除标签', success: '标签已移除。' },
  tagRename: { label: '标签重命名', success: '标签名称已更新。' },
  tagDelete: { label: '删除标签', success: '标签已删除。' },
  historyClear: { label: '清空播放历史', success: '播放历史已清空。' },
  queueAdd: { label: '加入待听', success: '已加入待听。' },
  queueRemove: { label: '移除待听歌曲', success: '已移出待听。' },
  downloadStart: { label: '启动下载', success: '下载任务已创建，可在“下载”查看进度。' },
  downloadComplete: { label: '下载', success: '歌曲下载已完成。' },
  export: { label: '音频导出', success: '音频已导出。' },
} as const

export type ActionFeedbackKind = keyof typeof ACTION_FEEDBACK_MESSAGES
/** 提示颜色表达结果语义，具体流程可指定目录内图标，避免将进行中误画为成功。 */
export type ActionFeedbackTone = 'success' | 'info' | 'warning' | 'error' | 'neutral'
export type ActionFeedbackResult = (
  | { status: ActionFeedbackTone; message: string }
  | { status: 'error'; error: AppErrorState; action?: ActionFeedbackKind }
) & { icon?: AppIconName }

export const ALREADY_PLAYING_MESSAGE = '这首歌曲已经在播放器中'

export function getPlaylistAlreadyAddedMessage(name: string): string {
  return `已选歌曲均已加入“${name}”，无需重复添加。`
}
export const EXPORT_PREPARING_MESSAGE = '正在准备音频导出…'
export const FILTERS_RESET_MESSAGE = '筛选条件已重置。'
export const PINNED_DRAWER_REORDER_MESSAGE = '置顶列表无法与未置顶列表交换位置，请先取消置顶。'
export const QUEUE_DRAG_READY_MESSAGE = '已进入拖拽排序，移动调整顺序，松手完成。'

export function getSelectionFeedbackMessage(count: number, unit: '首歌曲' | '个音乐列表'): string {
  return count > 0 ? `已选择 ${count} ${unit}。` : '已取消选择。'
}

export function getActionSuccessMessage(action: ActionFeedbackKind, count?: number): string {
  if (action === 'queueAdd' && count !== undefined) {
    return count > 0
      ? `已按勾选顺序添加 ${count} 首歌曲到待听，已有歌曲保持原位。`
      : '已选歌曲均已在待听中。'
  }
  if (action === 'trackRestore' || action === 'drawerRestore') {
    const unit = action === 'trackRestore' ? '首歌曲' : '个音乐列表'
    return count ? `已恢复 ${count} ${unit}的原名。` : '已选项均使用原名，无需恢复。'
  }
  return ACTION_FEEDBACK_MESSAGES[action].success
}

export function formatActionFeedback(result: ActionFeedbackResult): string {
  return 'message' in result
    ? result.message
    : `${ACTION_FEEDBACK_MESSAGES[result.action ?? 'settings'].label}失败：${formatAppErrorMessage(result.error)}`
}

export function getFilterHistorySavedMessage(regionTitle: string): string {
  return `${regionTitle}的历史设置已保存。`
}

export function getExportSavedMessage(title: string, extension: string): string {
  return `“${title}”已导出为 ${extension.toUpperCase()}。`
}
