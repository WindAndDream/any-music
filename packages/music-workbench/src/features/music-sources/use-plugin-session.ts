import { createAppErrorState, toAppErrorState } from '@any-music/core'
import type { AppErrorState, MusicSourcePlugin, MusicSourceSession } from '@any-music/core'
import { getCurrentScope, onScopeDispose, readonly, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'

/** 把任意音乐源的会话请求收敛为可显式刷新、可转入过期态的 UI 状态机。 */
export function usePluginSession(pluginSource: MaybeRefOrGetter<MusicSourcePlugin>) {
  const session = shallowRef<MusicSourceSession>({ status: 'checking' })
  const isRefreshing = shallowRef(false)
  const sessionsByPluginId = new Map<string, MusicSourceSession>()
  let sessionPluginId: string | undefined
  let refreshGeneration = 0

  if (getCurrentScope()) {
    onScopeDispose(() => {
      refreshGeneration += 1
      isRefreshing.value = false
    })
  }

  async function refresh() {
    refreshGeneration += 1
    const generation = refreshGeneration
    isRefreshing.value = true
    let pluginId: string | undefined
    try {
      const plugin = toValue(pluginSource)
      pluginId = plugin.descriptor.id
      // Preserve identity on same-source refresh, but never display another source's session.
      if (sessionPluginId !== pluginId) {
        sessionPluginId = pluginId
        session.value = sessionsByPluginId.get(pluginId) ?? { status: 'checking' }
      }
      const nextSession: MusicSourceSession = plugin.descriptor.capabilities.session
        ? await plugin.getSession()
        : { status: 'not-required' }
      // 切换音乐源后旧请求可能更晚返回；只有最新一代可以接管当前会话。
      if (generation === refreshGeneration) {
        session.value = nextSession
        sessionsByPluginId.set(pluginId, nextSession)
      }
    } catch (error) {
      if (generation !== refreshGeneration) return
      session.value = {
        status: 'unavailable',
        error: toAppErrorState(error, 'upstream-error', '音乐源登录状态检查失败。'),
      }
      if (pluginId !== undefined) sessionsByPluginId.set(pluginId, session.value)
    } finally {
      if (generation === refreshGeneration) isRefreshing.value = false
    }
  }

  function markExpired(
    error: AppErrorState = createAppErrorState(
      'not-authenticated',
      '音乐源登录已失效，请重新登录后重试。',
    ),
  ) {
    // 播放阶段确认失效时，任何仍在途的旧刷新结果都不再可信。
    refreshGeneration += 1
    isRefreshing.value = false
    sessionPluginId = toValue(pluginSource).descriptor.id
    session.value = { status: 'expired', error }
    sessionsByPluginId.set(sessionPluginId, session.value)
  }

  function openLogin() {
    const url = toValue(pluginSource).getLoginUrl()
    if (url) getWorkbenchRuntime().openLogin(url, toValue(pluginSource).descriptor.id)
  }

  /** 身份撤销使缓存和在途检查一起失效；刷新仍由用户操作驱动。 */
  function invalidateSource(pluginId: string, error: AppErrorState): void {
    sessionsByPluginId.delete(pluginId)
    if (toValue(pluginSource).descriptor.id !== pluginId) return
    refreshGeneration += 1
    isRefreshing.value = false
    sessionPluginId = pluginId
    session.value = { status: 'unavailable', error }
  }

  return {
    session: readonly(session),
    isRefreshing: readonly(isRefreshing),
    refresh,
    markExpired,
    getKnownSession: (pluginId: string) => sessionsByPluginId.get(pluginId),
    openLogin,
    invalidateSource,
  }
}
