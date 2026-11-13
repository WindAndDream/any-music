import type { AccountLoginCapabilities } from '@any-music/core'
import { invoke } from '@tauri-apps/api/core'
import { toDataURL } from 'qrcode'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import type { LoginPhase, LoginVerification, QrLoginResult } from './account-login'
import { canLogin } from './account-presentation'
import type { AccountRuntime, NativeAccount } from './account-runtime'
import { getAccountState } from './account-state'
import { BUILT_IN_AUTHENTICATION, isExternalAccount } from './source-authentication'
import type { AccountAuthentication, AccountPlatform } from './source-authentication'

type PendingLogin = {
  accountId: string
  loginId: string
  external?: boolean
  binding?: string
}
async function cancel(pending?: PendingLogin) {
  if (pending)
    await (
      pending.external ? sourceRequest(pending, 'cancel') : invoke('cancel_qr_login', pending)
    ).catch(() => {})
}
function sourceRequest<Result>(
  pending: PendingLogin,
  operation: string,
  extra: Record<string, unknown> = {},
): Promise<Result> {
  return invoke('source_account_auth', {
    input: {
      accountId: pending.accountId,
      loginId: pending.loginId,
      expectedBinding: pending.binding,
      operation,
      ...extra,
    },
  })
}

/** Owns one visible login. Scoped native UUIDs protect replacement sessions from late cancellation. */
export function useAccountLogin(
  runtime: AccountRuntime,
  activity: { busy: ShallowRef<boolean>; error: ShallowRef<string> },
) {
  const { busy, error } = activity
  const nativeCapabilities = shallowRef<AccountLoginCapabilities>({
    qrPresentation: 'unavailable',
    verification: 'unavailable',
    isolatedAccounts: false,
  })
  const loginAccount = shallowRef<NativeAccount>()
  const loginSource = shallowRef<AccountPlatform>()
  const authentication = computed<AccountAuthentication>(() => {
    const account = loginAccount.value
    if (account?.platformId === 'netease') return { ...BUILT_IN_AUTHENTICATION, methods: ['qr'] }
    if (!account || !isExternalAccount(account.platformId)) return BUILT_IN_AUTHENTICATION
    const config =
      loginSource.value?.available === false ? undefined : loginSource.value?.authentication
    return config
      ? { ...config, allowUnauthenticated: !!account.pending && config.allowUnauthenticated }
      : { allowUnauthenticated: false, methods: [], credentialFields: [] }
  })
  const capabilities = computed<AccountLoginCapabilities>(() =>
    loginAccount.value && isExternalAccount(loginAccount.value.platformId)
      ? {
          qrPresentation: authentication.value.methods.includes('qr') ? 'display' : 'unavailable',
          verification: 'unavailable',
          isolatedAccounts: true,
        }
      : nativeCapabilities.value,
  )
  const phoneCodeSent = shallowRef(false)
  const loginStatus = shallowRef('')
  const loginPhase = shallowRef<LoginPhase>('choose')
  const qrUnavailable = shallowRef(false)
  const qrFailures = new Set<string>()
  let browserSession: PendingLogin | undefined
  let closingWork: Promise<void> = Promise.resolve()
  const qrImage = shallowRef('')
  const qrContent = shallowRef('')
  const openingApp = shallowRef(false)
  const verification = shallowRef<LoginVerification>()
  const retryAfter = shallowRef(0)
  let generation = 0
  let active: PendingLogin | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let countdown: ReturnType<typeof setInterval> | undefined
  let disposed = false
  const capabilityReady = invoke<AccountLoginCapabilities>('login_capabilities')
    .then((value) => {
      if (!disposed) nativeCapabilities.value = value
    })
    .catch(() => {})

  function stopPolling() {
    if (pollTimer !== undefined) clearTimeout(pollTimer)
    pollTimer = undefined
  }
  function clearVerification() {
    if (countdown !== undefined) clearInterval(countdown)
    countdown = undefined
    verification.value = undefined
    retryAfter.value = 0
  }
  function setVerification(value: LoginVerification) {
    clearVerification()
    verification.value = value
    const deadline = Date.now() + value.retryAfter * 1000
    retryAfter.value = value.retryAfter
    if (value.retryAfter > 0)
      countdown = setInterval(() => {
        retryAfter.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
        if (retryAfter.value === 0 && countdown !== undefined) {
          clearInterval(countdown)
          countdown = undefined
        }
      }, 1000)
  }
  function resetQr() {
    generation++
    stopPolling()
    clearVerification()
    qrImage.value = ''
    qrContent.value = ''
    openingApp.value = false
    const old = active
    active = undefined
    return old
  }
  function endLogin(discardDraft = true) {
    const draft = discardDraft && loginAccount.value?.pending ? loginAccount.value.id : undefined
    const hadLogin = loginAccount.value !== undefined
    const old = resetQr()
    loginAccount.value = undefined
    loginStatus.value = ''
    loginPhase.value = 'choose'
    phoneCodeSent.value = false
    // Path navigation must not release the busy guard of an unrelated pending settings save.
    if (hadLogin) {
      busy.value = false
      error.value = ''
    }
    const previousBrowser = browserSession
    browserSession = undefined
    // Reopening waits for native Profile teardown rather than racing the old visible browser.
    if (hadLogin || old || previousBrowser)
      closingWork = Promise.all([
        closingWork,
        previousBrowser ? invoke('cancel_browser_login', previousBrowser) : Promise.resolve(),
        cancel(old),
      ])
        .then(async () => {
          if (draft) await invoke('discard_account_draft', { accountId: draft })
          if (!disposed) await runtime.refresh()
        })
        .catch(() => {})
  }
  function selectLogin(account: NativeAccount) {
    endLogin(loginAccount.value?.id !== account.id)
    loginAccount.value = account
    loginSource.value = runtime.sourcePlatforms.value.find((p) => p.id === account.platformId)
    qrUnavailable.value = qrFailures.has(account.id)
    loginPhase.value = canLogin(account) ? 'choose' : 'complete'
    loginStatus.value = !account.enabled
      ? '账号已停用，启用后可登录或检测。'
      : canLogin(account)
        ? '请选择登录方式。'
        : getAccountState(account).login === 'signed-in'
          ? '账号已登录，可检测当前登录状态。'
          : '登录状态尚未确认，可先检测账号。'
  }
  function chooseMethod() {
    const account = currentAccount()
    if (account && loginPhase.value !== 'complete' && canLogin(account)) selectLogin(account)
  }
  function currentAccount() {
    return (
      runtime.snapshot.value.accounts.find((account) => account.id === loginAccount.value?.id) ??
      loginAccount.value
    )
  }
  watch(
    () => currentAccount(),
    (account) => {
      if (
        account &&
        loginPhase.value === 'complete' &&
        canLogin(account) &&
        !(
          isExternalAccount(account.platformId) &&
          !account.pending &&
          account.authentication === 'anonymous'
        )
      ) {
        loginPhase.value = 'choose'
        loginStatus.value =
          getAccountState(account).verification === 'required'
            ? '账号需要完成验证，请选择验证方式。'
            : '账号未登录，请选择登录方式。'
      }
    },
  )
  function valid(expected: number) {
    return expected === generation && !disposed
  }
  function schedulePoll(expected: number) {
    stopPolling()
    pollTimer = setTimeout(() => {
      void poll(expected)
    }, 2000)
  }
  async function present(result: QrLoginResult, expected: number) {
    if (!valid(expected)) return
    if (result.qrImage) qrImage.value = result.qrImage
    loginPhase.value =
      result.status === 'signed-in'
        ? 'complete'
        : result.status === 'verification-required'
          ? 'verification'
          : result.status
    loginStatus.value =
      result.message ??
      {
        waiting:
          capabilities.value.qrPresentation === 'handoff'
            ? '请在哔哩哔哩应用中确认授权，完成后返回这里。未打开应用时可再次点击登录。'
            : '等待扫码，请使用平台手机客户端扫码。',
        scanned:
          capabilities.value.qrPresentation === 'handoff'
            ? '已打开授权，请在哔哩哔哩应用中确认后返回。'
            : '已扫码，请在手机上确认。',
        'signed-in': '登录成功，凭证已保存。',
        expired: '二维码已过期，请重新生成。',
        'verification-required': '需要二次验证，请选择验证方式。',
        blocked:
          capabilities.value.qrPresentation === 'handoff'
            ? '平台暂未完成授权，请重新生成二维码后重试。'
            : '平台拒绝登录请求，请使用系统浏览器。',
      }[result.status]
    if (result.status === 'verification-required') {
      stopPolling()
      qrImage.value = ''
      qrContent.value = ''
      if (result.verification) setVerification(result.verification)
      if (result.keepPolling) schedulePoll(expected)
      return
    }
    clearVerification()
    if (
      result.status === 'signed-in' ||
      result.status === 'expired' ||
      result.status === 'blocked'
    ) {
      stopPolling()
      qrImage.value = ''
      qrContent.value = ''
      if (result.status === 'signed-in') {
        active = undefined
        await runtime.refresh()
      }
      if (result.status === 'blocked' && loginAccount.value) {
        if (result.keepPolling) schedulePoll(expected)
        else if (capabilities.value.qrPresentation !== 'handoff') {
          qrFailures.add(loginAccount.value.id)
          qrUnavailable.value = true
        }
      }
      return
    }
    schedulePoll(expected)
  }
  async function beginQr() {
    const account = currentAccount()
    if (
      !account ||
      busy.value ||
      qrUnavailable.value ||
      !canLogin(account) ||
      loginPhase.value === 'complete'
    )
      return
    const old = resetQr()
    const expected = generation
    busy.value = true
    error.value = ''
    loginStatus.value = '正在生成二维码…'
    loginPhase.value = 'generating'
    try {
      await closingWork
      if (!valid(expected)) return
      if (browserSession) {
        const oldBrowser = browserSession
        browserSession = undefined
        await invoke('cancel_browser_login', oldBrowser)
      }
      await capabilityReady
      if (!valid(expected)) return
      if (capabilities.value.qrPresentation === 'unavailable')
        throw new Error('此设备暂不支持二维码登录。')
      await cancel(old)
      if (!valid(expected)) return
      const pending: PendingLogin = {
        accountId: account.id,
        loginId: crypto.randomUUID(),
        ...(isExternalAccount(account.platformId)
          ? { external: true, binding: loginSource.value?.authenticationBinding }
          : {}),
      }
      active = pending
      const result = pending.external
        ? await sourceRequest<QrLoginResult>(pending, 'qr-start')
        : await invoke<QrLoginResult>('begin_qr_login', pending)
      // Douyin supplies PNG data; Bilibili supplies text to encode once.
      const image =
        capabilities.value.qrPresentation === 'handoff'
          ? ''
          : (result.qrImage ??
            (result.qrContent ? await toDataURL(result.qrContent, { width: 240, margin: 2 }) : ''))
      if (!valid(expected)) {
        await cancel(pending)
        return
      }
      if (
        !(image || (capabilities.value.qrPresentation === 'handoff' && result.qrContent)) &&
        ['waiting', 'scanned'].includes(result.status)
      )
        throw new Error('平台未返回二维码图片。')
      qrImage.value = image
      qrContent.value = result.qrContent ?? ''
      await present(result, expected)
      if (valid(expected)) await runtime.refresh()
      if (
        valid(expected) &&
        capabilities.value.qrPresentation === 'handoff' &&
        ['waiting', 'scanned'].includes(loginPhase.value)
      )
        await openQrApp(expected)
    } catch (cause) {
      if (valid(expected)) {
        error.value = String(cause)
        if (
          capabilities.value.qrPresentation !== 'handoff' &&
          !isExternalAccount(account.platformId)
        ) {
          qrFailures.add(account.id)
          qrUnavailable.value = true
        }
        loginPhase.value = 'blocked'
        loginStatus.value =
          capabilities.value.qrPresentation === 'handoff'
            ? '未能生成登录二维码，请检查网络后重试。'
            : authentication.value.methods.length === 1
              ? '二维码暂不可用，请稍后重试。'
              : '二维码暂不可用，请重试或选择其他登录方式。'
        const pending = active
        active = undefined
        await cancel(pending)
      }
    } finally {
      if (valid(expected)) busy.value = false
    }
  }
  async function openQrApp(expected: number) {
    const pending = active
    if (
      !pending ||
      !valid(expected) ||
      openingApp.value ||
      capabilities.value.qrPresentation !== 'handoff' ||
      !['waiting', 'scanned'].includes(loginPhase.value)
    )
      return
    openingApp.value = true
    error.value = ''
    try {
      // Native derives the app link from this exact pending session, never from renderer URLs.
      await invoke('open_qr_login', pending)
    } catch (cause) {
      if (valid(expected)) {
        error.value = String(cause)
        loginStatus.value = '未能打开哔哩哔哩应用，请查看错误提示后重试。'
      }
    } finally {
      if (valid(expected)) openingApp.value = false
    }
  }
  async function poll(expected: number) {
    const pending = active
    if (!pending || !valid(expected)) return
    try {
      await present(
        pending.external
          ? await sourceRequest<QrLoginResult>(pending, 'qr-poll')
          : await invoke<QrLoginResult>('poll_qr_login', pending),
        expected,
      )
    } catch (cause) {
      if (valid(expected)) {
        stopPolling()
        error.value = String(cause)
        loginStatus.value =
          capabilities.value.qrPresentation === 'handoff'
            ? '登录确认已停止，请重新生成二维码后登录。'
            : authentication.value.methods.length === 1
              ? '登录轮询已停止，请重新生成二维码重试。'
              : '登录轮询已停止，可以重新生成二维码或选择其他方式。'
        loginPhase.value = 'blocked'
        qrImage.value = ''
        qrContent.value = ''
        clearVerification()
        active = undefined
        await cancel(pending)
        if (valid(expected)) await runtime.refresh()
      }
    }
  }
  async function smsAction(code?: string) {
    const pending = active
    if (!pending || !verification.value || busy.value) return
    if (code === undefined && retryAfter.value > 0) return
    const expected = generation
    busy.value = true
    error.value = ''
    // Match the native minimum cooldown even if the send is rejected or times out.
    loginStatus.value = code === undefined ? '正在请求短信验证码…' : '正在提交短信验证码…'
    if (code === undefined) setVerification({ ...verification.value, retryAfter: 60 })
    try {
      const result = await invoke<QrLoginResult>(
        code === undefined ? 'send_login_sms' : 'submit_login_sms',
        code === undefined ? pending : { ...pending, code },
      )
      await present(result, expected)
    } catch (cause) {
      if (valid(expected)) {
        error.value = String(cause)
        loginStatus.value =
          code === undefined
            ? '短信发送未完成，请检查提示后重试。'
            : '短信验证未完成，请检查验证码后重试。'
      }
    } finally {
      if (valid(expected)) busy.value = false
    }
  }
  async function selectVerification(id: string) {
    const method = verification.value?.methods.find((option) => option.id === id)
    if (!method || busy.value) return
    if (!method.inApp) {
      await beginBrowser()
      return
    }
    await smsAction()
  }
  async function beginBrowser() {
    const account = currentAccount()
    if (
      !account ||
      isExternalAccount(account.platformId) ||
      !authentication.value.methods.includes('system-browser') ||
      busy.value ||
      !canLogin(account) ||
      ['browser', 'complete'].includes(loginPhase.value)
    )
      return
    const old = resetQr()
    const expected = generation
    busy.value = true
    error.value = ''
    loginPhase.value = 'generating'
    loginStatus.value = '正在打开系统浏览器…'
    const pending = { accountId: account.id, loginId: crypto.randomUUID() }
    try {
      await closingWork
      await cancel(old)
      if (!valid(expected)) return
      await capabilityReady
      if (!valid(expected)) return
      if (capabilities.value.verification !== 'system-browser')
        throw new Error('此设备暂不支持系统浏览器登录。')
      browserSession = pending
      await invoke('begin_browser_login', { ...pending, browser: 'system' })
      if (!valid(expected)) {
        await invoke('cancel_browser_login', pending).catch(() => {})
        return
      }
      loginPhase.value = 'browser'
      loginStatus.value = '请在打开的浏览器中完成登录与验证，然后保持窗口打开并点击“完成验证”。'
      await runtime.refresh()
    } catch (cause) {
      if (valid(expected)) {
        error.value = String(cause)
        loginPhase.value = 'choose'
        loginStatus.value = '系统浏览器未能打开，请处理连接或浏览器问题后重试。'
        browserSession = undefined
        await invoke('cancel_browser_login', pending).catch(() => {})
      }
    } finally {
      if (valid(expected)) busy.value = false
    }
  }
  function chooseSourceMethod(method: 'credentials' | 'phone') {
    const account = currentAccount()
    if (
      !account ||
      busy.value ||
      !isExternalAccount(account.platformId) ||
      !authentication.value.methods.includes(method)
    )
      return
    const old = resetQr()
    closingWork = Promise.all([closingWork, cancel(old)]).then(() => {})
    phoneCodeSent.value = false
    error.value = ''
    loginPhase.value = method
    loginStatus.value =
      method === 'credentials' ? '请输入此来源要求的凭证。' : '输入手机号并获取验证码。'
  }
  async function sourceAction(
    operation: 'credentials' | 'phone-send' | 'phone-verify' | 'without-login',
    extra: Record<string, unknown> = {},
  ) {
    const account = currentAccount()
    if (!account || busy.value || !isExternalAccount(account.platformId)) return
    if (
      (operation === 'phone-send' && retryAfter.value > 0) ||
      (operation === 'without-login' && !authentication.value.allowUnauthenticated)
    )
      return
    const expected = generation
    busy.value = true
    error.value = ''
    try {
      await closingWork
      if (!valid(expected)) return
      if (operation === 'phone-verify' && !active?.external) throw new Error('请先获取短信验证码。')
      const pending = active?.external
        ? active
        : {
            accountId: account.id,
            loginId: crypto.randomUUID(),
            external: true,
            binding: loginSource.value?.authenticationBinding,
          }
      active = pending
      const result = await sourceRequest<
        QrLoginResult | { status: 'code-sent'; retryAfter: number }
      >(pending, operation, extra)
      if (!valid(expected)) {
        await cancel(pending)
        return
      }
      if (result.status === 'code-sent') {
        phoneCodeSent.value = true
        retryAfter.value = result.retryAfter
        const deadline = Date.now() + result.retryAfter * 1000
        if (countdown !== undefined) clearInterval(countdown)
        countdown = setInterval(() => {
          retryAfter.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
        }, 1000)
        loginStatus.value = '验证码已发送，请输入验证码。'
      } else await present(result, expected)
    } catch (cause) {
      if (valid(expected)) error.value = String(cause)
    } finally {
      if (valid(expected)) busy.value = false
    }
  }
  async function completeBrowser() {
    const account = loginAccount.value
    if (!account || !browserSession || busy.value || loginPhase.value !== 'browser') return
    const expected = generation
    busy.value = true
    error.value = ''
    loginStatus.value = '正在确认登录与验证结果…'
    try {
      await invoke('complete_browser_login', browserSession)
      if (!valid(expected)) return
      browserSession = undefined
      loginPhase.value = 'complete'
      loginStatus.value = '登录成功，登录状态已保存。'
      await runtime.refresh()
    } catch (cause) {
      if (valid(expected)) {
        error.value = String(cause)
        loginStatus.value = '验证尚未确认，请在账号浏览器中完成登录或安全验证后重试。'
      }
    } finally {
      if (valid(expected)) busy.value = false
    }
  }
  onScopeDispose(() => {
    disposed = true
    endLogin()
  })
  function disableQr() {
    const account = loginAccount.value
    if (!account) return
    const pending = resetQr()
    qrFailures.add(account.id)
    qrUnavailable.value = true
    loginPhase.value = 'blocked'
    loginStatus.value = '二维码无法显示，请重新选择可用登录方式。'
    busy.value = false
    void cancel(pending)
      .then(() => runtime.refresh())
      .catch(() => {})
  }
  return {
    authentication,
    phoneCodeSent,
    chooseSourceMethod,
    submitCredentials: (fields: Record<string, string>) => sourceAction('credentials', { fields }),
    sendPhoneCode: (phone: string) => sourceAction('phone-send', { phone }),
    submitPhoneCode: (code: string) => sourceAction('phone-verify', { code }),
    useWithoutLogin: () => sourceAction('without-login'),
    capabilities,
    loginAccount,
    loginStatus,
    loginPhase,
    qrUnavailable,
    disableQr,
    qrImage,
    qrContent,
    openingApp,
    reopenQrApp: () => !busy.value && openQrApp(generation),
    verification,
    retryAfter,
    endLogin,
    waitForCleanup: () => closingWork,
    selectLogin,
    chooseMethod,
    beginQr,
    beginBrowser,
    completeBrowser,
    selectVerification,
    resendSms: () => smsAction(),
    submitSms: (code: string) => smsAction(code),
  }
}
