import { AppError, toAppErrorState } from '@any-music/core'
import { CancellationSource } from '@any-music/network-routing'
import { invoke } from '@tauri-apps/api/core'
import { onScopeDispose, shallowRef } from 'vue'

import type { AccountRuntime, NativeAccount } from './account-runtime'
import type { AccountState } from './account-state'
import { getAccountState } from './account-state'

export interface AccountCheckResult {
  status: 'signed-in' | 'signed-out' | 'not-required' | 'verification-required' | 'unavailable'
  message: string
  checkedAtMs: number
  state: AccountState
}

/** Explicit, serial checks keep each identity, never compete with another account or retry login. */
export function useAccountChecks(
  runtime: AccountRuntime,
  supportsAccount = (_account: NativeAccount) => true,
) {
  const checkingId = shallowRef<string>()
  const checking = shallowRef(false)
  const checkSummary = shallowRef('')
  const checkResults = shallowRef<ReadonlyMap<string, AccountCheckResult>>(new Map())
  let active: CancellationSource | undefined
  let disposed = false

  async function check(accounts: readonly NativeAccount[]) {
    if (checking.value) return
    const source = new CancellationSource()
    active = source
    checking.value = true
    checkSummary.value = ''
    let completed = 0
    let validCount = 0
    let noLoginCount = 0
    let loginCount = 0
    let verificationCount = 0
    let failedCount = 0
    try {
      for (const candidate of accounts) {
        if (!supportsAccount(candidate)) continue
        if (source.signal.isCancelled()) break
        const account = runtime.snapshot.value.accounts.find((item) => item.id === candidate.id)
        if (!account?.enabled) continue
        checkingId.value = account.id
        let release: (() => void) | undefined
        let message: string
        let outcome: AccountCheckResult['status']
        let observedLogin = getAccountState(account).login
        let identityConfirmed = false
        try {
          if (account.platformId.startsWith('external:')) {
            const input = {
              accountId: account.id,
              loginId: crypto.randomUUID(),
              operation: 'check',
              expectedBinding: runtime.sourcePlatforms.value.find(
                (p) => p.id === account.platformId,
              )?.authenticationBinding,
            }
            const unsubscribe = source.signal.subscribe(() => {
              void invoke('source_account_auth', {
                input: { ...input, operation: 'cancel' },
              }).catch(() => {})
            })
            let result: { status: string }
            try {
              // oxlint-disable-next-line no-await-in-loop -- Explicit account checks are serial.
              result = await invoke('source_account_auth', { input })
            } finally {
              unsubscribe()
            }
            outcome =
              result.status === 'not-required'
                ? 'not-required'
                : result.status === 'signed-in'
                  ? 'signed-in'
                  : 'signed-out'
            observedLogin = outcome === 'signed-in' ? 'signed-in' : 'signed-out'
            identityConfirmed = outcome === 'signed-in'
            message = result.status === 'not-required' ? '无需登录，可直接获取数据' : '登录有效'
          } else if (account.authentication === 'anonymous' && account.platformId !== 'douyin') {
            message = '未登录，请先登录'
            outcome = 'signed-out'
            observedLogin = 'signed-out'
          } else {
            // Paused accounts must still be checked: do not route through the ready-only pool.
            // eslint-disable-next-line no-await-in-loop
            release = await runtime.lease(account.id, '检查登录')
            if (source.signal.isCancelled()) break
            // eslint-disable-next-line no-await-in-loop
            const plugin = await runtime.createPlugin(account, source.signal)
            if (source.signal.isCancelled()) break
            // eslint-disable-next-line no-await-in-loop
            const session = await plugin.getSession()
            if (source.signal.isCancelled()) break
            if (session.status === 'unavailable' || session.status === 'expired')
              throw new AppError(session.error.code, session.error.message)
            const names = new Map(runtime.sessionUserNames.value)
            if (session.status === 'signed-in') names.set(account.id, session.user.name)
            else names.delete(account.id)
            runtime.sessionUserNames.value = names
            message = session.status === 'signed-in' ? '登录有效' : '未登录，可重新登录'
            outcome = session.status === 'signed-in' ? 'signed-in' : 'signed-out'
            observedLogin = outcome
            identityConfirmed = session.status === 'signed-in'
          }
        } catch (cause) {
          if (source.signal.isCancelled()) break
          const failure =
            typeof cause === 'string' && cause.startsWith('not-authenticated:')
              ? new AppError('not-authenticated', cause.slice('not-authenticated:'.length))
              : cause
          const error = toAppErrorState(failure, 'upstream-error', '检测失败，请重试。')
          outcome =
            error.code === 'not-authenticated'
              ? 'signed-out'
              : error.code === 'verification-required'
                ? 'verification-required'
                : 'unavailable'
          message =
            error.code === 'not-authenticated'
              ? '登录已失效，可重新登录'
              : error.code === 'verification-required'
                ? '需要验证，请完成验证'
                : `检测未完成：${error.message}`
          if (error.code === 'not-authenticated') observedLogin = 'signed-out'
        } finally {
          release?.()
        }
        if (source.signal.isCancelled()) break
        // Native transport owns persisted state; never infer expiry from network failures here.
        // eslint-disable-next-line no-await-in-loop
        await runtime.refresh()
        if (source.signal.isCancelled()) break
        const state = getAccountState(
          runtime.snapshot.value.accounts.find((item) => item.id === account.id) ?? account,
        )
        if (outcome === 'signed-in' && state.verification === 'required') {
          message = '登录有效，但仍需完成安全验证'
          outcome = 'verification-required'
        }
        checkResults.value = new Map(checkResults.value).set(account.id, {
          status: outcome,
          message,
          checkedAtMs: Date.now(),
          state: {
            ...state,
            login: observedLogin,
            verification: outcome === 'verification-required' ? 'required' : state.verification,
          },
        })
        completed++
        if (identityConfirmed) validCount++
        if (outcome === 'not-required') noLoginCount++
        if (outcome === 'signed-out') loginCount++
        if (outcome === 'verification-required') verificationCount++
        if (outcome === 'unavailable') failedCount++
      }
      if (!disposed)
        checkSummary.value = source.signal.isCancelled()
          ? `检测已取消，已完成 ${completed} 个账号`
          : `已检测 ${completed} 个账号 · ${validCount} 个登录有效${noLoginCount ? ` · ${noLoginCount} 个无需登录` : ''}${loginCount ? ` · ${loginCount} 个未登录` : ''}${verificationCount ? ` · ${verificationCount} 个需要验证` : ''}${failedCount ? ` · ${failedCount} 个检测失败` : ''}${accounts.some((account) => !account.enabled) ? '，已跳过停用账号' : ''}`
    } catch (cause) {
      if (!disposed && !source.signal.isCancelled())
        checkSummary.value = toAppErrorState(cause, 'upstream-error', '无法刷新账号状态。').message
    } finally {
      if (active === source) active = undefined
      if (!disposed) {
        checking.value = false
        checkingId.value = undefined
      }
    }
  }

  function cancelChecks() {
    active?.cancel()
  }
  onScopeDispose(() => {
    disposed = true
    cancelChecks()
  })
  return {
    checking,
    checkingId,
    checkSummary,
    checkResults,
    cancelChecks,
    checkAccount: (account: NativeAccount) => check([account]),
    checkAll: () => check([...runtime.snapshot.value.accounts]),
  }
}
