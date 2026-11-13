import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AccountLoginPanel from '@/components/accounts/AccountLoginPanel.vue'
import type { LoginVerification } from '@/features/accounts/account-login'
import type { NativeAccount } from '@/features/accounts/account-runtime'

const account: NativeAccount = {
  backupProxyIds: [],
  state: {
    login: 'signed-out' as 'signed-in' | 'signed-out',
    verification: 'not-required' as const,
    connection: 'available' as const,
  },

  id: 'synthetic',
  platformId: 'douyin',
  name: '测试账号',
  authentication: 'anonymous',
  status: 'ready',
  enabled: true,
  proxyId: null,
  userAgent: '',
  webId: '',
}
const verification: LoginVerification = {
  methods: [
    { id: 'mobile_sms_verify', label: '接收短信验证码', inApp: true },
    { id: 'face_verify', label: '手机刷脸验证', inApp: false },
    { id: 'mobile_up_sms_verify', label: '发送短信验证', inApp: false },
  ],
  selectedMethod: '',
  maskedMobile: '',
  retryAfter: 0,
  codeLength: 6,
}
function render(props: Partial<InstanceType<typeof AccountLoginPanel>['$props']> = {}) {
  return renderToString(
    createSSRApp({
      render: () =>
        h(AccountLoginPanel, {
          account,
          busy: false,
          status: '等待扫码',
          qrImage: '',
          qrContent: '',
          retryAfter: 0,
          capabilities: {
            qrPresentation: 'display',
            verification: 'system-browser',
            isolatedAccounts: true,
          },
          ...props,
        }),
    }),
  )
}
describe('account login presentation', () => {
  it('hides method entries during verification and exposes a real return button', async () => {
    const html = await render({ phase: 'waiting', qrImage: 'data:image/png;base64,synthetic' })
    expect(html).not.toContain('native-settings__entries')
    expect(html).toMatch(
      /<button[^>]*class="login-panel__step"[^>]*>[^<]*<span[^>]*>1<\/span>选择方式/,
    )
    expect(html).toContain('重新生成二维码')
    expect(html).toContain('data-dialog-page="qr"')
  })
  it('shows only the mobile QR method and retains an app login action alongside regeneration', async () => {
    const capabilities = {
      qrPresentation: 'handoff',
      verification: 'unavailable',
      isolatedAccounts: true,
    } as const
    const choose = await render({ capabilities })
    expect(choose).toContain('哔哩哔哩扫码授权')
    expect(choose).not.toContain('使用系统浏览器')
    const waiting = await render({ capabilities, phase: 'waiting', qrContent: 'public-qr-url' })
    expect(waiting).toContain('登录 / 打开哔哩哔哩')
    expect(waiting).toContain('应用分身')
    expect(waiting).not.toContain('<img')
    expect(waiting).not.toContain('native-settings__entries')
    const expired = await render({ capabilities, phase: 'expired' })
    expect(expired).not.toContain('登录 / 打开哔哩哔哩')
    expect(expired).toContain('二维码已过期，重新生成')
  })
  it('shows detection instead of re-login actions for valid credentials', async () => {
    const html = await render({
      account: {
        ...account,
        authentication: 'credential',
        state: { ...account.state, login: 'signed-in' },
      },
    })
    expect(html).not.toContain('二维码登录')
    expect(html).not.toContain('使用系统浏览器')
    expect(html).toContain('检测账号状态')
    expect(html).toContain('检测确认失效后')
    const expired = await render({
      account: { ...account, authentication: 'credential', status: 'expired' },
    })
    expect(expired).toContain('二维码登录')
    expect(expired).toContain('使用系统浏览器')
  })
  it('exposes in-app QR for Douyin and displays the native image', async () => {
    const html = await render({ phase: 'waiting', qrImage: 'data:image/png;base64,synthetic' })
    expect(html).not.toContain('native-settings__entries')
    expect(html).toContain('data:image/png;base64,synthetic')
    expect(html).toContain('请用另一台设备扫码')
    expect(html).toContain('使用抖音手机客户端扫码')
  })
  it('disables unavailable QR, uses one browser entry and only offers completion after opening it', async () => {
    const html = await render({ qrUnavailable: true })
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?二维码登录/)
    expect(html).toContain('请选择其他方式登录')
    expect(html).toContain('使用系统浏览器')
    expect(html).not.toContain('Chrome')
    expect(html).not.toContain('Edge')
    expect(html).not.toContain('我已完成登录 / 验证')
    expect(await render({ phase: 'browser' })).toContain('我已完成登录 / 验证')
  })
  it('presents actual challenge choices and explains external branches', async () => {
    const html = await render({ phase: 'verification', verification })
    expect(html).toContain('接收短信验证码')
    expect(html).toContain('手机刷脸验证（使用系统浏览器）')
    expect(html).toContain('发送短信验证（使用系统浏览器）')
    expect(html).not.toContain('autocomplete="one-time-code"')
  })
  it('shows the six-digit input, masked destination and disabled resend countdown', async () => {
    const html = await render({
      phase: 'verification',
      verification: {
        ...verification,
        selectedMethod: 'mobile_sms_verify',
        maskedMobile: '138****5678',
      },
      retryAfter: 42,
    })
    expect(html).toContain('138****5678')
    expect(html).toContain('inputmode="numeric"')
    expect(html).toContain('autocomplete="one-time-code"')
    expect(html).toContain('maxlength="6"')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*42 秒后重发/)
    expect(html).toContain('选择其他验证方式')
  })
})
