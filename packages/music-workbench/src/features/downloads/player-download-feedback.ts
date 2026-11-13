import type { ActionFeedbackResult, ActionFeedbackTone, AppIconName } from '@any-music/ui'

import { formatPlayerDownloadNotice } from './use-player-download'
import type { PlayerDownloadNotice, PlayerDownloadStatus } from './use-player-download'

/** 下载状态复用操作器的提示槽与主题色；只有实际保存成功才使用成功勾选图标。 */
const downloadFeedbackStyles: Record<
  PlayerDownloadStatus,
  { tone: ActionFeedbackTone; icon: AppIconName }
> = {
  queued: { tone: 'info', icon: 'clock' },
  downloading: { tone: 'info', icon: 'download' },
  succeeded: { tone: 'success', icon: 'check' },
  paused: { tone: 'warning', icon: 'pause' },
  failed: { tone: 'error', icon: 'warning' },
  cancelled: { tone: 'neutral', icon: 'close' },
  interrupted: { tone: 'warning', icon: 'warning' },
  busy: { tone: 'warning', icon: 'clock' },
}

export function getPlayerDownloadFeedback(notice: PlayerDownloadNotice): ActionFeedbackResult {
  const style = downloadFeedbackStyles[notice.status]
  return {
    status: style.tone,
    icon: style.icon,
    message: formatPlayerDownloadNotice(notice),
  }
}
