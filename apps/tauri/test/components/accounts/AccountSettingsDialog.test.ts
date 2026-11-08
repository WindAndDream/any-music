import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AccountSettingsDialog from '@/components/accounts/AccountSettingsDialog.vue'

beforeEach(() => vi.stubGlobal('window', new EventTarget()))
afterEach(() => vi.unstubAllGlobals())

describe('responsive account settings overlays', () => {
  it.each([false, true])('uses an accessible overlay for mobile=%s', async (isMobileLayout) => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            AccountSettingsDialog,
            { open: true, title: '请求连接', isMobileLayout },
            {
              default: () => h('button', '保存连接'),
              footer: () => h('button', '返回'),
            },
          ),
      }),
    )
    expect(html).toContain(
      isMobileLayout ? 'bottom-sheet__panel--compact' : 'app-dialog__panel--compact',
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('请求连接')
    expect(html).toContain('保存连接')
    expect(html).toContain('返回')
  })
})
