import {
  finalizeInterruptedDownloads,
  sanitizeDownloadHistorySnapshot,
  type DownloadHistorySnapshot,
} from '@any-music/core'

import { readStored, writeStored } from '../runtime/storage'

const STORAGE_KEY = 'download-history:v1'

/** 下载历史独立于资料库永久追加；媒体字节和短时 URL 永远不进入稳定存储。 */
export const downloadHistoryRepository = {
  load(): DownloadHistorySnapshot {
    const sanitized = sanitizeDownloadHistorySnapshot(readStored<unknown>(STORAGE_KEY, undefined))
    const restored = finalizeInterruptedDownloads(sanitized, Date.now())
    if (restored !== sanitized) writeStored(STORAGE_KEY, restored)
    return restored
  },

  save(snapshot: DownloadHistorySnapshot): void {
    writeStored(STORAGE_KEY, snapshot)
  },
}
