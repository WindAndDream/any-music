import { toAppErrorState } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import { useSettingsFeedback } from '@any-music/ui'
import { invoke } from '@tauri-apps/api/core'
import { onScopeDispose, shallowRef } from 'vue'

interface DownloadDirectory {
  directory: string | null
}

/** Native commands own selection and persistence; this state is only a display projection. */
export function useDownloadDirectory() {
  const directory = shallowRef<string | null>(null)
  const busy = shallowRef(false)
  const loaded = shallowRef(false)
  const error = shallowRef<AppErrorState>()
  const feedback = useSettingsFeedback()
  let disposed = false

  async function perform(command: string, success?: string): Promise<void> {
    if (busy.value || disposed) return
    busy.value = true
    error.value = undefined
    try {
      const result = await invoke<DownloadDirectory | null>(command)
      if (disposed || result === null) return
      directory.value = result.directory
      loaded.value = true
      if (success) feedback({ status: 'success', message: success })
    } catch (cause) {
      if (disposed) return
      error.value = toAppErrorState(
        cause,
        command === 'get_download_directory' ? 'storage-read-failed' : 'storage-write-failed',
        typeof cause === 'string' ? cause : '下载目录设置失败，请重试。',
      )
      feedback({ status: 'error', message: error.value.message })
    } finally {
      if (!disposed) busy.value = false
    }
  }

  onScopeDispose(() => {
    disposed = true
  })
  return {
    directory,
    busy,
    loaded,
    error,
    load: () => perform('get_download_directory'),
    choose: () => perform('choose_download_directory', '下载目录已保存。'),
    reset: () => perform('reset_download_directory', '已恢复为每次询问保存位置。'),
  }
}
