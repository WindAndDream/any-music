import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, effectScope, h, nextTick } from 'vue'

import AccountSettingsOverlay from '@/components/accounts/AccountSettingsOverlay.vue'
import { AccountRuntime } from '@/features/accounts/account-runtime'
import { useAccountSettings } from '@/features/accounts/use-account-settings'

import { TestNode, nodes, renderer } from '../../fixtures/node-renderer'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
// Native dialog focus/layout is verified in the optimized application, separately from this lifecycle host.
vi.mock('@/components/accounts/AccountSettingsDialog.vue', () => ({
  default: defineComponent({
    setup(_props, { slots }) {
      return () => h('section', slots.default?.())
    },
  }),
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('protected account presentation replacement', () => {
  it('retains the host-owned account popup and draft through unmount/remount, closing only on host close', async () => {
    vi.stubGlobal('window', new EventTarget())
    const runtime = new AccountRuntime()
    vi.spyOn(runtime, 'refresh').mockResolvedValue()
    const owner = effectScope()
    const settings = owner.run(() => useAccountSettings(runtime))!
    settings.startAdd()
    settings.createName.value = 'Unsubmitted account'
    const close = vi.spyOn(settings, 'close')
    const mount = () => {
      const root = new TestNode('root')
      const app = renderer.createApp({
        render: () =>
          h(AccountSettingsOverlay, { settings, overlayTarget: root as unknown as HTMLElement }),
      })
      app.mount(root)
      return { app, root }
    }
    let view = mount()
    try {
      view.app.unmount()
      expect(close).not.toHaveBeenCalled()
      expect(settings.detailOpen.value).toBe(true)
      expect(settings.createName.value).toBe('Unsubmitted account')
      view = mount()
      expect(
        nodes(view.root).find((node) => node.props.placeholder === '给账号起一个名字')?.value,
      ).toBe('Unsubmitted account')
      settings.close()
      await nextTick()
      expect(settings.detailOpen.value).toBe(false)
    } finally {
      view.app.unmount()
      owner.stop()
    }
  })
})
