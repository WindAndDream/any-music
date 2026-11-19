import { toAppErrorState } from '@any-music/core'
import type { AppErrorState } from '@any-music/core'
import { invoke } from '@tauri-apps/api/core'
import { onMounted, onScopeDispose, shallowRef } from 'vue'
import type { ShallowRef } from 'vue'

import type { AccountPageBounds } from './account-page'
import { mapNativeError } from './native-http'

function closeNative(searchId: string) {
  return invoke('close_douyin_official_search', { searchId }).catch(() => {})
}

function visibleBounds(element: HTMLElement): AccountPageBounds | null {
  const box = element.getBoundingClientRect()
  let left = Math.max(0, Math.ceil(box.left))
  let top = Math.max(0, Math.ceil(box.top))
  let right = Math.min(innerWidth, Math.floor(box.right))
  let bottom = Math.min(innerHeight, Math.floor(box.bottom))
  // The native child must stay inside the part of the drawer the shell actually shows.
  for (let ancestor = layoutParent(element); ancestor; ancestor = layoutParent(ancestor)) {
    if (ancestor.inert) return null
    const { overflowX, overflowY } = getComputedStyle(ancestor)
    if (overflowX === 'visible' && overflowY === 'visible') continue
    const clip = ancestor.getBoundingClientRect()
    if (overflowX !== 'visible') {
      left = Math.max(left, Math.ceil(clip.left + ancestor.clientLeft))
      right = Math.min(right, Math.floor(clip.left + ancestor.clientLeft + ancestor.clientWidth))
    }
    if (overflowY !== 'visible') {
      top = Math.max(top, Math.ceil(clip.top + ancestor.clientTop))
      bottom = Math.min(bottom, Math.floor(clip.top + ancestor.clientTop + ancestor.clientHeight))
    }
  }
  if (right - left < 32 || bottom - top < 32) return null
  const corners = [
    [left + 2, top + 2],
    [right - 2, top + 2],
    [left + 2, bottom - 2],
    [right - 2, bottom - 2],
    [(left + right) / 2, (top + bottom) / 2],
  ] as const
  // The child WebView is outside the DOM. Check both the slot and theme Shadow roots
  // so a scrolled-out viewport or a dialog above it cannot be overpainted.
  let target: Element = element
  while (true) {
    const root = target.getRootNode() as Document | ShadowRoot
    if (
      typeof root.elementFromPoint === 'function' &&
      corners.some(([x, y]) => !target.contains(root.elementFromPoint(x, y)))
    )
      return null
    if (!(root instanceof ShadowRoot)) break
    target = root.host
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function layoutParent(element: HTMLElement): HTMLElement | null {
  const root = element.getRootNode()
  return element.parentElement ?? (root instanceof ShadowRoot ? (root.host as HTMLElement) : null)
}

export function useDouyinOfficialSearch(
  viewport: Readonly<ShallowRef<HTMLElement | null>>,
  request: { accountId?: string; query: string; suspended: boolean },
) {
  const error = shallowRef<AppErrorState>()
  const ready = shallowRef(false)
  let id: string | undefined
  let frame = 0
  let pending = false
  let lastLayout = ''
  let reportedAt = 0

  function measure() {
    frame = 0
    const searchId = id
    const element = viewport.value
    if (!searchId || !ready.value || !element?.isConnected) return
    frame = requestAnimationFrame(measure)
    if (pending) return
    const now = performance.now()
    const bounds = request.suspended || document.hidden ? null : visibleBounds(element)
    const layout = JSON.stringify(bounds)
    if (layout === lastLayout && now - reportedAt < 1000) return
    lastLayout = layout
    reportedAt = now
    pending = true
    void invoke<boolean>('layout_douyin_official_search', { searchId, bounds })
      .then((active) => {
        if (!active && searchId === id) {
          fail('operation-cancelled:抖音搜索页面已关闭，请重试。')
        }
      })
      .catch((cause: unknown) => {
        if (searchId === id) fail(cause)
      })
      .finally(() => {
        pending = false
        if (document.hidden && lastLayout !== 'null') measureNow()
      })
  }

  function measureNow() {
    cancelAnimationFrame(frame)
    measure()
  }

  function stop() {
    const searchId = id
    id = undefined
    ready.value = false
    cancelAnimationFrame(frame)
    frame = 0
    if (searchId) void closeNative(searchId)
  }

  function fail(cause: unknown) {
    stop()
    error.value = toAppErrorState(
      typeof cause === 'string' ? mapNativeError(cause) : cause,
      'upstream-error',
      '无法打开抖音搜索页面。',
    )
  }

  async function start() {
    stop()
    const accountId = request.accountId
    if (!accountId) {
      fail('account-unavailable:请先在账号管理中选择可用的抖音账号。')
      return
    }
    const searchId = crypto.randomUUID()
    id = searchId
    error.value = undefined
    lastLayout = ''
    try {
      await invoke('open_douyin_official_search', {
        accountId,
        query: request.query,
        searchId,
      })
      if (id !== searchId) {
        // Closing can race native startup before the lease exists.
        await closeNative(searchId)
        return
      }
      ready.value = true
      frame = requestAnimationFrame(measure)
    } catch (cause) {
      if (id === searchId) fail(cause)
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', measureNow)
    void start()
  })
  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', measureNow)
    stop()
  })
  return { error, ready, start }
}
