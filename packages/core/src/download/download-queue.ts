/** 下载调度允许的最小并发数；串行下载也是受支持的显式配置。 */
export const MIN_DOWNLOAD_CONCURRENCY = 1

/** 下载调度的默认并发数，在用户尚未保存设置时使用。 */
export const DEFAULT_DOWNLOAD_CONCURRENCY = 2

/** 浏览器端下载的并发硬上限，防止大媒体同时解码导致内存失控。 */
export const MAX_DOWNLOAD_CONCURRENCY = 5

/** 单首歌曲首次失败后最多重新执行的次数。 */
export const MAX_DOWNLOAD_RETRY_COUNT = 3

export interface DownloadAttemptEvent<Item> {
  item: Item
  itemIndex: number
  /** 从 1 开始；最大值为首次尝试加允许的重试次数。 */
  attemptNumber: number
  maxAttemptCount: number
}

export interface DownloadAttemptFailureEvent<Item> extends DownloadAttemptEvent<Item> {
  error: unknown
  /** 本次失败后是否还会重试。 */
  willRetry: boolean
}

export interface DownloadCancellationEvent<Item> {
  item: Item
  itemIndex: number
  /** 取消前已经开始过的尝试次数；尚未调度的歌曲为 0。 */
  attemptCount: number
}

export interface RunConcurrentDownloadsOptions<Item, Value> {
  concurrency: number
  /** 失败后的重试次数，不包含首次尝试；超过硬上限的输入会被收敛。 */
  maxRetryCount?: number
  download: (item: Item, event: DownloadAttemptEvent<Item>) => Promise<Value>
  onAttemptStart?: (event: DownloadAttemptEvent<Item>) => void
  onAttemptFailure?: (event: DownloadAttemptFailureEvent<Item>) => void
  /** 由运行端决定退避时长；core 不依赖浏览器或 Node 定时器。 */
  waitBeforeRetry?: (event: DownloadAttemptFailureEvent<Item>) => Promise<void>
  /** 调用方通过平台无关的查询函数请求停止，避免 core 依赖 DOM AbortSignal。 */
  isCancelled?: () => boolean
  /** 单曲中止只影响该任务，其他歌曲仍按同一并发池继续处理。 */
  isTaskCancelled?: (item: Item, itemIndex: number) => boolean
  onTaskCancelled?: (event: DownloadCancellationEvent<Item>) => void
}

export type ConcurrentDownloadResult<Item, Value> =
  | {
      status: 'succeeded'
      item: Item
      itemIndex: number
      attemptCount: number
      value: Value
    }
  | {
      status: 'failed'
      item: Item
      itemIndex: number
      attemptCount: number
      error: unknown
    }
  | {
      status: 'cancelled'
      item: Item
      itemIndex: number
      attemptCount: number
    }

/** 将不可信设置收敛到 1～5 的整数并发值。 */
export function normalizeDownloadConcurrency(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return DEFAULT_DOWNLOAD_CONCURRENCY
  return Math.min(MAX_DOWNLOAD_CONCURRENCY, Math.max(MIN_DOWNLOAD_CONCURRENCY, Math.trunc(input)))
}

/**
 * 按全局并发上限调度一批独立下载，并保持结果与输入顺序一致。
 * 单项耗尽重试只会产生失败结果，不会取消同一批次的其他歌曲。
 */
export async function runConcurrentDownloads<Item, Value>(
  items: readonly Item[],
  options: RunConcurrentDownloadsOptions<Item, Value>,
): Promise<readonly ConcurrentDownloadResult<Item, Value>[]> {
  if (items.length === 0) return []

  const concurrency = Math.min(normalizeDownloadConcurrency(options.concurrency), items.length)
  const maxRetryCount = normalizeRetryCount(options.maxRetryCount)
  const maxAttemptCount = maxRetryCount + 1
  const resultByItemIndex = new Map<number, ConcurrentDownloadResult<Item, Value>>()
  let nextItemIndex = 0

  async function runWorker(): Promise<void> {
    while (nextItemIndex < items.length) {
      const itemIndex = nextItemIndex
      nextItemIndex += 1
      const item = items[itemIndex]
      if (item === undefined) continue

      if (isTaskCancelled(item, itemIndex)) {
        markTaskCancelled(item, itemIndex, 0)
        continue
      }

      for (let attemptNumber = 1; attemptNumber <= maxAttemptCount; attemptNumber += 1) {
        if (isTaskCancelled(item, itemIndex)) {
          markTaskCancelled(item, itemIndex, attemptNumber - 1)
          break
        }
        const event: DownloadAttemptEvent<Item> = {
          item,
          itemIndex,
          attemptNumber,
          maxAttemptCount,
        }
        options.onAttemptStart?.(event)
        try {
          // 每个 worker 内部必须串行等待；并发仅来自固定数量的 worker。
          // eslint-disable-next-line no-await-in-loop
          const value = await options.download(item, event)
          resultByItemIndex.set(itemIndex, {
            status: 'succeeded',
            item,
            itemIndex,
            attemptCount: attemptNumber,
            value,
          })
          break
        } catch (error) {
          if (isTaskCancelled(item, itemIndex)) {
            markTaskCancelled(item, itemIndex, attemptNumber)
            break
          }
          const willRetry = attemptNumber < maxAttemptCount
          const failureEvent = { ...event, error, willRetry }
          options.onAttemptFailure?.(failureEvent)
          if (!willRetry) {
            resultByItemIndex.set(itemIndex, {
              status: 'failed',
              item,
              itemIndex,
              attemptCount: attemptNumber,
              error,
            })
            break
          }
          if (options.waitBeforeRetry) {
            // 退避属于同一首歌的 worker 生命周期，不占用额外并发槽位。
            // eslint-disable-next-line no-await-in-loop
            await options.waitBeforeRetry(failureEvent)
          }
        }
      }
    }
  }

  function markTaskCancelled(item: Item, itemIndex: number, attemptCount: number): void {
    const event = { item, itemIndex, attemptCount }
    options.onTaskCancelled?.(event)
    resultByItemIndex.set(itemIndex, { status: 'cancelled', ...event })
  }

  function isTaskCancelled(item: Item, itemIndex: number): boolean {
    return Boolean(options.isCancelled?.() || options.isTaskCancelled?.(item, itemIndex))
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()))
  return items.map((_item, itemIndex) => {
    const result = resultByItemIndex.get(itemIndex)
    if (!result) throw new Error(`下载任务 ${itemIndex} 没有产生结果。`)
    return result
  })
}

function normalizeRetryCount(input: number | undefined): number {
  if (input === undefined || !Number.isFinite(input)) return MAX_DOWNLOAD_RETRY_COUNT
  return Math.min(MAX_DOWNLOAD_RETRY_COUNT, Math.max(0, Math.trunc(input)))
}
