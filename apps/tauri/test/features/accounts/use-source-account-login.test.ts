import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { useAccountLogin } from '@/features/accounts/use-account-login'

const native = vi.hoisted(() => ({ invoke: vi.fn(), encode: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('qrcode', () => ({ toDataURL: native.encode }))
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.useRealTimers()
  vi.clearAllMocks()
})
function setup(optional = false) {
  vi.useFakeTimers()
  const account: NativeAccount = {
    id: 'draft',
    platformId: 'external:installed',
    name: 'Custom API',
    status: 'signed-out',
    state: { login: 'signed-out', verification: 'not-required', connection: 'unknown' },
    enabled: true,
    authentication: 'credential',
    pending: true,
    proxyId: null,
    backupProxyIds: [],
    userAgent: '',
    webId: '',
  }
  const runtime = new AccountRuntime()
  runtime.sourcePlatforms.value = [
    {
      id: account.platformId,
      authenticationBinding: 'displayed-configuration',
      name: 'Custom API',
      authentication: {
        protocolVersion: 1,
        apiBaseUrl: 'https://api.example.com/music/',
        allowUnauthenticated: optional,
        methods: ['qr', 'credentials', 'phone'],
        credentialFields: [{ id: 'token', label: { en: 'Token', 'zh-CN': 'Token' }, secret: true }],
      },
    },
  ]
  vi.spyOn(runtime, 'refresh').mockResolvedValue()
  native.encode.mockResolvedValue('data:image/png;base64,qr')
  native.invoke.mockImplementation(async (command, args) => {
    if (command === 'login_capabilities')
      return { qrPresentation: 'display', verification: 'system-browser', isolatedAccounts: true }
    if (command === 'source_account_auth') {
      switch (args.input.operation) {
        case 'qr-start':
          return { status: 'waiting', qrContent: 'custom-qr' }
        case 'qr-poll':
          return { status: 'waiting' }
        case 'phone-send':
          return { status: 'code-sent', retryAfter: 60 }
        case 'cancel':
          return { status: 'cancelled' }
        default:
          runtime.snapshot.value = {
            accounts: [
              { ...account, pending: false, state: { ...account.state, login: 'signed-in' } },
            ],
            proxies: [],
          }
          return { status: 'signed-in' }
      }
    }
  })
  const scope = effectScope()
  scopes.push(scope)
  const busy = shallowRef(false),
    error = shallowRef('')
  const login = scope.run(() => useAccountLogin(runtime, { busy, error }))!
  login.selectLogin(account)
  return { login, runtime, error, scope }
}
const operations = () =>
  native.invoke.mock.calls
    .filter(([name]) => name === 'source_account_auth')
    .map(([, args]) => args.input.operation)

describe('host-owned external source login', () => {
  it('never offers or opens a system browser for an external source', async () => {
    const { login } = setup()
    expect(login.capabilities.value.verification).toBe('unavailable')
    expect(login.authentication.value.methods).toEqual(['qr', 'credentials', 'phone'])
    await login.beginBrowser()
    expect(native.invoke).not.toHaveBeenCalledWith('begin_browser_login', expect.anything())
    await login.useWithoutLogin()
    expect(operations()).toEqual([])
  })
  it('requests QR once, polls serially and stops all work when the draft closes', async () => {
    const { login } = setup()
    await login.beginQr()
    expect(operations()).toEqual(['qr-start'])
    expect(native.encode).toHaveBeenCalledWith('custom-qr', expect.anything())
    await vi.advanceTimersByTimeAsync(2000)
    expect(operations()).toEqual(['qr-start', 'qr-poll'])
    login.endLogin()
    await vi.advanceTimersByTimeAsync(10000)
    expect(operations()).toEqual(['qr-start', 'qr-poll', 'cancel'])
    expect(native.invoke).toHaveBeenCalledWith('discard_account_draft', { accountId: 'draft' })
  })
  it('submits declared credentials without storing the token in public account state', async () => {
    const { login, runtime } = setup()
    login.chooseSourceMethod('credentials')
    await login.submitCredentials({ token: 'synthetic-secret' })
    expect(operations()).toEqual(['credentials'])
    expect(login.loginPhase.value).toBe('complete')
    expect(JSON.stringify(runtime.snapshot.value)).not.toContain('synthetic-secret')
    expect(native.invoke).not.toHaveBeenCalledWith('begin_qr_login', expect.anything())
  })
  it('retains one phone challenge, guards resends and submits the code in the same login', async () => {
    const { login } = setup()
    login.chooseSourceMethod('phone')
    await login.sendPhoneCode('+8613800000000')
    await login.sendPhoneCode('+8613800000000')
    expect(operations()).toEqual(['phone-send'])
    expect(login.phoneCodeSent.value).toBe(true)
    expect(login.retryAfter.value).toBe(60)
    await login.submitPhoneCode('123456')
    const calls = native.invoke.mock.calls.filter(([name]) => name === 'source_account_auth')
    expect(calls[0]![1].input.loginId).toBe(calls[1]![1].input.loginId)
    expect(operations()).toEqual(['phone-send', 'phone-verify'])
    expect(login.loginPhase.value).toBe('complete')
  })
  it('makes the no-login choice explicit only when the source permits it', async () => {
    const { login } = setup(true)
    await login.useWithoutLogin()
    expect(operations()).toEqual(['without-login'])
  })
})
