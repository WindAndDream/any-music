import { invoke } from '@tauri-apps/api/core'

/** Queue small native preference writes in click order, independently of library commits. */
export async function loadSidebarCollapsePreference() {
  let collapsed = await invoke<boolean | null>('sidebar_collapse_preference').catch((error) => {
    console.warn('[Any Music] 无法读取侧栏收起状态。', error)
    return null
  })
  let pending = Promise.resolve()
  return {
    read: () => collapsed ?? undefined,
    write(value: boolean) {
      collapsed = value
      pending = pending
        .then(() => invoke<boolean>('sidebar_collapse_preference', { value }))
        .then(() => {})
        .catch((error) => {
          console.warn('[Any Music] 无法保存侧栏收起状态。', error)
        })
    },
  }
}
