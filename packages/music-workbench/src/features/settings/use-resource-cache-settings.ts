import { toAppErrorState } from '@any-music/core'
import {
  MIN_RESOURCE_CACHE_MIB,
  MAX_RESOURCE_CACHE_MIB,
  DEFAULT_MEMORY_CACHE_MIB,
  MAX_MEMORY_CACHE_MIB,
  type ConfirmAction,
  type ResourceCacheSnapshot,
} from '@any-music/ui'
import { onScopeDispose, shallowRef, watch } from 'vue'

export interface ResourceCachePort {
  snapshot(): Promise<ResourceCacheSnapshot>
  configure(capacityBytes: number): Promise<ResourceCacheSnapshot>
  configureMemory(capacityBytes: number): Promise<ResourceCacheSnapshot>
  clear(): Promise<ResourceCacheSnapshot>
  chooseDirectory?(reset: boolean): Promise<ResourceCacheSnapshot | null>
}

/** One controller above replaceable themes. Confirmations never outlive the settings session. */
export function useResourceCacheSettings(
  port: ResourceCachePort | undefined,
  confirm: ConfirmAction,
  active: () => boolean,
) {
  const snapshot = shallowRef<ResourceCacheSnapshot>()
  const capacityMib = shallowRef('1024')
  const memoryCapacityMib = shallowRef(String(DEFAULT_MEMORY_CACHE_MIB))
  const busy = shallowRef(false)
  const error = shallowRef('')
  const notice = shallowRef('')
  let disposed = false
  let generation = 0
  async function run(
    operation: () => Promise<ResourceCacheSnapshot | null>,
    message = '',
    syncDraft = false,
  ) {
    if (busy.value || disposed) return
    busy.value = true
    error.value = ''
    notice.value = ''
    try {
      const result = await operation()
      if (!disposed && result) {
        snapshot.value = result
        if (syncDraft) {
          capacityMib.value = String(result.capacityBytes / 1024 ** 2)
          memoryCapacityMib.value = String(result.memoryCapacityBytes / 1024 ** 2)
        }
        notice.value = message
      }
    } catch (cause) {
      if (!disposed)
        error.value = toAppErrorState(
          cause,
          'storage-write-failed',
          '缓存操作失败，请检查可用空间和目录权限。',
        ).message
    } finally {
      if (!disposed) busy.value = false
    }
  }
  const refresh = () => port && run(() => port.snapshot(), '', !snapshot.value)
  watch(
    active,
    (open) => {
      generation++
      if (open) {
        error.value = ''
        notice.value = ''
        if (snapshot.value) {
          capacityMib.value = String(snapshot.value.capacityBytes / 1024 ** 2)
          memoryCapacityMib.value = String(snapshot.value.memoryCapacityBytes / 1024 ** 2)
        }
        void refresh()
      }
    },
    { immediate: true, flush: 'sync' },
  )
  async function save() {
    if (!port || !active() || busy.value) return
    const value = Number(capacityMib.value)
    if (
      !Number.isSafeInteger(value) ||
      value < MIN_RESOURCE_CACHE_MIB ||
      value > MAX_RESOURCE_CACHE_MIB
    ) {
      error.value = '请输入 128 至 102400 之间的整数（MiB）。'
      return
    }
    if (snapshot.value && value * 1024 ** 2 < snapshot.value.usedBytes) {
      const current = generation
      busy.value = true
      const accepted = await confirm({
        title: '缩小缓存容量？',
        message: '超出新上限的图片、封面与歌曲片段将立即清理，需要时会重新获取。',
        confirmLabel: '缩小并保存',
        tone: 'danger',
      })
      busy.value = false
      if (!accepted || disposed || current !== generation || !active()) return
    }
    await run(async () => {
      const result = await port.configure(value * 1024 ** 2)
      if (!disposed) capacityMib.value = String(result.capacityBytes / 1024 ** 2)
      return result
    }, '硬盘缓存上限已保存。')
  }
  async function saveMemory() {
    if (!port || !active() || busy.value) return
    const value = Number(memoryCapacityMib.value)
    if (
      !memoryCapacityMib.value.trim() ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > MAX_MEMORY_CACHE_MIB
    ) {
      error.value = '请输入 0 至 1024 之间的整数（MiB），0 表示关闭内存缓存。'
      return
    }
    await run(async () => {
      const result = await port.configureMemory(value * 1024 ** 2)
      if (!disposed) memoryCapacityMib.value = String(result.memoryCapacityBytes / 1024 ** 2)
      return result
    }, '内存缓存上限已保存。')
  }
  async function clear() {
    if (!port || busy.value || !active()) return
    const current = generation
    busy.value = true
    const accepted = await confirm({
      title: '清除全部资源缓存？',
      message:
        '将删除缓存的图片、封面与歌曲片段。歌曲库、收藏、播放历史和已下载文件不会删除；后续访问会重新缓存。',
      confirmLabel: '清除缓存',
      tone: 'danger',
    })
    busy.value = false
    if (!accepted || disposed || current !== generation || !active()) return
    await run(() => port.clear(), '缓存已清除。正在使用的资源可能随后产生新的缓存。')
  }
  async function chooseDirectory(reset: boolean) {
    if (!port?.chooseDirectory || busy.value || !active()) return
    const current = generation
    busy.value = true
    const accepted = await confirm({
      title: '更改缓存目录？',
      message: '旧目录中的资源缓存将清理，新资源会写入新目录。歌曲库与下载文件不受影响。',
      confirmLabel: '继续选择',
    })
    busy.value = false
    if (!accepted || disposed || current !== generation || !active()) return
    await run(() => port.chooseDirectory!(reset), '缓存目录已更新。')
  }
  onScopeDispose(() => {
    disposed = true
    generation++
  })
  return {
    snapshot,
    capacityMib,
    memoryCapacityMib,
    busy,
    error,
    notice,
    refresh,
    save,
    saveMemory,
    clear,
    chooseDirectory,
  }
}
