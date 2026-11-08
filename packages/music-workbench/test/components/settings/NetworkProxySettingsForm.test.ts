import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import NetworkProxySettingsForm from '#workbench/components/settings/NetworkProxySettingsForm.vue'
import { DEFAULT_NETWORK_PROXY_SETTINGS } from '#workbench/features/settings/network-proxy-settings'

describe('NetworkProxySettingsForm', () => {
  it('keeps saved proxy fields editable while the enable switch is off', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(NetworkProxySettingsForm, {
            settings: {
              ...DEFAULT_NETWORK_PROXY_SETTINGS,
              host: 'proxy.example.com',
              type: 'socks',
            },
          }),
      }),
    )
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('proxy.example.com')
    expect(html).not.toContain('disabled')
    expect(html).toContain('保存代理配置')
    expect(html).not.toContain('配置已同步')
    expect(html).not.toContain('有未保存的修改')
    expect(html).toContain('novalidate')
    expect(html).toContain('通过代理解析 DNS')
  })
})
