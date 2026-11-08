import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import ProxySettingsPanel from '@/components/accounts/ProxySettingsPanel.vue'
import type { NativeAccount } from '@/features/accounts/account-runtime'

describe('desktop proxy settings', () => {
  it('shows multiple proxies and prevents deleting an assigned connection', async () => {
    const account: NativeAccount = {
      backupProxyIds: [],
      state: {
        login: 'signed-in' as 'signed-in' | 'signed-out',
        verification: 'not-required' as const,
        connection: 'available' as const,
      },

      id: 'a',
      name: '主账号',
      platformId: 'bilibili',
      enabled: true,
      status: 'ready',
      authentication: 'credential',
      proxyId: 'p1',
      userAgent: '',
      webId: '',
    }
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(ProxySettingsPanel, {
            accounts: [account],
            proxies: [
              { id: 'p1', name: '本地代理', url: 'http://127.0.0.1:7897' },
              { id: 'p2', name: '备用代理', url: 'socks5://127.0.0.1:1080' },
            ],
            busy: false,
          }),
      }),
    )
    expect(html).toContain('本地代理')
    expect(html).toContain('备用代理')
    expect(html).toContain('已分配给 主账号')
    expect(html).toMatch(/disabled[^>]*aria-label="删除代理 本地代理"/)
    expect(html).not.toMatch(/disabled[^>]*aria-label="删除代理 备用代理"/)
    expect(html).toContain('settings-form__card')
    expect(html).toContain('添加代理</h4>')
    expect(html).toContain('aria-label="已保存的代理"')
    expect(html).not.toContain('代理管理</h4>')
    expect(html).toContain('已分配 1 个账号')
    expect(html).toContain('SOCKS5')
    expect(html).toContain('解除分配后可删除')
  })
  it('explains the direct connection when the proxy list is empty', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () => h(ProxySettingsPanel, { proxies: [], accounts: [], busy: false }),
      }),
    )
    expect(html).toContain('所有账号默认直连')
  })
  it('also protects proxies assigned as backup connections', async () => {
    const account: NativeAccount = {
      state: {
        login: 'signed-out' as 'signed-in' | 'signed-out',
        verification: 'not-required' as const,
        connection: 'available' as const,
      },

      id: 'a',
      name: '备用连接账号',
      platformId: 'bilibili',
      enabled: true,
      status: 'ready',
      authentication: 'anonymous',
      proxyId: null,
      backupProxyIds: ['backup'],
      userAgent: '',
      webId: '',
    }
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(ProxySettingsPanel, {
            accounts: [account],
            proxies: [{ id: 'backup', name: '备用代理', url: 'http://localhost:8080' }],
            busy: false,
          }),
      }),
    )
    expect(html).toContain('已分配给 备用连接账号')
    expect(html).toMatch(/disabled[^>]*aria-label="删除代理 备用代理"/)
  })
})
