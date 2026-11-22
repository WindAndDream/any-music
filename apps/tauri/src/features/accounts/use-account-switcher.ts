import { formatAppErrorMessage, toAppErrorState } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { computed, onScopeDispose, readonly, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { createDouyinBrowserCatalog } from '../../platform/douyin-browser-catalog'
import { readDouyinAccountNickname } from '../music-sources/douyin-account-nickname'
import { ACCOUNT_PLATFORMS } from './account-presentation'
import type { AccountRuntime } from './account-runtime'
import { getAccountState } from './account-state'

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
  let nicknameReads: CancellationSource | undefined
  const accounts = computed(() =>
    runtime.snapshot.value.accounts.filter((account) => account.platformId === platformId.value),
  )
  const selectedId = computed(() =>
    platformId.value ? (runtime.selectedAccountIds.value[platformId.value] ?? null) : null,
  )

  async function readMissingDouyinNicknames(source: CancellationSource) {
    const defaultId = selectedId.value
    for (const { id } of accounts.value) {
      if (source.signal.isCancelled()) return
      const account = runtime.snapshot.value.accounts.find((candidate) => candidate.id === id)
      // Discover already checks the default account. Fill only missing names on other rows.
      if (
        id === defaultId ||
        !account?.enabled ||
        account.authentication !== 'credential' ||
        getAccountState(account).login !== 'signed-in' ||
        account.platformNickname ||
        runtime.sessionUserNames.value.has(id)
      )
        continue
      try {
        // oxlint-disable-next-line no-await-in-loop -- Bound profile pages to one alternate account at a time.
        const nickname = await readDouyinAccountNickname(
          createDouyinBrowserCatalog(id, source.signal),
          source.signal,
        )
        if (nickname && !source.signal.isCancelled()) {
          // oxlint-disable-next-line no-await-in-loop -- Publish each completed nickname before starting the next read.
          await runtime.refresh()
        }
      } catch {
        // A display read leaves the account selectable and can be retried on the next open.
      }
    }
  }

  async function open(platform: string) {
    if (!toValue(supportedPlatforms).includes(platform)) return
    nicknameReads?.cancel()
    nicknameReads = undefined
    const current = ++generation
    platformId.value = platform
    error.value = ''
    busy.value = true
    try {
      await runtime.refresh()
      if (platform === 'douyin' && current === generation) {
        nicknameReads = new CancellationSource()
        void readMissingDouyinNicknames(nicknameReads)
      }
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
    nicknameReads?.cancel()
    nicknameReads = undefined
    platformId.value = null
    busy.value = false
    error.value = ''
  }
  async function select(id: string, refreshSession: () => Promise<void>) {
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
    close()
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
