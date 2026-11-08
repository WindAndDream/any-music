import { describe, expect, it } from 'vitest'

import { accountStatus, canLogin, isSignedIn } from '@/features/accounts/account-presentation'
import type { NativeAccount } from '@/features/accounts/account-runtime'

const account: NativeAccount = {
  backupProxyIds: [],

  id: 'a',
  platformId: 'douyin',
  name: 'a',
  authentication: 'credential',
  enabled: true,
  status: 'verification-required',
  userAgent: '',
  webId: '',
  proxyId: null,
  state: { login: 'signed-in', verification: 'required', connection: 'available' },
}
describe('independent account presentation', () => {
  it('displays a signed-in account and its security requirement together', () => {
    expect(accountStatus(account)).toBe('已登录 · 需要验证')
    expect(isSignedIn(account)).toBe(true)
    expect(canLogin(account)).toBe(true)
  })
  it('keeps a connection failure independent from a known valid login', () => {
    const blocked = {
      ...account,
      status: 'network-blocked',
      state: {
        login: 'signed-in' as const,
        verification: 'not-required' as const,
        connection: 'unavailable' as const,
      },
    }
    expect(accountStatus(blocked)).toBe('已登录 · 连接不可用')
    expect(isSignedIn(blocked)).toBe(true)
    expect(canLogin(blocked)).toBe(false)
  })
  it('does not invent login or logout for a challenged account with unknown login', () => {
    expect(
      accountStatus({
        ...account,
        state: { login: 'unknown', verification: 'required', connection: 'unknown' },
      }),
    ).toBe('登录待确认 · 需要验证')
    expect(
      isSignedIn({
        ...account,
        state: { login: 'unknown', verification: 'required', connection: 'unknown' },
      }),
    ).toBe(false)
  })
})
