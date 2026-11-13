import { AppError } from '@any-music/core'
import type { DownloadScheduler } from '@any-music/music-workbench'
import { invoke } from '@tauri-apps/api/core'

/** Rust owns FIFO permits on desktop and mobile; the renderer only executes admitted media work. */
export const nativeDownloadScheduler: DownloadScheduler = {
  async open(concurrency) {
    const scheduleId = await invoke<string>('open_download_schedule', { concurrency })
    return {
      async acquire(_itemId, signal) {
        const taskId = crypto.randomUUID()
        const args = { scheduleId, taskId }
        const cancel = () => {
          void invoke('release_download_slot', args).catch(() => {})
        }
        if (signal.aborted) throw new AppError('operation-cancelled', '下载已暂停或中止。')
        signal.addEventListener('abort', cancel, { once: true })
        try {
          await invoke('acquire_download_slot', args)
          if (signal.aborted) {
            await invoke('release_download_slot', args)
            throw new AppError('operation-cancelled', '下载已暂停或中止。')
          }
          let released = false
          return async () => {
            if (released) return
            released = true
            await invoke('release_download_slot', args)
          }
        } catch (cause) {
          if (signal.aborted)
            throw new AppError('operation-cancelled', '下载已暂停或中止。', { cause })
          throw new AppError('download-failed', '原生下载调度失败，请重新下载。', { cause })
        } finally {
          signal.removeEventListener('abort', cancel)
        }
      },
      async close() {
        await invoke('close_download_schedule', { scheduleId })
      },
    }
  },
}
