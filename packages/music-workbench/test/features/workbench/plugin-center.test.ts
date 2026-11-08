import { createAppErrorState } from '@any-music/core'
import { definition as classic } from '@any-music/theme-default/vue'
import { definition as studio } from '@any-music/theme-studio/vue'
import { createEditingSession, provideEditingSession } from '@any-music/ui'
import type { UiPluginCenterItem, UiThemeFeatureMap } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, shallowRef } from 'vue'

import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  renderer,
} from '../../helpers/test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})

vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const { defineComponent: component, h: render } = await import('vue')
  return {
    default: component({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? render('dialog', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
const builtin: UiPluginCenterItem = {
  id: 'feature.tags',
  name: '标签管理',
  description: '整理音乐标签',
  origin: 'builtin',
  category: '资料整理',
  enabled: true,
  status: { status: 'ready' },
}
const external: UiPluginCenterItem = {
  id: 'install-1',
  name: 'org.example.catalog',
  description: '外置目录',
  origin: 'external',
  category: '音乐源',
  enabled: true,
  status: { status: 'ready' },
  publisher: 'publisher',
  generation: 3,
}
function mount(initial: typeof classic | typeof studio) {
  const selection = shallowRef<typeof classic | typeof studio>(initial)
  const state = reactive({ items: [builtin, external], externalSupported: true, busy: false })
  const actions = {
    setEnabled: vi.fn(),
    retry: vi.fn(),
    importPlugin: vi.fn(),
    manageExternal: vi.fn(),
    refresh: vi.fn(),
  }
  const feature: UiThemeFeatureMap['plugins'] = {
    state,
    actions,
    availability: { status: 'available' },
    status: { status: 'ready' },
  }
  const editing = createEditingSession()
  const app = renderer.createApp(
    defineComponent({
      setup() {
        provideEditingSession(editing)
        return () => h(selection.value.views.plugins, { feature })
      },
    }),
  )
  const root = new CatalogTestElement('root')
  app.mount(root)
  return {
    root,
    state,
    actions,
    selection,
    unmount: () => {
      app.unmount()
      editing.dispose()
    },
  }
}
function button(root: CatalogTestElement, label: string) {
  return findCatalogElement(
    root,
    (node) => node.tag === 'button' && node.textContent.trim().startsWith(label),
  )
}

describe.each([
  ['classic', classic],
  ['studio', studio],
] as const)('%s plugin center', (_name, definition) => {
  it('keeps unavailable switches off while forwarding clicks to the host notice action', async () => {
    const f = mount(definition)
    try {
      f.state.items = [{ ...builtin, enabled: false, unavailableReason: '这个插件正在开发中。' }]
      await nextTick()
      const control = findCatalogElement(f.root, (node) => node.props.role === 'switch')
      expect(control.props['aria-disabled']).toBe(true)
      dispatchCatalogEvent(control, 'onClick')
      expect(f.actions.setEnabled).toHaveBeenCalledExactlyOnceWith('feature.tags', true)
      expect(control.props.checked).toBe(false)
    } finally {
      f.unmount()
    }
  })
  it.each([
    ['updating', '更新中'],
    ['fixing', '修复中'],
    ['developing', '开发中'],
    ['disabled', '禁用中'],
  ] as const)(
    'combines developer %s with live enablement and loading failures',
    async (status, label) => {
      const f = mount(definition)
      try {
        f.state.items = [{ ...builtin, developmentStatus: status }, external]
        await nextTick()
        expect(f.root.textContent).toContain(`${label} · 已启用`)
        f.state.items = [{ ...builtin, developmentStatus: status, enabled: false }, external]
        await nextTick()
        expect(f.root.textContent).toContain(`${label} · 已停用`)
        f.state.items = [{ ...builtin, developmentStatus: status, status: { status: 'loading' } }]
        await nextTick()
        expect(f.root.textContent).toContain(`${label} · 正在加载`)
        f.state.items = [
          {
            ...builtin,
            developmentStatus: status,
            status: { status: 'error', error: createAppErrorState('conflict', '编辑器加载异常') },
          },
        ]
        await nextTick()
        expect(f.root.textContent).toContain(`${label} · 加载失败`)
        expect(f.root.textContent).toContain('编辑器加载异常')
        expect(f.actions.setEnabled).not.toHaveBeenCalled()
        expect(f.actions.retry).not.toHaveBeenCalled()
      } finally {
        f.unmount()
      }
    },
  )
  it('filters live counts and forwards only explicit management and import actions', async () => {
    const f = mount(definition)
    try {
      expect(f.actions.importPlugin).not.toHaveBeenCalled()
      expect(f.actions.manageExternal).not.toHaveBeenCalled()
      expect(button(f.root, '全部').textContent).toContain('2')
      dispatchCatalogEvent(button(f.root, '外置'), 'onClick')
      await nextTick()
      expect(f.root.textContent).not.toContain('标签管理')
      expect(f.root.textContent).toContain('org.example.catalog')
      if (definition === classic) {
        dispatchCatalogEvent(
          findCatalogElement(
            f.root,
            (node) =>
              node.tag === 'button' &&
              node.props['aria-label'] === '更多插件操作 org.example.catalog',
          ),
          'onClick',
        )
        await nextTick()
        expect(f.actions.manageExternal).not.toHaveBeenCalled()
      }
      dispatchCatalogEvent(button(f.root, '管理插件'), 'onClick')
      expect(f.actions.manageExternal).toHaveBeenCalledExactlyOnceWith('install-1')
      dispatchCatalogEvent(button(f.root, '导入'), 'onClick')
      expect(f.actions.importPlugin).toHaveBeenCalledOnce()
      f.state.items = [builtin]
      await nextTick()
      expect(button(f.root, '外置').textContent).toContain('0')
      expect(f.root.textContent).toContain('还没有外置插件')
      f.state.externalSupported = false
      await nextTick()
      expect(button(f.root, '导入').props.disabled).toBe(true)
      expect(f.root.textContent).toContain('当前运行端不支持外置插件')
    } finally {
      f.unmount()
    }
  })
  it('retains filter and display across theme replacement and forwards builtin changes', async () => {
    const f = mount(definition)
    try {
      dispatchCatalogEvent(button(f.root, '内置'), 'onClick')
      dispatchCatalogEvent(button(f.root, '展示方式'), 'onClick')
      await nextTick()
      dispatchCatalogEvent(button(f.root, '列表'), 'onClick')
      await nextTick()
      f.selection.value = definition === classic ? studio : classic
      await nextTick()
      expect(button(f.root, '内置').props['aria-pressed']).toBe(true)
      expect(
        findCatalogElement(f.root, (node) => node.props['data-display'] === 'list'),
      ).toBeDefined()
      const checkbox = findCatalogElement(f.root, (node) => node.props.type === 'checkbox')
      const input = { checked: false }
      ;(checkbox.props.onChange as (event: unknown) => void)({ target: input })
      expect(f.actions.setEnabled).toHaveBeenCalledExactlyOnceWith('feature.tags', false)
      expect(input.checked).toBe(true)
      expect(f.actions.importPlugin).not.toHaveBeenCalled()
      expect(f.actions.refresh).not.toHaveBeenCalled()
    } finally {
      f.unmount()
    }
  })
})
