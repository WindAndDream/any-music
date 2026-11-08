import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive } from 'vue'

import AppDialog from '../../src/components/AppDialog.vue'
import BottomSheet from '../../src/components/BottomSheet.vue'
import { containModalTab } from '../../src/components/modal-focus'
import MusicAppShell from '../../src/components/MusicAppShell.vue'
import ConfirmationDialog from '../../src/components/product-workbench/ConfirmationDialog.vue'
import SidePanel from '../../src/components/SidePanel.vue'
import type { ActiveConfirmationRequest } from '../../src/composables/use-confirmation-dialog'
import { useOverlayKeyboard } from '../../src/composables/use-overlay-keyboard'
import {
  CatalogTestElement,
  mountCatalogComponent,
} from '../components/music-sources/catalog-test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})

vi.mock('../../src/components/modal-focus', async (load) => ({
  ...(await load<typeof import('../../src/components/modal-focus')>()),
  containModalTab: vi.fn(),
}))

const unmounts: (() => void)[] = []

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', { activeElement: null })
  vi.stubGlobal('HTMLElement', CatalogTestElement)
  vi.stubGlobal(
    'ShadowRoot',
    class {
      activeElement = null
    },
  )
})

afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount())
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function pressKey(key = 'Escape', extra: { repeat?: boolean; isComposing?: boolean } = {}) {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ...extra })
  window.dispatchEvent(event)
  return event
}

function mountOverlays(dialogFirst = false) {
  const state = reactive({
    panel: false,
    sheet: false,
    dialog: false,
    suspended: false,
    request: undefined as ActiveConfirmationRequest | undefined,
  })
  const closed: string[] = []
  const view = mountCatalogComponent(
    defineComponent({
      setup: () => () => {
        const panel = h(SidePanel, {
          open: state.panel,
          title: '操作器',
          onClose: () => {
            closed.push('panel')
            state.panel = false
          },
        })
        const sheet = h(BottomSheet, {
          open: state.sheet,
          suspended: state.suspended,
          title: '歌曲操作',
          onClose: () => {
            closed.push('sheet')
            state.sheet = false
          },
        })
        const dialog = h(AppDialog, {
          open: state.dialog,
          title: '添加到歌单',
          onClose: () => {
            closed.push('dialog')
            state.dialog = false
          },
        })
        const confirmation = h(ConfirmationDialog, {
          request: state.request,
          onCancel: () => {
            closed.push('confirmation')
            state.request = undefined
          },
        })
        return h(
          'div',
          dialogFirst ? [dialog, sheet, panel, confirmation] : [panel, sheet, dialog, confirmation],
        )
      },
    }),
    {},
  )
  unmounts.push(view.unmount)
  return { state, closed, view }
}

