import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, shallowRef } from 'vue'

import type { LoginVerification, QrLoginResult } from '@/features/accounts/account-login'
import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { useAccountLogin } from '@/features/accounts/use-account-login'

const native = vi.hoisted(() => ({ invoke: vi.fn(), encode: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('qrcode', () => ({ toDataURL: native.encode }))
const account: NativeAccount = {
  backupProxyIds: [],
  state: {
    login: 'signed-out' as 'signed-in' | 'signed-out',
    verification: 'not-required' as const,
    connection: 'available' as const,
  },

  id: 'account-a',
  platformId: 'douyin',
  name: '测试账号',
  enabled: true,
  status: 'ready',
  authentication: 'anonymous',
  proxyId: null,
  userAgent: 'agent',
  webId: '1',
}
const challenge: LoginVerification = {
  methods: [
    { id: 'mobile_sms_verify', label: '接收短信验证码', inApp: true },
    { id: 'face_verify', label: '手机刷脸验证', inApp: false },
  ],
  selectedMethod: '',
  maskedMobile: '',
  retryAfter: 0,
  codeLength: 6,
}
const scopes: ReturnType<typeof effectScope>[] = []
function setup(selectedAccount = account) {
  const scope = effectScope()
  scopes.push(scope)
  const runtime = new AccountRuntime()
  const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue()
  const busy = shallowRef(false)
  const error = shallowRef('')
  const login = scope.run(() => useAccountLogin(runtime, { busy, error }))!
  login.selectLogin(selectedAccount)
  return { ...login, runtime, refresh, busy, error, scope }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function calls(command: string) {
  return native.invoke.mock.calls.filter(([name]) => name === command)
}
beforeEach(() => {
  vi.useFakeTimers()
  native.invoke.mockReset()
  native.encode.mockReset().mockResolvedValue('encoded-bilibili-qr')
  native.invoke.mockImplementation(async (command: string) => {
    if (command === 'login_capabilities')
      return { qrPresentation: 'display', verification: 'system-browser', isolatedAccounts: true }
    if (command === 'begin_qr_login')
      return { status: 'waiting', qrImage: 'data:image/png;base64,synthetic' }
    if (command === 'poll_qr_login') return { status: 'waiting' }
    return undefined
  })
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  vi.useRealTimers()
})

describe('account login lifecycle', () => {
  it('offers only QR login for NetEase and does not start a system browser', async () => {
    const login = setup({ ...account, platformId: 'netease' })
    expect(login.authentication.value.methods).toEqual(['qr'])
    await login.beginBrowser()
    expect(calls('begin_browser_login')).toHaveLength(0)
  })
  function setupHandoff() {
    native.invoke.mockImplementation(async (name: string) => {
      if (name === 'login_capabilities')
        return { qrPresentation: 'handoff', verification: 'unavailable', isolatedAccounts: true }
      if (name === 'begin_qr_login')
        return {
          status: 'waiting',
          qrContent: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=public',
        }
      if (name === 'poll_qr_login') return { status: 'waiting' }
    })
    return setup({ ...account, platformId: 'bilibili' })
  }
  it('automatically opens same-device authorization and reopens the same native session', async () => {
    const login = setupHandoff()
    await login.beginQr()
    expect(calls('open_qr_login')).toHaveLength(1)
    expect(calls('open_qr_login')[0]![1]).toEqual(calls('begin_qr_login')[0]![1])
    expect(native.encode).not.toHaveBeenCalled()
    expect(login.qrImage.value).toBe('')
    await login.reopenQrApp()
    expect(calls('open_qr_login')).toHaveLength(2)
    expect(calls('begin_qr_login')).toHaveLength(1)
    expect(calls('cancel_qr_login')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls('poll_qr_login')).toHaveLength(1)
  })
  it.each([
    '哔哩哔哩授权地址无效，请重新生成二维码。',
    '无法打开哔哩哔哩应用，请确认已安装后重试。',
    '哔哩哔哩应用唤起失败，请重试并检查系统是否允许应用间跳转。',
  ])('preserves the native failure and permits retry with the same QR: %s', async (failure) => {
    const login = setupHandoff()
    const previous = native.invoke.getMockImplementation()!
    native.invoke.mockImplementation((name: string, input: unknown) =>
      name === 'open_qr_login' ? Promise.reject(failure) : previous(name, input),
    )
    await login.beginQr()
    expect(login.qrUnavailable.value).toBe(false)
    expect(login.loginPhase.value).toBe('waiting')
    expect(login.error.value).toBe(failure)
    expect(login.loginStatus.value).not.toContain('请确认已安装')
    native.invoke.mockImplementation(previous)
    await login.reopenQrApp()
    expect(calls('open_qr_login')).toHaveLength(2)
    expect(calls('begin_qr_login')).toHaveLength(1)
    expect(login.error.value).toBe('')
  })
  it('cancels a generation when returning to method selection and never opens its late QR', async () => {
    const login = setupHandoff()
    const pending = deferred<QrLoginResult>()
    const previous = native.invoke.getMockImplementation()!
    native.invoke.mockImplementation((name: string, input: unknown) =>
      name === 'begin_qr_login' ? pending.promise : previous(name, input),
    )
    const starting = login.beginQr()
    await vi.waitFor(() => expect(calls('begin_qr_login')).toHaveLength(1))
    login.chooseMethod()
    pending.resolve({ status: 'waiting', qrContent: 'public-url' })
    await starting
    expect(login.loginPhase.value).toBe('choose')
    expect(login.busy.value).toBe(false)
    expect(login.qrContent.value).toBe('')
    expect(calls('open_qr_login')).toHaveLength(0)
    expect(calls('cancel_qr_login').length).toBeGreaterThan(0)
  })
  it('clears the mobile app-open action after expiry and uses a new session on retry', async () => {
    const login = setupHandoff()
    await login.beginQr()
    const previous = native.invoke.getMockImplementation()!
    native.invoke.mockImplementation((name: string, input: unknown) =>
      name === 'poll_qr_login' ? Promise.resolve({ status: 'expired' }) : previous(name, input),
    )
    await vi.advanceTimersByTimeAsync(2000)
    await login.reopenQrApp()
    expect(calls('open_qr_login')).toHaveLength(1)
    expect(login.qrContent.value).toBe('')
    await login.beginQr()
    expect(calls('open_qr_login')).toHaveLength(2)
    expect(calls('begin_qr_login')[0]![1]).not.toEqual(calls('begin_qr_login')[1]![1])
  })
  it('keeps polling a recoverable official challenge until the existing login is confirmed', async () => {
    const login = setup()
    native.invoke.mockImplementation(async (name: string) =>
      name === 'begin_qr_login'
        ? { status: 'blocked', keepPolling: true, message: '请完成官方验证' }
        : name === 'poll_qr_login'
          ? { status: 'signed-in' }
          : undefined,
    )
    await login.beginQr()
    expect(login.loginPhase.value).toBe('blocked')
    expect(login.qrUnavailable.value).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(login.loginPhase.value).toBe('complete')
    expect(login.loginStatus.value).toContain('登录成功')
  })
  it('cleans a failed polling operation without calling it QR expiry and permits retry', async () => {
    const login = setup()
    await login.beginQr()
    native.invoke.mockImplementation(async (name: string) => {
      if (name === 'poll_qr_login') throw 'network-error:连接中断'
      if (name === 'begin_qr_login') return { status: 'waiting', qrImage: 'retry-image' }
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(login.loginPhase.value).toBe('blocked')
    expect(login.loginStatus.value).toContain('轮询已停止')
    expect(calls('cancel_qr_login')).toHaveLength(1)
    expect(login.verification.value).toBeUndefined()
    expect(login.qrUnavailable.value).toBe(false)
    await login.beginQr()
    expect(login.loginPhase.value).toBe('waiting')
  })
  it('blocks both login methods for a saved login, including a stale renderer account', async () => {
    const login = setup()
    const signedIn: NativeAccount = {
      ...account,
      authentication: 'credential',
      state: { ...account.state, login: 'signed-in' },
    }
    login.runtime.snapshot.value = { accounts: [signedIn], proxies: [] }
    login.selectLogin(signedIn)
    expect(login.loginPhase.value).toBe('complete')
    await login.beginQr()
    await login.beginBrowser()
    expect(calls('begin_qr_login')).toHaveLength(0)
    expect(calls('begin_browser_login')).toHaveLength(0)
    login.selectLogin({ ...signedIn, status: 'expired' })
    await login.beginQr()
    await login.beginBrowser()
    expect(calls('begin_qr_login')).toHaveLength(0)
    expect(calls('begin_browser_login')).toHaveLength(0)
  })
  it('unlocks login when a fresh native snapshot confirms expiry', async () => {
    const login = setup()
    const saved: NativeAccount = {
      ...account,
      authentication: 'credential',
      state: { ...account.state, login: 'signed-in' },
    }
    login.runtime.snapshot.value = { accounts: [saved], proxies: [] }
    login.selectLogin(saved)
    login.runtime.snapshot.value = {
      accounts: [{ ...saved, status: 'expired', state: { ...saved.state, login: 'signed-out' } }],
      proxies: [],
    }
    await nextTick()
    expect(login.loginPhase.value).toBe('choose')
    await login.beginQr()
    expect(calls('begin_qr_login')).toHaveLength(1)
  })
  it('does not start another login after success before the snapshot catches up', async () => {
    const login = setup()
    await login.beginBrowser()
    await login.completeBrowser()
    await login.beginQr()
    await login.beginBrowser()
    expect(calls('begin_browser_login')).toHaveLength(1)
    expect(calls('begin_qr_login')).toHaveLength(0)
  })
  it('does not launch a browser after closing while device capabilities are still loading', async () => {
    const capability = deferred<{
      qrPresentation: 'display'
      verification: 'system-browser'
      isolatedAccounts: boolean
    }>()
    native.invoke.mockImplementation((command: string) =>
      command === 'login_capabilities' ? capability.promise : Promise.resolve(),
    )
    const login = setup()
    const starting = login.beginBrowser()
    await vi.advanceTimersByTimeAsync(0)
    login.endLogin()
    capability.resolve({
      qrPresentation: 'display',
      verification: 'system-browser',
      isolatedAccounts: true,
    })
    await starting
    expect(calls('begin_browser_login')).toHaveLength(0)
  })
  it('waits for a previous browser to close before reopening the same account', async () => {
    const login = setup()
    await login.beginBrowser()
    const cancellation = deferred<void>()
    native.invoke.mockImplementation((command: string) =>
      command === 'cancel_browser_login' ? cancellation.promise : Promise.resolve(),
    )
    login.selectLogin(account)
    const replacement = login.beginBrowser()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls('begin_browser_login')).toHaveLength(1)
    cancellation.resolve()
    await replacement
    expect(calls('begin_browser_login')).toHaveLength(2)
    expect(login.loginPhase.value).toBe('browser')
  })
  it('keeps observing CDP MFA and renders QR refreshes until native credentials are committed', async () => {
    const login = setup()
    await login.beginQr()
    native.invoke.mockImplementation(async (name: string) =>
      name === 'poll_qr_login'
        ? { status: 'waiting', qrImage: 'refreshed-image', keepPolling: true }
        : undefined,
    )
    await vi.advanceTimersByTimeAsync(2000)
    expect(login.qrImage.value).toBe('refreshed-image')
    native.invoke.mockImplementation(async (name: string) =>
      name === 'poll_qr_login'
        ? { status: 'verification-required', verification: challenge, keepPolling: true }
        : undefined,
    )
    await vi.advanceTimersByTimeAsync(4000)
    expect(calls('poll_qr_login')).toHaveLength(3)
    expect(login.verification.value).toEqual(challenge)
    native.invoke.mockImplementation(async (name: string) =>
      name === 'poll_qr_login' ? { status: 'signed-in' } : undefined,
    )
    await vi.advanceTimersByTimeAsync(4000)
    expect(calls('poll_qr_login')).toHaveLength(4)
    expect(login.verification.value).toBeUndefined()
    expect(login.loginStatus.value).toContain('登录成功')
  })
  it('renders native PNG once, encodes Bilibili text once and stops on expiry', async () => {
    const login = setup()
    await login.beginQr()
    expect(login.qrImage.value).toBe('data:image/png;base64,synthetic')
    expect(native.encode).not.toHaveBeenCalled()
    native.invoke.mockImplementation(async (name: string) =>
      name === 'poll_qr_login' ? { status: 'expired' } : undefined,
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls('poll_qr_login')).toHaveLength(1)
    expect(login.qrImage.value).toBe('')
    login.selectLogin({ ...account, platformId: 'bilibili' })
    native.invoke.mockImplementation(async (name: string) =>
      name === 'begin_qr_login'
        ? { status: 'waiting', qrContent: 'https://bilibili.com/synthetic' }
        : undefined,
    )
    await login.beginQr()
    expect(native.encode).toHaveBeenCalledOnce()
    expect(login.qrImage.value).toBe('encoded-bilibili-qr')
  })
  it('pauses for MFA, limits sends, resumes only after validation and waits for credential commit', async () => {
    const login = setup()
    let phase = 'challenge'
    native.invoke.mockImplementation(async (name: string) => {
      if (name === 'begin_qr_login') return { status: 'waiting', qrImage: 'native-image' }
      if (name === 'poll_qr_login')
        return phase === 'challenge'
          ? { status: 'verification-required', verification: challenge }
          : { status: 'signed-in' }
      if (name === 'send_login_sms')
        return {
          status: 'verification-required',
          verification: {
            ...challenge,
            selectedMethod: 'mobile_sms_verify',
            maskedMobile: '138****5678',
            retryAfter: 60,
          },
        }
      if (name === 'submit_login_sms') {
        phase = 'confirmed'
        return { status: 'scanned' }
      }
      return undefined
    })
    await login.beginQr()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(calls('poll_qr_login')).toHaveLength(1)
    expect(login.verification.value?.methods).toEqual(challenge.methods)
    await login.selectVerification('mobile_sms_verify')
    await login.resendSms()
    expect(calls('send_login_sms')).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(login.retryAfter.value).toBe(0)
    expect(calls('poll_qr_login')).toHaveLength(1)
    await login.resendSms()
    expect(calls('send_login_sms')).toHaveLength(2)
    await login.submitSms('123456')
    expect(calls('submit_login_sms')[0]?.[1]).toMatchObject({
      accountId: account.id,
      code: '123456',
    })
    expect(login.loginStatus.value).not.toContain('登录成功')
    await vi.advanceTimersByTimeAsync(2000)
    expect(login.loginStatus.value).toContain('登录成功')
    expect(login.verification.value).toBeUndefined()
    expect(login.refresh).toHaveBeenCalled()
  })
  it('ignores a late QR result and only cancels its own pending UUID', async () => {
    const login = setup()
    const old = deferred<QrLoginResult>()
    native.invoke.mockImplementation((name: string) =>
      name === 'begin_qr_login' ? old.promise : Promise.resolve(),
    )
    const generating = login.beginQr()
    await vi.advanceTimersByTimeAsync(0)
    login.selectLogin({ ...account, id: 'account-b' })
    old.resolve({ status: 'waiting', qrImage: 'old-image' })
    await generating
    expect(login.qrImage.value).toBe('')
    expect(login.loginAccount.value?.id).toBe('account-b')
    const begin = calls('begin_qr_login')[0]?.[1]
    expect(begin).toHaveProperty('loginId')
    expect(
      calls('cancel_qr_login').every(
        ([, args]) => args.accountId === 'account-a' && args.loginId === begin.loginId,
      ),
    ).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls('poll_qr_login')).toHaveLength(0)
  })
  it('latches QR failures, cleans failed display sessions and allows only the system browser handoff', async () => {
    const login = setup()
    await login.beginQr()
    login.disableQr()
    await login.beginQr()
    expect(login.qrUnavailable.value).toBe(true)
    expect(login.qrImage.value).toBe('')
    expect(calls('begin_qr_login')).toHaveLength(1)
    expect(calls('cancel_qr_login')).toHaveLength(1)
    await login.beginBrowser()
    expect(calls('begin_browser_login')[0]?.[1]).toMatchObject({
      accountId: account.id,
      browser: 'system',
      loginId: expect.any(String),
    })
    await login.completeBrowser()
    expect(login.loginPhase.value).toBe('complete')
    expect(calls('complete_browser_login')).toHaveLength(1)
  })
  it('blocks repeated generation after missing QR and closes an external MFA browser on leaving', async () => {
    const login = setup()
    native.invoke.mockImplementation(async (command: string) =>
      command === 'begin_qr_login' ? { status: 'waiting' } : undefined,
    )
    await login.beginQr()
    await login.beginQr()
    expect(login.qrUnavailable.value).toBe(true)
    expect(calls('begin_qr_login')).toHaveLength(1)
    login.selectLogin({ ...account, id: 'b' })
    native.invoke.mockImplementation(async (command: string) =>
      command === 'begin_qr_login'
        ? { status: 'verification-required', verification: challenge }
        : undefined,
    )
    await login.beginQr()
    await login.selectVerification('face_verify')
    expect(login.loginPhase.value).toBe('browser')
    expect(calls('begin_browser_login')[0]?.[1]).toMatchObject({
      accountId: 'b',
      browser: 'system',
      loginId: expect.any(String),
    })
    login.endLogin()
    expect(calls('cancel_browser_login')[0]?.[1]).toMatchObject({
      accountId: 'b',
      loginId: calls('begin_browser_login')[0]?.[1].loginId,
    })
  })
  it('a late browser launch only cancels its own UUID and cannot clear a replacement session', async () => {
    const login = setup()
    const old = deferred<void>()
    native.invoke.mockImplementation((command: string) =>
      command === 'begin_browser_login' ? old.promise : Promise.resolve(),
    )
    const starting = login.beginBrowser()
    await vi.advanceTimersByTimeAsync(0)
    const first = calls('begin_browser_login')[0]?.[1]
    login.endLogin()
    login.selectLogin(account)
    native.invoke.mockImplementation(async () => undefined)
    await login.beginBrowser()
    const second = calls('begin_browser_login')[1]?.[1]
    expect(first.loginId).not.toBe(second.loginId)
    old.resolve()
    await starting
    expect(login.loginPhase.value).toBe('browser')
    expect(login.busy.value).toBe(false)
    expect(
      calls('cancel_browser_login').every(([, pending]) => pending.loginId === first.loginId),
    ).toBe(true)
  })
  it('ignores late poll errors after switching accounts and disposes pending timers', async () => {
    const login = setup()
    await login.beginQr()
    const old = deferred<QrLoginResult>()
    native.invoke.mockImplementation((name: string) =>
      name === 'poll_qr_login' ? old.promise : Promise.resolve(),
    )
    await vi.advanceTimersByTimeAsync(2000)
    login.selectLogin({ ...account, id: 'account-b' })
    old.reject('old-error')
    await vi.advanceTimersByTimeAsync(0)
    expect(login.error.value).toBe('')
    login.scope.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls('poll_qr_login')).toHaveLength(1)
  })
  it('stops on risk rejection and awaits scoped cancellation before browser handoff', async () => {
    const login = setup()
    await login.beginQr()
    native.invoke.mockImplementation(async (name: string) =>
      name === 'poll_qr_login'
        ? { status: 'blocked', message: '4031：请使用系统浏览器' }
        : undefined,
    )
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls('poll_qr_login')).toHaveLength(1)
    expect(login.qrImage.value).toBe('')
    expect(login.loginStatus.value).toContain('4031')
    const cancellation = deferred<void>()
    native.invoke.mockImplementation((name: string) =>
      name === 'cancel_qr_login' ? cancellation.promise : Promise.resolve(),
    )
    const handoff = login.beginBrowser()
    expect(calls('begin_browser_login')).toHaveLength(0)
    cancellation.resolve()
    await handoff
    expect(calls('begin_browser_login')).toHaveLength(1)
  })
})
