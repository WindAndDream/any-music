import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'

import { DEFAULT_NETWORK_PROXY_SETTINGS } from '#workbench/features/settings/network-proxy-settings'
import { useNetworkProxySettingsForm } from '#workbench/features/settings/use-network-proxy-settings-form'
import type { NetworkProxySettingsFormProps } from '#workbench/features/settings/use-network-proxy-settings-form'

/** 在可清理的 Vue 作用域内模拟已应用配置回流，覆盖开关与未提交草稿的隔离。 */
function createForm(settings = { ...DEFAULT_NETWORK_PROXY_SETTINGS }) {
  const props = reactive<NetworkProxySettingsFormProps>({ settings })
  const emit = vi.fn()
  const scope = effectScope()
  const form = scope.run(() => useNetworkProxySettingsForm({ props, emit }))!
  return { form, props, emit, stop: () => scope.stop() }
}

describe('network proxy form', () => {
  it('saves a disabled configuration without activating it', () => {
    const view = createForm()
    Object.assign(view.form.proxyDraft, {
      host: ' proxy.example.com ',
      port: 3128,
      username: 'alice',
      password: 'secret',
    })
    view.form.submitSettings()
    expect(view.emit).toHaveBeenCalledExactlyOnceWith(
      'save',
      expect.objectContaining({
        isEnabled: false,
        host: 'proxy.example.com',
        port: 3128,
        username: 'alice',
        password: 'secret',
      }),
    )
    view.stop()
  })

  it('toggles the saved configuration immediately without applying or losing unsaved input', async () => {
    const view = createForm({ ...DEFAULT_NETWORK_PROXY_SETTINGS, host: 'saved.example.com' })
    view.form.proxyDraft.host = 'draft.example.com'
    view.form.toggleProxyEnabled()
    expect(view.emit).toHaveBeenLastCalledWith(
      'save',
      expect.objectContaining({ isEnabled: true, host: 'saved.example.com' }),
    )
    view.props.settings = { ...view.props.settings, isEnabled: true }
    await nextTick()
    expect(view.form.proxyDraft.host).toBe('draft.example.com')
    expect(view.form.hasUnsavedChanges.value).toBe(true)
    view.form.toggleProxyEnabled()
    expect(view.emit).toHaveBeenLastCalledWith(
      'save',
      expect.objectContaining({ isEnabled: false, host: 'saved.example.com' }),
    )
    view.props.settings = { ...view.props.settings, isEnabled: false }
    await nextTick()
    view.form.submitSettings()
    expect(view.emit).toHaveBeenLastCalledWith(
      'save',
      expect.objectContaining({ isEnabled: false, host: 'draft.example.com' }),
    )
    view.stop()
  })

  it('requires a saved host before enabling and reports invalid configurations', () => {
    const view = createForm()
    view.form.proxyDraft.host = 'draft.example.com'
    view.form.toggleProxyEnabled()
    expect(view.emit).not.toHaveBeenCalled()
    expect(view.form.errorMessage.value).toContain('保存代理配置')
    view.form.proxyDraft.host = 'https://invalid.example.com'
    view.form.submitSettings()
    expect(view.emit).not.toHaveBeenCalled()
    expect(view.form.errorMessage.value).toContain('不要包含协议')
    view.stop()
  })

  it('keeps an enabled proxy enabled when saving and reloads external configuration changes', async () => {
    const view = createForm({
      ...DEFAULT_NETWORK_PROXY_SETTINGS,
      isEnabled: true,
      host: 'old.example.com',
    })
    view.form.proxyDraft.port = 3128
    view.form.submitSettings()
    expect(view.emit).toHaveBeenLastCalledWith(
      'save',
      expect.objectContaining({ isEnabled: true, port: 3128 }),
    )
    view.props.settings = { ...view.props.settings, host: 'new.example.com', port: 1080 }
    await nextTick()
    expect(view.form.proxyDraft.host).toBe('new.example.com')
    expect(view.form.proxyDraft.port).toBe(1080)
    expect(view.form.hasUnsavedChanges.value).toBe(false)
    view.stop()
  })
})
