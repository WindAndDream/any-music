import { AppError, normalizeDownloadConcurrency } from '@any-music/core'

/** A slot covers resolution, media reads, encoding and retries. Native runtimes own admission. */
export interface DownloadSchedule {
  acquire(taskId: string, signal: AbortSignal): Promise<() => void | Promise<void>>
  close(): void | Promise<void>
}

export interface DownloadScheduler {
  open(concurrency: number): Promise<DownloadSchedule>
}

/** Tampermonkey has no native task host; one bounded FIFO serves the whole batch. */
export const browserDownloadScheduler: DownloadScheduler = {
  async open(concurrency) {
    const limit = normalizeDownloadConcurrency(concurrency)
    const pending = new Map<string, { grant: () => void; cancel: () => void }>()
    const taskIds = new Set<string>()
    let active = 0
    let closed = false
    const drain = () => {
      while (pending.size) {
        if (closed || active >= limit) break
        const entry = pending.entries().next().value
        if (!entry) break
        pending.delete(entry[0])
        active += 1
        entry[1].grant()
      }
    }
    return {
      acquire(taskId, signal) {
        return new Promise((resolve, reject) => {
          if (taskIds.has(taskId)) return reject(new AppError('invalid-input', '下载任务重复。'))
          const cancel = () => {
            pending.delete(taskId)
            taskIds.delete(taskId)
            signal.removeEventListener('abort', cancel)
            reject(new AppError('operation-cancelled', '下载已暂停或中止。'))
          }
          if (closed || signal.aborted) return cancel()
          taskIds.add(taskId)
          signal.addEventListener('abort', cancel, { once: true })
          pending.set(taskId, {
            cancel,
            grant: () => {
              signal.removeEventListener('abort', cancel)
              let released = false
              resolve(() => {
                if (released) return
                released = true
                active -= 1
                taskIds.delete(taskId)
                drain()
              })
            },
          })
          drain()
        })
      },
      close() {
        closed = true
        for (const entry of pending.values()) entry.cancel()
        pending.clear()
      },
    }
  },
}
