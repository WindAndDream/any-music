import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import App from '@/App.vue'

import { TestNode, nodes, renderer } from '../fixtures/node-renderer'

const workbench = vi.hoisted(() => ({
  openSettings: vi.fn(),
  refreshSession: vi.fn().mockResolvedValue(undefined),
  overlayTarget: null as TestNode | null,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/platform/configure-tauri-workbench', async () => {
  const { AccountRuntime } = await import('@/features/accounts/account-runtime')
  return {
    accountRuntime: new AccountRuntime(),
    getNativeRuntimeCapabilities: () => ({
      platform: 'windows',
      form: 'desktop',
      accountTransport: 'provided',
    }),
  }
})
vi.mock('@any-music/music-workbench/components/music-sources/MusicSourceWorkbench.vue', () => ({
  default: defineComponent({
    props: { accountDialogOpen: Boolean },
    emits: ['addAccount', 'settingsClosed'],
    setup(props, { emit, expose, slots }) {
      const settingsOpen = shallowRef(false)
      function openSettings(section?: string | null) {
        workbench.openSettings(section)
        settingsOpen.value = true
      }
      expose({ openSettings, refreshSession: workbench.refreshSession })
      return () =>
        h('main', { 'data-account-dialog-open': props.accountDialogOpen }, [
          h('button', { onClick: () => emit('addAccount', 'netease') }, '发现：添加账号'),
          h('button', { onClick: () => openSettings('accounts') }, '打开设置'),
          settingsOpen.value
            ? h('section', { 'data-global-settings': true }, [
                slots['account-settings']?.({ detailOpenChange: () => {} }),
                h(
                  'button',
                  {
                    onClick: () => {
                      settingsOpen.value = false
                      emit('settingsClosed')
                    },
                  },
                  '关闭设置',
                ),
              ])
            : null,
          slots['account-overlays']?.({
            refreshSession: workbench.refreshSession,
            openSettings,
            isMobileLayout: false,
            overlayTarget: workbench.overlayTarget,
            suspended: false,
          }),
        ])
    },
  }),
}))
// Exercise account forms and entry events without claiming browser animation/focus acceptance.
vi.mock('@/components/accounts/AccountSettingsDialog.vue', () => ({
  default: defineComponent({
    props: { open: Boolean, title: String },
    emits: ['close'],
    setup(props, { slots, emit }) {
      return () =>
        props.open
          ? h('section', { role: 'dialog' }, [
              h('h2', props.title),
              slots.default?.(),
              slots.footer?.(),
              h('button', { onClick: () => emit('close') }, '关闭账号弹窗'),
            ])
          : null
    },
  }),
}))

const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', { removeEventListener: vi.fn() })
  workbench.openSettings.mockClear()
  workbench.refreshSession.mockClear()
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount() {
  const root = new TestNode('root')
  workbench.overlayTarget = root
  const app = renderer.createApp(App)
  app.mount(root)
  cleanups.push(() => app.unmount())
  async function click(label: string) {
    const button = nodes(root).find(
      (node) => node.tag === 'button' && node.textContent.trim() === label,
    )
    expect(button, label).toBeDefined()
    const handler = button!.props.onClick as () => void
    handler()
    await nextTick()
  }
  return { root, click }
}

describe('Discover account creation', () => {
  it('opens only the preselected NetEase account dialog and returns to Discover on close', async () => {
    const { root, click } = mount()
    await click('发现：添加账号')
    expect(workbench.openSettings).not.toHaveBeenCalled()
    expect(nodes(root).filter((node) => node.props.role === 'dialog')).toHaveLength(1)
    expect(root.textContent).toContain('网易云音乐')
    expect(root.textContent).toContain('添加并登录')
    expect(nodes(root).some((node) => node.props['data-global-settings'])).toBe(false)
    expect(nodes(root).some((node) => node.props['data-account-dialog-open'] === true)).toBe(true)
    await click('关闭')
    expect(nodes(root).some((node) => node.props.role === 'dialog')).toBe(false)
    expect(workbench.openSettings).not.toHaveBeenCalled()
    expect(workbench.refreshSession).toHaveBeenCalledTimes(1)
    await click('发现：添加账号')
    expect(nodes(root).filter((node) => node.props.role === 'dialog')).toHaveLength(1)
    await click('关闭账号弹窗')
    expect(nodes(root).some((node) => node.props.role === 'dialog')).toBe(false)
    expect(workbench.openSettings).not.toHaveBeenCalled()
  })

  it('retains account creation from settings and avoids duplicate account overlays', async () => {
    const { root, click } = mount()
    await click('打开设置')
    expect(root.textContent).toContain('平台账号')
    await click('添加账号')
    expect(nodes(root).filter((node) => node.props.role === 'dialog')).toHaveLength(1)
    await click('关闭账号弹窗')
    expect(nodes(root).some((node) => node.props.role === 'dialog')).toBe(false)
    expect(root.textContent).toContain('平台账号')
    await click('关闭设置')
    await click('发现：添加账号')
    expect(nodes(root).some((node) => node.props['data-global-settings'])).toBe(false)
    expect(nodes(root).filter((node) => node.props.role === 'dialog')).toHaveLength(1)
    expect(workbench.openSettings).toHaveBeenCalledTimes(1)
  })
})
