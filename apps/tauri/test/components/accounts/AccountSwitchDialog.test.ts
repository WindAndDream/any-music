import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AccountSwitchDialog from '@/components/accounts/AccountSwitchDialog.vue'
import type { NativeAccount } from '@/features/accounts/account-runtime'

beforeEach(() => vi.stubGlobal('window', new EventTarget()))
afterEach(() => vi.unstubAllGlobals())

function render(names: readonly string[], userNames: ReadonlyMap<string, string>) {
  const accounts: NativeAccount[] = names.map((name, index) => ({
    backupProxyIds: [],
    state: {
      login: 'signed-in' as 'signed-in' | 'signed-out',
      verification: 'not-required' as const,
      connection: 'available' as const,
    },

    id: String(index),
    platformId: 'bilibili',
    name,
    status: 'ready',
    enabled: true,
    userAgent: '',
    webId: '',
    proxyId: null,
    authentication: 'credential',
  }))
  return renderToString(
    createSSRApp({
      render: () =>
        h(AccountSwitchDialog, {
          platformId: 'bilibili',
          accounts,
          userNames,
          proxies: [],
          selectedId: '0',
          busy: false,
          error: '',
        }),
    }),
  )
}

describe('account switcher names', () => {
  it('shows the platform username followed by its custom name, scoped to each account', async () => {
    const html = await render(
      ['常用账号', '备用账号'],
      new Map([
        ['0', '平台用户甲'],
        ['1', '平台用户乙'],
      ]),
    )
    expect(html).toContain('平台用户甲（常用账号）')
    expect(html).toContain('平台用户乙（备用账号）')
    expect(html).not.toContain('平台用户甲（备用账号）')
    expect(html).toContain('aria-pressed="true"')
  })

  it('retains a usable name before a session check and avoids repeating identical names', async () => {
    const html = await render(['待检查账号', '同名账号'], new Map([['1', '同名账号']]))
    expect(html).toMatch(/<strong[^>]*>待检查账号<\/strong>/)
    expect(html).toMatch(/<strong[^>]*>同名账号<\/strong>/)
    expect(html).not.toContain('同名账号（同名账号）')
  })
})
