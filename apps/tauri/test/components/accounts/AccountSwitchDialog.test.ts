import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AccountSwitchDialog from '@/components/accounts/AccountSwitchDialog.vue'
import type { NativeAccount } from '@/features/accounts/account-runtime'

beforeEach(() => vi.stubGlobal('window', new EventTarget()))
afterEach(() => vi.unstubAllGlobals())

function render(
  names: readonly string[],
  userNames: ReadonlyMap<string, string>,
  platformName = '哔哩哔哩',
  savedNicknames: readonly string[] = [],
) {
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
    platformNickname: savedNicknames[index],
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
          platformName,
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
  it('shows a saved nickname at startup and replaces it with the result of a fresh read', async () => {
    const names = ['常用账号']
    const savedNicknames = ['已验证的昵称']
    const startup = await render(names, new Map(), '抖音', savedNicknames)
    expect(startup).toContain('已验证的昵称（常用账号）')
    expect(startup).not.toContain('抖音（常用账号）')
    const refreshed = await render(names, new Map([['0', '最新昵称']]), '抖音', savedNicknames)
    expect(refreshed).toContain('最新昵称（常用账号）')
  })

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
    expect(html).toContain('下次进入时会保留本次选择')
    expect(html.match(/aria-pressed=/g)).toHaveLength(2)
  })

  it.each(['抖音', '哔哩哔哩', '网易云音乐', '测试外置来源'])(
    'keeps both parts of the label on %s even without a distinct platform username',
    async (platformName) => {
      const html = await render(
        ['待检查账号', '同名账号', '无昵称账号'],
        new Map([
          ['1', ' 同名账号 '],
          ['2', ' '],
        ]),
        platformName,
      )
      expect(html).toContain(`${platformName} · 切换账号`)
      expect(html).toContain(`${platformName}（待检查账号）`)
      expect(html).toContain('同名账号（同名账号）')
      expect(html).toContain(`${platformName}（无昵称账号）`)
    },
  )
})
