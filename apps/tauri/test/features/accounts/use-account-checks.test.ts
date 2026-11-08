import { AppError, toAppErrorState } from '@any-music/core'
import type { CancellationSignal, MusicSourcePlugin, MusicSourceSession } from '@any-music/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { useAccountChecks } from '@/features/accounts/use-account-checks'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.restoreAllMocks()
})
const createAccount = (
  id: string,
  platformId: NativeAccount['platformId'] = 'bilibili',
): NativeAccount => ({
  backupProxyIds: [],
  state: {
    login: 'signed-in' as 'signed-in' | 'signed-out',
    verification: 'not-required' as const,
    connection: 'available' as const,
  },

  id,
  name: id,
  platformId,
  authentication: 'credential',
  status: 'ready',
  enabled: true,
  proxyId: null,
  userAgent: '',
  webId: '',
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function setup(
  getSession: (account: NativeAccount, signal?: CancellationSignal) => Promise<MusicSourceSession>,
) {
  const runtime = new AccountRuntime()
  runtime.snapshot.value = {
    accounts: [
      createAccount('a'),
      createAccount('b', 'douyin'),
      { ...createAccount('disabled'), enabled: false },
    ],
    proxies: [],
  }
  const release = vi.fn()
  const lease = vi.spyOn(runtime, 'lease').mockResolvedValue(release)
  const createPlugin = vi
    .spyOn(runtime, 'createPlugin')
    .mockImplementation(
      async (account, signal) =>
        ({ getSession: () => getSession(account, signal) }) as MusicSourcePlugin,
    )
  const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue()
  const scope = effectScope()
  scopes.push(scope)
  const checks = scope.run(() => useAccountChecks(runtime))!
  return { runtime, release, lease, createPlugin, refresh, scope, ...checks }
}
describe('explicit account detection', () => {
  it('counts verification separately from logout and incomplete detection, keeping known identity on a challenge', async () => {
    const checks = setup(async (account) => ({
      status: 'unavailable',
      error: toAppErrorState(
        new AppError(account.id === 'a' ? 'not-authenticated' : 'verification-required'),
      ),
    }))
    checks.runtime.sessionUserNames.value = new Map([['b', '已登录用户']])
    await checks.checkAll()
    expect(checks.checkResults.value.get('a')?.status).toBe('signed-out')
    expect(checks.checkResults.value.get('b')?.status).toBe('verification-required')
    expect(checks.checkSummary.value).toContain('1 个未登录 · 1 个需要验证')
    expect(checks.runtime.sessionUserNames.value.get('b')).toBe('已登录用户')
  })
  it('keeps a separate content verification requirement visible after a valid identity check', async () => {
    const checks = setup(async () => ({ status: 'signed-in', user: { id: 'user', name: '甲' } }))
    const pendingVerification: NativeAccount = {
      ...createAccount('a'),
      status: 'verification-required',
      state: { login: 'signed-in', verification: 'required', connection: 'available' },
    }
    checks.runtime.snapshot.value = { accounts: [pendingVerification], proxies: [] }
    await checks.checkAccount(pendingVerification)
    expect(checks.checkResults.value.get('a')?.message).toBe('登录有效，但仍需完成安全验证')
    expect(checks.checkResults.value.get('a')?.state).toMatchObject({
      login: 'signed-in',
      verification: 'required',
    })
    expect(checks.checkSummary.value).toContain('1 个登录有效')
    expect(checks.checkSummary.value).toContain('1 个需要验证')
  })
  it('reports an anonymous account without starting a native login or browser', async () => {
    const getSession = vi.fn()
    const checks = setup(getSession)
    const guest = { ...createAccount('a'), authentication: 'anonymous' as const }
    checks.runtime.snapshot.value = { accounts: [guest], proxies: [] }
    await checks.checkAccount(guest)
    expect(checks.checkResults.value.get('a')?.message).toBe('未登录，请先登录')
    expect(checks.createPlugin).not.toHaveBeenCalled()
    expect(checks.lease).not.toHaveBeenCalled()
  })
  it('checks every enabled identity serially, updates usernames and prevents duplicate batches', async () => {
    const first = deferred<MusicSourceSession>()
    const getSession = vi.fn((account: NativeAccount) =>
      account.id === 'a'
        ? first.promise
        : Promise.resolve({ status: 'signed-in' as const, user: { id: 'user-b', name: '乙' } }),
    )
    const checks = setup(getSession)
    const pending = checks.checkAll()
    await vi.waitFor(() => expect(getSession).toHaveBeenCalledTimes(1))
    await checks.checkAll()
    expect(checks.checkingId.value).toBe('a')
    expect(checks.createPlugin).toHaveBeenCalledTimes(1)
    first.resolve({ status: 'signed-in', user: { id: 'user-a', name: '甲' } })
    await pending
    expect(getSession.mock.calls.map(([account]) => account.id)).toEqual(['a', 'b'])
    expect(checks.release).toHaveBeenCalledTimes(2)
    expect(checks.refresh).toHaveBeenCalledTimes(2)
    expect(checks.runtime.sessionUserNames.value).toEqual(
      new Map([
        ['a', '甲'],
        ['b', '乙'],
      ]),
    )
    expect(checks.checkSummary.value).toContain('已检测 2 个账号')
    expect(checks.checkSummary.value).toContain('跳过停用')
    expect(checks.checking.value).toBe(false)
  })
  it('keeps network failures distinct from expiry and continues checking the next account once', async () => {
    const getSession = vi.fn(async (account: NativeAccount) => {
      if (account.id === 'a')
        return {
          status: 'unavailable' as const,
          error: toAppErrorState(new AppError('network-error')),
        }
      return { status: 'signed-out' as const }
    })
    const checks = setup(getSession)
    await checks.checkAll()
    expect(checks.checkResults.value.get('a')?.message).toContain('检测未完成')
    expect(checks.checkResults.value.get('b')?.message).toContain('未登录')
    expect(checks.runtime.snapshot.value.accounts[0]?.status).toBe('ready')
    expect(getSession).toHaveBeenCalledTimes(2)
  })
  it('checks an expired account directly without ready-only routing or switching identity', async () => {
    const checks = setup(async () => ({
      status: 'signed-in',
      user: { id: 'user', name: '已恢复' },
    }))
    checks.runtime.snapshot.value = {
      accounts: [{ ...createAccount('a'), status: 'expired' }],
      proxies: [],
    }
    await checks.checkAccount(checks.runtime.snapshot.value.accounts[0]!)
    expect(checks.createPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', status: 'expired' }),
      expect.anything(),
    )
    expect(checks.checkResults.value.get('a')?.message).toBe('登录有效')
    expect(checks.createPlugin).toHaveBeenCalledTimes(1)
  })
  it.each(['cancel', 'dispose'])(
    'cancels native reads and ignores late results on %s',
    async (action) => {
      const pending = deferred<MusicSourceSession>()
      let signal: CancellationSignal | undefined
      const checks = setup(async (_, input) => {
        signal = input
        return pending.promise
      })
      const batch = checks.checkAll()
      await vi.waitFor(() => expect(signal).toBeDefined())
      if (action === 'cancel') checks.cancelChecks()
      else checks.scope.stop()
      expect(signal?.isCancelled()).toBe(true)
      pending.resolve({ status: 'signed-in', user: { id: 'late', name: '过期响应' } })
      await batch
      expect(checks.checkResults.value.size).toBe(0)
      expect(checks.runtime.sessionUserNames.value.size).toBe(0)
      expect(checks.createPlugin).toHaveBeenCalledTimes(1)
      expect(checks.release).toHaveBeenCalledOnce()
    },
  )
})
