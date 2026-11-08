import { describe, expect, it } from 'vitest'

import { getPlayerDownloadFeedback } from '#workbench/features/downloads/player-download-feedback'

describe('player download feedback', () => {
  it.each([
    ['queued', 'info', 'clock', '等待下载'],
    ['downloading', 'info', 'download', '歌曲下载中'],
    ['succeeded', 'success', 'check', '歌曲已下载'],
    ['paused', 'warning', 'pause', '下载暂停中'],
    ['failed', 'error', 'warning', '歌曲下载失败'],
    ['cancelled', 'neutral', 'close', '下载已取消'],
    ['interrupted', 'warning', 'warning', '下载已中断'],
    ['busy', 'warning', 'clock', '暂时无法开始下载'],
  ] as const)('shows the matching tone and icon for %s', (status, tone, icon, label) => {
    expect(
      getPlayerDownloadFeedback({ trackId: 'song:1', trackTitle: '第一首歌', status }),
    ).toEqual({ status: tone, icon, message: `第一首歌 · ${label}` })
  })

  it('keeps cancelled saving neutral while preserving its error detail', () => {
    expect(
      getPlayerDownloadFeedback({
        trackId: 'song:1',
        trackTitle: '第一首歌',
        status: 'cancelled',
        detail: '已取消保存文件。（错误码：AM-1005）',
      }),
    ).toEqual({
      status: 'neutral',
      icon: 'close',
      message: '第一首歌 · 下载已取消：已取消保存文件。（错误码：AM-1005）',
    })
  })
})
