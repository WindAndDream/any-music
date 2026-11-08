import { getDownloadEntryError, type DownloadListEntry } from '@any-music/ui/library'

/** Cards and the actions dialog expose the same task action, including the save boundary. */
export function getDownloadTrackAction(entry: DownloadListEntry) {
  const label = entry.saving
    ? '保存中'
    : entry.state === 'succeeded'
      ? '重新下载'
      : entry.state === 'paused'
        ? '继续下载'
        : entry.state === 'failed'
          ? '重新下载'
          : entry.item.status === 'queued'
            ? '排队中'
            : '下载中'
  return {
    label,
    icon: entry.state === 'downloading' ? ('pause' as const) : ('download' as const),
    event: entry.state === 'downloading' ? ('pause' as const) : ('resume' as const),
    disabled: entry.saving,
    ariaLabel: `${label}《${entry.item.track.title}》${entry.state === 'downloading' && !entry.saving ? '，点击暂停' : ''}`,
  }
}

export function getDownloadTrackStatus(entry: DownloadListEntry): string {
  const { item, state } = entry
  const error = getDownloadEntryError(entry)
  if (error) return error
  if (state === 'succeeded') return '已下载'
  if (item.status === 'cancelled') return '已取消 · 可重新下载'
  if (state === 'paused') return '已暂停 · 点击继续下载'
  return item.progressMessage ?? '等待进入下载队列'
}