describe('overlay keyboard ownership', () => {
  it.each([false, true])(
    'dismisses one visible layer per Escape regardless of component mount order (%s)',
    async (dialogFirst) => {
      const { state, closed } = mountOverlays(dialogFirst)
      state.panel = true
      await nextTick()
      state.sheet = true
      await nextTick()
      state.dialog = true
      await nextTick()

      expect(pressKey().defaultPrevented).toBe(true)
      expect(closed).toEqual(['dialog'])
      expect(state.sheet).toBe(true)
      expect(state.panel).toBe(true)
      await nextTick()
      pressKey()
      expect(closed).toEqual(['dialog', 'sheet'])
      await nextTick()
      pressKey()
      expect(closed).toEqual(['dialog', 'sheet', 'panel'])
      await nextTick()
      expect(pressKey().defaultPrevented).toBe(false)
    },
  )

  it('keeps a modal above a later-opened operator and cancels its confirmation first', async () => {
    const { state, closed } = mountOverlays()
    state.sheet = true
    await nextTick()
    state.panel = true
    state.request = {
      id: 1,
      title: '删除歌曲',
      message: '确定删除？',
      confirmLabel: '删除',
      cancelLabel: '取消',
      tone: 'danger',
    }
    await nextTick()
    pressKey()
    expect(closed).toEqual(['confirmation'])
    expect(state.sheet).toBe(true)
    expect(state.panel).toBe(true)
    await nextTick()
    pressKey()
    expect(closed).toEqual(['confirmation', 'sheet'])
  })

  it('uses opening order after a pre-mounted dialog is reopened', async () => {
    const { state, closed } = mountOverlays(true)
    state.dialog = true
    await nextTick()
    state.sheet = true
    await nextTick()
    state.dialog = false
    await nextTick()
    state.dialog = true
    await nextTick()
    pressKey()
    expect(closed).toEqual(['dialog'])
    expect(state.sheet).toBe(true)
  })

  it('contains Tab only in the top modal and ignores suspended layers', async () => {
    const { state } = mountOverlays()
    state.sheet = true
    await nextTick()
    state.dialog = true
    await nextTick()
    pressKey('Tab')
    expect(containModalTab).toHaveBeenCalledOnce()
    expect(vi.mocked(containModalTab).mock.calls[0]?.[1]?.textContent).toContain('添加到歌单')
    state.dialog = false
    state.suspended = true
    await nextTick()
    pressKey('Tab')
    expect(containModalTab).toHaveBeenCalledOnce()
    expect(pressKey().defaultPrevented).toBe(false)
  })

  it('does not close another layer while Escape repeats or the input method is composing', async () => {
    const { state, closed } = mountOverlays()
    state.panel = true
    state.dialog = true
    await nextTick()
    pressKey('Escape', { isComposing: true })
    expect(closed).toEqual([])
    pressKey()
    await nextTick()
    pressKey('Escape', { repeat: true })
    expect(closed).toEqual(['dialog'])
    pressKey()
    expect(closed).toEqual(['dialog', 'panel'])
  })

  it('closes a dialog before the mobile navigation drawer', async () => {
    const state = reactive({ drawer: true, dialog: false })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(
            MusicAppShell,
            {
              mobileLayout: true,
              mobileDrawerOpen: state.drawer,
              onCloseMobileDrawer: () => (state.drawer = false),
            },
            {
              overlays: () =>
                h(AppDialog, {
                  open: state.dialog,
                  title: '设置',
                  onClose: () => (state.dialog = false),
                }),
            },
          ),
      }),
      {},
    )
    unmounts.push(view.unmount)
    state.dialog = true
    await nextTick()
    pressKey()
    expect(state.dialog).toBe(false)
    expect(state.drawer).toBe(true)
    await nextTick()
    pressKey()
    expect(state.drawer).toBe(false)
  })

  it('releases cached and unmounted overlays without leaving window listeners', async () => {
    const state = reactive({ visible: true })
    const close = vi.fn()
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const cached = defineComponent({
      setup() {
        useOverlayKeyboard({ active: true, layer: 'modal', onEscape: close })
        return () => h('div')
      },
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, { default: () => (state.visible ? h(cached) : null) }),
      }),
      {},
    )
    pressKey()
    expect(close).toHaveBeenCalledOnce()
    state.visible = false
    await nextTick()
    expect(pressKey().defaultPrevented).toBe(false)
    state.visible = true
    await nextTick()
    pressKey()
    expect(close).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(pressKey().defaultPrevented).toBe(false)
    expect(add.mock.calls).toHaveLength(remove.mock.calls.length)
  })

  it('retains nested modal ordering when an already-open tree returns from KeepAlive', async () => {
    const state = reactive({ visible: true, parent: true, child: true })
    const cached = defineComponent({
      setup: () => () =>
        h(
          AppDialog,
          {
            open: state.parent,
            title: '外层弹窗',
            onClose: () => (state.parent = false),
          },
          {
            default: () =>
              h(BottomSheet, {
                open: state.child,
                title: '最上层弹窗',
                onClose: () => (state.child = false),
              }),
          },
        ),
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, { default: () => (state.visible ? h(cached) : null) }),
      }),
      {},
    )
    unmounts.push(view.unmount)
    state.visible = false
    await nextTick()
    expect(pressKey().defaultPrevented).toBe(false)
    state.visible = true
    await nextTick()
    pressKey()
    expect(state.child).toBe(false)
    expect(state.parent).toBe(true)
    await nextTick()
    pressKey()
    expect(state.parent).toBe(false)
  })
})
