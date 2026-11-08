import { createConfirmationDialogController, provideConfirmationDialog } from '@any-music/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, effectScope, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AccountSettingsOverlay from '@/components/accounts/AccountSettingsOverlay.vue'
import AccountSettingsPanel from '@/components/accounts/AccountSettingsPanel.vue'
import { AccountRuntime } from '@/features/accounts/account-runtime'
import type { NativeAccount } from '@/features/accounts/account-runtime'
import { useAccountSettings } from '@/features/accounts/use-account-settings'
import * as accountConfirmation from '@/features/accounts/use-account-settings-confirmation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const accounts: NativeAccount[] = [
  {
    backupProxyIds: [],
    state: {
      login: 'signed-in' as 'signed-in' | 'signed-out',
      verification: 'not-required' as const,
      connection: 'available' as const,
    },

    id: 'a',
    platformId: 'bilibili',
    name: '常用哔哩账号',
    status: 'ready',
    authentication: 'credential',
    enabled: true,
    proxyId: null,
    userAgent: '',
    webId: '',
  },
  {
    backupProxyIds: [],
    state: {
      login: (['expired', 'signed-out'].includes('expired') ? 'signed-out' : 'signed-in') as
        | 'signed-in'
        | 'signed-out',
      verification: 'not-required' as const,
      connection: 'available' as const,
    },

    id: 'b',
    platformId: 'douyin',
    name: '抖音备用账号',
    status: 'expired',
    authentication: 'credential',
    enabled: true,
    proxyId: null,
    userAgent: '',
    webId: '',
  },
]
async function render(
  prepare: (settings: ReturnType<typeof useAccountSettings>) => void,
  savedAccounts = accounts,
) {
  vi.stubGlobal('window', new EventTarget())
  const runtime = new AccountRuntime()
  vi.spyOn(runtime, 'refresh').mockResolvedValue()
  runtime.snapshot.value = { accounts: savedAccounts, proxies: [] }
  const scope = effectScope()
  try {
    const settings = scope.run(() => useAccountSettings(runtime))!
    prepare(settings)
    return await renderToString(
      createSSRApp({
        setup() {
          provideConfirmationDialog()
          return () => [
            h(AccountSettingsPanel, { settings }),
            h(AccountSettingsOverlay, { settings }),
          ]
        },
      }),
    )
  } finally {
    scope.stop()
  }
}
describe('account settings overview and platform overlays', () => {
  it('places deletion confirmation after the suspended account dialog in the protected surface', async () => {
    const confirmation = createConfirmationDialogController()
    const pending = confirmation.confirm({ title: '删除账号', message: '确认删除当前账号？' })
    vi.spyOn(accountConfirmation, 'useAccountSettingsConfirmation').mockReturnValueOnce(
      confirmation,
    )
    try {
      const html = await render((settings) => settings.selectAccountDetail(accounts[0]!))
      expect(html).toMatch(/<div[^>]*class="app-dialog[^"]*"[^>]*\binert/)
      expect(html).toContain('role="alertdialog"')
      expect(html.indexOf('role="alertdialog"')).toBeGreaterThan(
        html.indexOf('<!--teleport end-->'),
      )
    } finally {
      confirmation.dispose()
    }
    await expect(pending).resolves.toBe(false)
  })

  it('opens the add form inside the account management dialog and retains its draft', async () => {
    const html = await render((settings) => {
      settings.startAdd()
      settings.createName.value = '新增账号'
    })
    expect(html).toContain('value="新增账号"')
    expect(html).toContain('aria-label="选择平台"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).not.toContain('<select')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('添加并登录')
    expect(html).toContain('data-dialog-page="add"')
    expect(html).toContain('aria-label="账号管理路径"')
    expect(html.indexOf('value="新增账号"')).toBeGreaterThan(html.indexOf('role="dialog"'))
  })
  it('shows the creation form when returning from an unfinished login', async () => {
    const html = await render((settings) => {
      settings.selectLogin({ ...accounts[1]!, name: '待登录账号', pending: true })
      settings.back()
    }, [])
    expect(html).toContain('value="待登录账号"')
    expect(html).toContain('添加并登录')
    expect(html).toContain('抖音')
    expect(html).not.toContain('登录 / 验证')
  })
  it('shows saved account details after returning from login', async () => {
    const html = await render((settings) => {
      settings.selectLogin(accounts[1]!)
      settings.back()
    })
    expect(html).toContain('抖音备用账号')
    expect(html).toContain('登录 / 验证')
    expect(html).toContain('检测账号状态')
    expect(html).toContain('data-dialog-page="details"')
  })
  it('immediately renders platform summaries and one add entry without disclosures', async () => {
    const html = await render(() => {})
    expect(html).toContain('哔哩哔哩')
    expect(html).toContain('抖音')
    expect(html).toContain('1 个账号 · 1 个已登录')
    expect(html).toContain('1 个未登录')
    expect(html).toContain('一键检测')
    expect(html).not.toContain('常用哔哩账号')
    expect(html).not.toContain('抖音备用账号')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('aria-label="账号管理路径"')
    expect(html.match(/添加账号\s*<\/button>/g)).toHaveLength(1)
  })
  it('opens only the selected platform accounts with individual checks and a path', async () => {
    const html = await render((settings) => settings.selectPlatform('douyin'))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('抖音备用账号')
    expect(html).not.toContain('常用哔哩账号')
    expect(html).toContain('aria-label="检测 抖音备用账号"')
    expect(html).toContain('aria-label="账号管理路径"')
    expect(html).toContain('aria-current="page"')
    expect(html.match(/aria-label="账号管理路径"/g)).toHaveLength(1)
    expect(html.indexOf('aria-label="账号管理路径"')).toBeGreaterThan(html.indexOf('role="dialog"'))
    expect(html).not.toContain('账号设置')
    expect(html).not.toContain('account-list__result')
    expect(html).toContain('关闭')
  })
  it('offers account creation in an empty platform without placeholder accounts or checks', async () => {
    const html = await render((settings) => settings.selectPlatform('douyin'), [])
    expect(html).toContain('此平台尚未添加账号。')
    expect(html).toContain('0 个账号 · 0 个已登录')
    expect(html).not.toContain('默认账号')
    expect(html).not.toContain('aria-label="已保存的账号"')
    expect(html).not.toContain('aria-label="检测 ')
    expect(html.match(/添加账号\s*<\/button>/g)).toHaveLength(2)
  })
  it.each([
    {
      status: 'signed-in' as const,
      message: '登录有效',
      enabled: true,
      expected: '登录有效 · 直连',
    },
    {
      status: 'unavailable' as const,
      message: '检测未完成：连接超时',
      enabled: true,
      expected: '已登录 · 检测未完成：连接超时 · 直连',
    },
    {
      status: 'signed-in' as const,
      message: '登录有效',
      enabled: false,
      expected: '已停用 · 直连',
    },
  ])('keeps account facts in the row after $status checks, enabled=$enabled', async (result) => {
    const html = await render(
      (settings) => {
        settings.selectPlatform('bilibili')
        settings.checkResults.value = new Map([
          [
            'a',
            {
              status: result.status,
              message: result.message,
              checkedAtMs: 1,
              state: { login: 'signed-in', verification: 'not-required', connection: 'available' },
            },
          ],
        ])
      },
      [{ ...accounts[0]!, enabled: result.enabled }],
    )
    const row = html.match(
      /<button[^>]*aria-label="管理 常用哔哩账号"[^>]*>([\s\S]*?)<\/button>/,
    )?.[1]
    expect(row).toContain(result.expected)
    expect(row).toContain('role="status"')
  })
  it('keeps nested account names in the clickable path and locks re-login for saved credentials', async () => {
    const html = await render((settings) => {
      settings.selectAccountDetail(accounts[0]!)
      settings.showSection('connection')
    })
    expect(html).toContain('请求连接')
    expect(html).toMatch(/<button[^>]*>常用哔哩账号<\/button>/)
    const details = await render((settings) => settings.selectAccountDetail(accounts[0]!))
    expect(details).toContain('已登录，可检测当前状态')
    expect(details).toContain('检测账号状态')
  })
})
