import { AppError } from '@any-music/core'
import type { DownloadedFileSummary } from '@any-music/core'
import { invoke } from '@tauri-apps/api/core'

/** Rust resolves the current native directory; the renderer supplies no filesystem path. */
export async function verifyNativeDownload(
  file: DownloadedFileSummary,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) throw new AppError('operation-cancelled', '下载校验已取消。')
  if (!file.sha256) return false
  const requestId = crypto.randomUUID()
  const cancel = () => {
    void invoke('cancel_request', { requestId }).catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const matches = await invoke<boolean>('verify_download', {
      requestId,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    })
    if (signal.aborted) throw new AppError('operation-cancelled', '下载校验已取消。')
    return matches
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
