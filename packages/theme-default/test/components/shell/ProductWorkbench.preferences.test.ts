import { PRODUCT_DESTINATIONS, UI_THEME_SELECTION } from '@any-music/ui'
import type { UiThemeSelection } from '@any-music/ui'
import { describe, expect, it, vi } from 'vitest'
import {
  defineComponent as defineHost,
  h as render,
  nextTick,
  provide,
  reactive,
  shallowRef,
} from 'vue'
import type { VNode } from 'vue'

import ProductWorkbench from '../../../src/components/shell/ProductWorkbench.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'
import type { CatalogTestElement } from '../../helpers/test-renderer'

// Node 宿主执行真实设置面板与选项事件；底层弹窗焦点圈和壳层 DOM 能力使用薄替身。
vi.mock('@any-music/ui/components/MusicAppShell.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h(
            'main',
            {
              // 壳层根节点承接工作台的 v-show，提供该原生指令所需的最小 style 契约。
              onVnodeBeforeMount(vnode: VNode) {
                if (vnode.el) vnode.el.style = { display: '' }
              },
            },
            slots.overlays?.(),
          ),
    }),
  }
})

vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['open', 'suspended', 'title'],
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? h(
                'section',
                { 'aria-label': props.title, inert: props.suspended || undefined },
                slots.default?.(),
              )
            : null,
    }),
  }
})

vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['open', 'suspended', 'title'],
      emits: ['close'],
      setup:
        (props, { slots, emit }) =>
        () =>
          props.open
            ? h('section', { role: 'dialog', 'aria-label': props.title }, [
                h('button', { 'aria-label': '关闭选择', onClick: () => emit('close') }, '关闭'),
                slots.default?.(),
              ])
            : null,
    }),
  }
})

function findButton(root: CatalogTestElement, label: string) {
  return findCatalogElement(
    root,
    (node) => node.tag === 'button' && node.props['aria-label'] === label,
  )
}

function mountWorkbench(themeSelection?: UiThemeSelection) {
  const props = reactive({
    activeDestination: PRODUCT_DESTINATIONS[0]!,
    activeDescription: '',
    navigationItems: [],
    mobileNavigationItems: [],
    activeMobileNavigationId: 'discover',
    preferenceDestinations: [],
    hiddenDestinationIds: [],
    sidebarSide: 'left' as 'left' | 'right',
    sidebarCollapsed: false,
    configuredSidebarCollapsed: false,
    mobileDrawerOpen: false,
    mobileNavigationEnabled: true,
    mobileLayout: true,
    preferencesOpen: true,
    theme: 'system' as 'system' | 'light' | 'dark',
    resolvedTheme: 'light' as const,
    onSetTheme: vi.fn(),
    onSetSidebarSide: vi.fn(),
    onSetMobileNavigationEnabled: vi.fn(),
  })
  const component = themeSelection
    ? defineHost({
        setup() {
          provide(UI_THEME_SELECTION, themeSelection)
          return () => render(ProductWorkbench, props)
        },
      })
    : ProductWorkbench
  const mounted = mountCatalogComponent(component, props)
  return { ...mounted, props }
}

