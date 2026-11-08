import { formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import { computed, onScopeDispose, readonly, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { ACCOUNT_PLATFORMS } from './account-presentation'
import type { AccountRuntime } from './account-runtime'

/** The switcher owns one platform at a time and ignores results from a closed dialog. */
export function useAccountSwitcher(
  runtime: AccountRuntime,
  supportedPlatforms: MaybeRefOrGetter<readonly string[]> = ACCOUNT_PLATFORMS.map(
    (platform) => platform.id,
  ),
) {
  const platformId = shallowRef<string | null>(null)
  const busy = shallowRef(false)
  const error = shallowRef('')
  let generation = 0
  let disposed = false
  const accounts = computed(() =>
    runtime.snapshot.value.accounts.filter((account) => account.platformId === platformId.value),
  )
  const selectedId = computed(() =>
    platformId.value ? (runtime.selectedAccountIds.value[platformId.value] ?? null) : null,
  )

  async function open(platform: string) {
    if (!toValue(supportedPlatforms).includes(platform)) return
    const current = ++generation
    platformId.value = platform
    error.value = ''
    busy.value = true
    try {
      await runtime.refresh()
    } catch (cause) {
      if (current === generation)
        error.value = formatAppErrorMessage(
          toAppErrorState(cause, 'upstream-error', '账号列表刷新失败。'),
        )
    } finally {
      if (current === generation) busy.value = false
    }
  }
  function close() {
    generation++
    platformId.value = null
    busy.value = false
    error.value = ''
  }
  async function select(id: string | null, refreshSession: () => Promise<void>) {
    if (!platformId.value || busy.value) return
    const current = generation
    busy.value = true
    error.value = ''
    try {
      await runtime.selectAccount(platformId.value, id)
      if (disposed) return
      if (current === generation) {
        busy.value = false
        close()
      }
      await refreshSession()
    } catch (cause) {
      if (current === generation)
        error.value = formatAppErrorMessage(
          toAppErrorState(cause, 'upstream-error', '账号切换失败，请重试。'),
        )
    } finally {
      if (current === generation) busy.value = false
    }
  }
  async function refresh(refreshSession: () => Promise<void>) {
    const platform = platformId.value
    if (!platform || busy.value) return
    await open(platform)
    if (platformId.value === platform) await refreshSession()
  }
  onScopeDispose(() => {
    disposed = true
    generation++
  })
  return {
    platformId: readonly(platformId),
    accounts,
    selectedId,
    busy: readonly(busy),
    error: readonly(error),
    open,
    close,
    select,
    refresh,
  }
}
