import {
  createDefaultAppShellPreferences,
  createEditingSession,
  provideEditingSession,
  PRODUCT_DESTINATIONS,
} from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, shallowRef } from 'vue'

import ClassicSettings from '../../../src/components/settings/ClassicSettings.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent: defineDialog, h: renderDialog } = await import('vue')
  return {
    default: defineDialog({
      props: ['open', 'suspended'],
      emits: ['close'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? renderDialog('section', { role: 'dialog' }, [
                slots.default?.(),
                renderDialog(
                  'button',
                  { 'aria-label': '关闭弹窗', onClick: () => emit('close') },
                  '关闭',
                ),
              ])
            : null,
    }),
  }
})
beforeEach(() => vi.stubGlobal('document', { activeElement: null }))
afterEach(() => vi.unstubAllGlobals())

function mountSettings(
  section: UiThemeFeatureMap['settings']['state']['section'],
  accounts = false,
) {
  const state = reactive({
    section,
    open: true,
    isMobileLayout: false,
    suspended: false,
    destinations: PRODUCT_DESTINATIONS,
    sources: [],
    enabledSourceIds: [],
    availabilityBySourceId: {},
    externalSourcesEnabled: true,
    profileId: 'creator:stable',
    appearance: 'system' as const,
    themeId: 'default' as const,
    themes: [
      { id: 'default' as const, title: '经典' },
      {
        id: 'studio' as const,
        title: '工作室',
        unavailableReason: undefined as string | undefined,
      },
    ],
    preferences: createDefaultAppShellPreferences(),
    playbackHistoryLimit: 100,
    downloadConcurrency: 2,
    creatorDisplayName: 'Saved',
    filterHistory: {
      limits: { search: 12, tags: 12, published: 12, duration: 12, platforms: 12, naming: 12 },
      collapseAfter: 3,
    },
  })
  const actions: UiThemeFeatureMap['settings']['actions'] = {
    close: vi.fn(),
    selectSection: vi.fn(),
    setSourceEnabled: vi.fn(),
    checkSource: vi.fn(),
    setAppearance: vi.fn(),
    selectTheme: vi.fn(),
    setPreferences: vi.fn(),
    setPlaybackHistoryLimit: vi.fn(),
    setDownloadConcurrency: vi.fn(),
    setCreatorDisplayName: vi.fn(),
    setFilterHistory: vi.fn(),
  }
  const feature: UiThemeFeatureMap['settings'] = {
    state,
    actions,
    status: { status: 'ready' },
    availability: { status: 'available' },
  }
  const editing = createEditingSession()
  const version = shallowRef(0)
  const detailOpenChange = vi.fn()
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        return () =>
          h(
            ClassicSettings,
            { feature, key: version.value, onDetailOpenChange: detailOpenChange },
            accounts
              ? {
                  'account-settings': () =>
                    h('button', { 'data-host-account': true }, '固定宿主账号内容'),
                }
              : {},
          )
      },
    }),
    {},
  )
  return { ...view, state, actions, editing, version, detailOpenChange }
}

describe('classic complete-root settings adapter', () => {
  it('keeps the theme picker open when an unavailable choice requests its host notice', async () => {
    const view = mountSettings('appearance')
    try {
      view.state.themes[1] = {
        id: 'studio',
        title: '工作室',
        unavailableReason: '工作室主题正在开发中。',
      }
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === '界面主题：经典'),
        'onClick',
      )
      await nextTick()
      const choice = findCatalogElement(
        view.root,
        (node) => node.props['data-am-focus-key'] === 'preference:ui-theme:studio',
      )
      expect(choice.props['aria-disabled']).toBe(true)
      dispatchCatalogEvent(choice, 'onClick')
      await nextTick()
      expect(view.actions.selectTheme).toHaveBeenCalledExactlyOnceWith('studio')
      expect(view.state.themeId).toBe('default')
      expect(view.detailOpenChange).toHaveBeenLastCalledWith(true)
      expect(
        findCatalogElement(
          view.root,
          (node) => node.props['data-am-focus-key'] === 'preference:ui-theme:studio',
        ),
      ).toBeDefined()
    } finally {
      view.unmount()
      view.editing.dispose()
    }
  })
  it('releases the parent suspension when an open detail is disposed', async () => {
    const view = mountSettings('appearance')
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '主题：跟随系统'),
      'onClick',
    )
    await nextTick()
    expect(view.detailOpenChange).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(view.detailOpenChange).toHaveBeenLastCalledWith(false)
    view.editing.dispose()
  })

  it('preserves the unfinished form across replacement and saves only on explicit submit', async () => {
    const view = mountSettings('creator-profile')
    const input = findCatalogElement(view.root, (node) => node.props.autocomplete === 'nickname')
    input.value = 'Unfinished creator'
    dispatchCatalogEvent(input, 'onInput')
    await nextTick()
    view.version.value++
    await nextTick()
    expect(
      findCatalogElement(view.root, (node) => node.props.autocomplete === 'nickname').value,
    ).toBe('Unfinished creator')
    expect(view.actions.setCreatorDisplayName).not.toHaveBeenCalled()
    expect(view.actions.selectSection).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
    )
    expect(view.actions.setCreatorDisplayName).toHaveBeenCalledExactlyOnceWith('Unfinished creator')
    view.unmount()
    view.editing.dispose()
  })

  it('keeps UI theme choice independent from the light/dark/system preference and supports cancel', async () => {
    const view = mountSettings('appearance')
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '界面主题：经典'),
      'onClick',
    )
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.props['data-am-focus-key'] === 'preference:ui-theme:studio',
      ),
      'onClick',
    )
    expect(view.actions.selectTheme).toHaveBeenCalledExactlyOnceWith('studio')
    expect(view.actions.setAppearance).not.toHaveBeenCalled()
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '主题：跟随系统'),
      'onClick',
    )
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.props['data-am-focus-key'] === 'preference:theme:dark',
      ),
      'onClick',
    )
    expect(view.actions.setAppearance).toHaveBeenCalledExactlyOnceWith('dark')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '侧栏位置：左侧'),
      'onClick',
    )
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '关闭弹窗'),
      'onClick',
    )
    expect(view.actions.setPreferences).not.toHaveBeenCalled()
    view.unmount()
    view.editing.dispose()
  })

  it('offers account/native entries only through available fixed host slots', () => {
    const absent = mountSettings('accounts')
    expect(absent.root.textContent).not.toContain('账号管理')
    expect(absent.root.textContent).not.toContain('外置音乐源')
    expect(absent.root.textContent).not.toContain('请求代理')
    absent.unmount()
    absent.editing.dispose()
    const present = mountSettings('accounts', true)
    expect(present.root.textContent).toContain('账号管理')
    expect(
      findCatalogElement(present.root, (node) => node.props['data-host-account'] === true)
        .textContent,
    ).toBe('固定宿主账号内容')
    expect(present.actions.checkSource).not.toHaveBeenCalled()
    present.unmount()
    present.editing.dispose()
  })
})