describe('AppShellPreferencesPanel interactions', () => {
  it('applies theme and side choices above a suspended sheet and toggles bottom navigation', async () => {
    const view = mountWorkbench()
    const sheet = () =>
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '自定义界面')
    dispatchCatalogEvent(findButton(view.root, '主题：跟随系统'), 'onClick')
    await nextTick()
    expect(sheet().props.inert).toBe(true)
    const selected = findCatalogElement(
      view.root,
      (node) =>
        node.tag === 'button' &&
        node.props['aria-pressed'] === true &&
        node.textContent.includes('跟随系统'),
    )
    expect(selected.textContent).toContain('已选')
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes('深色背景'),
      ),
      'onClick',
    )
    await nextTick()
    expect(view.props.onSetTheme).toHaveBeenCalledExactlyOnceWith('dark')
    expect(sheet().props.inert).toBeUndefined()
    expect(() => findCatalogElement(view.root, (node) => node.props.role === 'dialog')).toThrow()
    view.props.theme = 'dark'
    await nextTick()
    expect(findButton(view.root, '主题：深色')).toBeDefined()

    dispatchCatalogEvent(findButton(view.root, '侧栏位置：左侧'), 'onClick')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent.includes('位于右侧'),
      ),
      'onClick',
    )
    await nextTick()
    expect(view.props.onSetSidebarSide).toHaveBeenCalledExactlyOnceWith('right')
    view.props.sidebarSide = 'right'
    await nextTick()
    expect(findButton(view.root, '侧栏位置：右侧')).toBeDefined()
    // 侧位仍展示当前值，但不再参与设置控件的排列。
    const preferences = findCatalogElement(view.root, (node) =>
      String(node.props.class).split(' ').includes('shell-preferences'),
    )
    expect(preferences.props['data-sidebar-side']).toBeUndefined()

    const toggle = () => findButton(view.root, '移动端底部导航')
    expect(toggle().props['aria-pressed']).toBe(true)
    dispatchCatalogEvent(toggle(), 'onClick')
    expect(view.props.onSetMobileNavigationEnabled).toHaveBeenCalledExactlyOnceWith(false)
    view.props.mobileNavigationEnabled = false
    await nextTick()
    expect(toggle().textContent).toContain('已关闭')
    expect(toggle().props['aria-pressed']).toBe(false)
    dispatchCatalogEvent(toggle(), 'onClick')
    expect(view.props.onSetMobileNavigationEnabled).toHaveBeenLastCalledWith(true)
    expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
    view.unmount()
  })

  it('cancels without changing preferences and clears choices when settings close', async () => {
    const view = mountWorkbench()
    dispatchCatalogEvent(findButton(view.root, '主题：跟随系统'), 'onClick')
    await nextTick()
    dispatchCatalogEvent(findButton(view.root, '关闭选择'), 'onClick')
    await nextTick()
    expect(view.props.onSetTheme).not.toHaveBeenCalled()
    expect(view.props.onSetSidebarSide).not.toHaveBeenCalled()
    dispatchCatalogEvent(findButton(view.root, '侧栏位置：左侧'), 'onClick')
    await nextTick()
    view.props.preferencesOpen = false
    await nextTick()
    view.props.preferencesOpen = true
    await nextTick()
    expect(() => findCatalogElement(view.root, (node) => node.props.role === 'dialog')).toThrow()
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '自定义界面').props
        .inert,
    ).toBeUndefined()
    view.unmount()
  })

  it('opens interface themes in the shared picker, applies a choice and updates its label', async () => {
    const currentId = shallowRef('standard')
    const select = vi.fn((id: string) => {
      currentId.value = id
    })
    const view = mountWorkbench({
      choices: [
        { id: 'standard', title: '标准界面' },
        { id: 'studio', title: '工作室' },
      ],
      currentId: () => currentId.value,
      select,
    })
    expect(() => findCatalogElement(view.root, (node) => node.tag === 'select')).toThrow()
    expect(findButton(view.root, '界面主题：标准界面').props['aria-haspopup']).toBe('dialog')
    dispatchCatalogEvent(findButton(view.root, '界面主题：标准界面'), 'onClick')
    await nextTick()
    const dialog = findCatalogElement(view.root, (node) => node.props.role === 'dialog')
    expect(dialog.props['aria-label']).toBe('界面主题')
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '自定义界面').props
        .inert,
    ).toBe(true)
    expect(
      findCatalogElement(
        dialog,
        (node) => node.tag === 'button' && node.props['aria-pressed'] === true,
      ).textContent,
    ).toContain('标准界面')
    expect(select).not.toHaveBeenCalled()
    dispatchCatalogEvent(
      findCatalogElement(
        dialog,
        (node) => node.tag === 'button' && node.textContent.includes('工作室'),
      ),
      'onClick',
    )
    await nextTick()
    expect(select).toHaveBeenCalledExactlyOnceWith('studio')
    expect(findButton(view.root, '界面主题：工作室')).toBeDefined()
    expect(() => findCatalogElement(view.root, (node) => node.props.role === 'dialog')).toThrow()
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '自定义界面').props
        .inert,
    ).toBeUndefined()

    dispatchCatalogEvent(findButton(view.root, '界面主题：工作室'), 'onClick')
    await nextTick()
    dispatchCatalogEvent(findButton(view.root, '关闭选择'), 'onClick')
    await nextTick()
    expect(select).toHaveBeenCalledTimes(1)
    expect(findButton(view.root, '界面主题：工作室')).toBeDefined()
    view.unmount()
  })
})
