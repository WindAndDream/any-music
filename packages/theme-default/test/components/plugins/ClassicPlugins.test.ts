import { createAppErrorState } from '@any-music/core'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import ClassicPlugins from '../../../src/components/plugins/ClassicPlugins.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'
import type { CatalogTestElement } from '../../helpers/test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_props, { slots, attrs }) =>
        () =>
          vue.h(
            'transition-stub',
            attrs.name === 'catalog-filter-fade'
              ? { 'data-filter-transition': '', onAfterLeave: attrs.onAfterLeave }
              : {},
            slots.default?.(),
          ),
    }),
  }
})

vi.mock('@any-music/ui/components/BottomSheet.vue', () => ({
  default: defineComponent({
    props: ['open', 'title'],
    setup:
      (props, { slots, emit }) =>
      () =>
        props.open
          ? h('section', { 'aria-label': props.title }, [
              h('button', { 'aria-label': '关闭筛选', onClick: () => emit('close') }, '关闭'),
              slots.default?.(),
              slots.footer?.(),
            ])
          : null,
  }),
}))
vi.mock('@any-music/ui/components/SidePanel.vue', () => ({
  default: defineComponent({
    props: ['open', 'title'],
    setup:
      (props, { slots, emit }) =>
      () =>
        props.open
          ? h('section', { 'aria-label': props.title }, [
              h('button', { 'aria-label': '关闭操作器', onClick: () => emit('close') }, '关闭'),
              slots.default?.(),
            ])
          : null,
  }),
}))
vi.mock('@any-music/ui/components/AppDialog.vue', () => ({
  default: defineComponent({
    props: ['open', 'title'],
    setup:
      (props, { slots, emit }) =>
      () =>
        props.open
          ? h('dialog', { 'aria-label': props.title }, [
              h('button', { 'aria-label': '关闭介绍', onClick: () => emit('close') }, '关闭介绍'),
              slots.default?.(),
              slots.footer?.(),
            ])
          : null,
  }),
}))

function createFeature(externalSupported = true): UiThemeFeatureMap['plugins'] {
  return {
    state: {
      externalSupported,
      busy: false,
      items: [
        {
          id: 'source',
          name: '哔哩哔哩',
          description: '发现音乐',
          origin: 'builtin',
          category: '音乐源',
          enabled: true,
          status: { status: 'ready' },
        },
        {
          id: 'tags',
          name: '标签管理',
          description: '整理音乐',
          origin: 'builtin',
          category: '资料整理',
          enabled: false,
          status: { status: 'error', error: createAppErrorState('conflict', '加载失败') },
        },
        {
          id: 'external',
          name: '外置目录',
          description: '扩展目录',
          publisher: 'Example',
          generation: 3,
          origin: 'external',
          category: '音乐源',
          enabled: true,
          status: { status: 'ready' },
        },
      ],
    },
    actions: {
      setEnabled: vi.fn(),
      retry: vi.fn(),
      importPlugin: vi.fn(),
      manageExternal: vi.fn(),
      refresh: vi.fn(),
    },
    availability: { status: 'available' },
    status: { status: 'ready' },
  }
}
function button(root: CatalogTestElement, text: string): CatalogTestElement {
  return findCatalogElement(
    root,
    (node) => node.tag === 'button' && node.textContent.trim() === text,
  )
}
async function click(root: CatalogTestElement, text: string): Promise<void> {
  dispatchCatalogEvent(button(root, text), 'onClick')
  await nextTick()
  await completeFilterLeave(root)
}
async function completeFilterLeave(root: CatalogTestElement): Promise<void> {
  const transition = root.querySelector('[data-filter-transition]')
  if (transition) dispatchCatalogEvent(transition, 'onAfterLeave')
  await nextTick()
}
function change(root: CatalogTestElement, label: string, value: string, event = 'onChange'): void {
  const input = findCatalogElement(root, (node) => node.props['aria-label'] === label)
  input.value = value
  dispatchCatalogEvent(input, event)
}
async function edit(root: CatalogTestElement, dimension: string): Promise<void> {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.props['data-filter-dimension'] === dimension),
    'onClick',
  )
  await nextTick()
  await completeFilterLeave(root)
}
async function choose(root: CatalogTestElement, value: string): Promise<void> {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.tag === 'input' && node.props.value === value),
    'onChange',
  )
  await nextTick()
}
async function activate(root: CatalogTestElement, label: string): Promise<void> {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.tag === 'button' && node.props['aria-label'] === label),
    'onClick',
  )
  await nextTick()
}

describe('classic plugin collection controls', () => {
  it('combines developer maintenance filters with user enablement and shows both in introductions', async () => {
    const initial = createFeature()
    const feature: UiThemeFeatureMap['plugins'] = {
      ...initial,
      state: {
        ...initial.state,
        items: initial.state.items.map((item) =>
          item.id === 'source'
            ? Object.assign({}, item, { developmentStatus: 'developing' as const })
            : item,
        ),
      },
    }
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature })
    try {
      await click(root, '筛选器')
      await edit(root, 'developmentStatus')
      await choose(root, 'developing')
      expect(root.textContent).toContain('匹配 1 / 3 个插件')
      await click(root, '确定')
      await edit(root, 'status')
      await choose(root, 'disabled')
      expect(root.textContent).toContain('匹配 0 / 3 个插件')
      await click(root, '返回')
      await click(root, '应用筛选')
      expect(root.textContent).toContain('开发中 · 已启用')
      expect(root.textContent).not.toContain('外置目录')
      await activate(root, '查看插件介绍 哔哩哔哩')
      const dialog = findCatalogElement(root, (node) => node.tag === 'dialog')
      expect(dialog.textContent).toContain('开发者状态开发中')
      expect(dialog.textContent).toContain('运行状态已启用')
      expect(feature.actions.setEnabled).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
  it('shows source counts, category tabs, the shared toolbar and the host import action', async () => {
    const feature = createFeature()
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature })
    const heading = findCatalogElement(root, (node) => node.tag === 'h2')
    expect(heading.textContent).toContain('内置 2 个·外置 1 个')
    expect(root.textContent).toContain('已选 0 · 共 3')
    expect(button(root, '筛选器')).toBeDefined()
    await click(root, '导入')
    expect(feature.actions.importPlugin).toHaveBeenCalledTimes(1)
    await click(root, '外置 1')
    expect(root.textContent).not.toContain('标签管理')
    expect(root.textContent).toContain('外置目录')
    unmount()
  })

  it('previews draft filters, cancels without applying and combines keyword, category and status', async () => {
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature: createFeature() })
    await click(root, '筛选器')
    await edit(root, 'keyword')
    change(root, '筛选插件关键词', '标签', 'onInput')
    await nextTick()
    expect(root.textContent).toContain('匹配 1 / 3 个插件')
    await click(root, '确定')
    await click(root, '取消')
    expect(root.textContent).toContain('外置目录')
    await click(root, '筛选器')
    await edit(root, 'keyword')
    change(root, '筛选插件关键词', '整理', 'onInput')
    await nextTick()
    await click(root, '确定')
    await edit(root, 'category')
    await choose(root, '资料整理')
    await click(root, '确定')
    await edit(root, 'status')
    await choose(root, 'error')
    await click(root, '确定')
    await click(root, '应用筛选')
    expect(root.textContent).toContain('标签管理')
    expect(root.textContent).not.toContain('外置目录')
    expect(root.textContent).toContain('已选 0 · 共 1')
    await click(root, '筛选器')
    await click(root, '清空全部')
    await click(root, '应用筛选')
    expect(root.textContent).toContain('外置目录')
    unmount()
  })

  it('discards unfinished dimension edits on Back and can remove one committed draft condition', async () => {
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature: createFeature() })
    await click(root, '筛选器')
    await edit(root, 'keyword')
    change(root, '筛选插件关键词', '标签', 'onInput')
    await nextTick()
    await click(root, '确定')
    await edit(root, 'status')
    await choose(root, 'enabled')
    expect(root.textContent).toContain('匹配 0 / 3 个插件')
    await click(root, '返回')
    expect(root.textContent).toContain('匹配 1 / 3 个插件')
    await activate(root, '删除关键词条件 标签')
    expect(root.textContent).toContain('全部插件')
    await click(root, '应用筛选')
    expect(root.textContent).toContain('外置目录')
    unmount()
  })

  it.each([
    {
      dimension: 'category',
      first: '音乐源',
      second: '资料整理',
      firstCount: 2,
      combinedCount: 3,
      remainingCount: 1,
      removeLabel: '删除插件类型条件 音乐源',
    },
    {
      dimension: 'status',
      first: 'enabled',
      second: 'disabled',
      firstCount: 2,
      combinedCount: 3,
      remainingCount: 1,
      removeLabel: '删除插件状态条件 已启用',
    },
    {
      dimension: 'developmentStatus',
      first: 'stable',
      second: 'developing',
      firstCount: 1,
      combinedCount: 2,
      remainingCount: 1,
      removeLabel: '删除开发者状态条件 正常',
    },
  ])(
    'unions $dimension choices, removes only one condition and restores All',
    async ({
      dimension,
      first,
      second,
      firstCount,
      combinedCount,
      remainingCount,
      removeLabel,
    }) => {
      const feature = createFeature()
      const { root, unmount } = mountCatalogComponent(ClassicPlugins, {
        feature: {
          ...feature,
          state: {
            ...feature.state,
            items: feature.state.items.map((item) =>
              item.id === 'source'
                ? Object.assign({}, item, { developmentStatus: 'developing' })
                : item,
            ),
          },
        },
      })
      try {
        await click(root, '筛选器')
        await edit(root, dimension)
        const option = (value: string) =>
          findCatalogElement(root, (node) => node.tag === 'input' && node.props.value === value)
        expect(option('all').props).toMatchObject({ type: 'radio', checked: true })
        expect(option(first).props.type).toBe('checkbox')
        await choose(root, first)
        expect(root.textContent).toContain(`匹配 ${firstCount} / 3 个插件`)
        expect(option('all').props.checked).toBe(false)
        await choose(root, second)
        expect(option(first).props.checked).toBe(true)
        expect(option(second).props.checked).toBe(true)
        expect(root.textContent).toContain(`匹配 ${combinedCount} / 3 个插件`)
        await click(root, '确定')
        await activate(root, removeLabel)
        expect(root.textContent).toContain(`匹配 ${remainingCount} / 3 个插件`)
        await edit(root, dimension)
        expect(option(first).props.checked).toBe(false)
        expect(option(second).props.checked).toBe(true)
        await choose(root, second)
        expect(option('all').props.checked).toBe(true)
        expect(root.textContent).toContain('匹配 3 / 3 个插件')
        await choose(root, first)
        await choose(root, 'all')
        expect(option(first).props.checked).toBe(false)
        expect(option(second).props.checked).toBe(false)
        expect(root.textContent).toContain('匹配 3 / 3 个插件')
        await click(root, '返回')
        expect(root.textContent).toContain(`匹配 ${remainingCount} / 3 个插件`)
        await click(root, '应用筛选')
        expect(root.textContent).toContain(`已选 0 · 共 ${remainingCount}`)
        await click(root, '筛选器')
        await edit(root, dimension)
        expect(option(second).props.checked).toBe(true)
        await choose(root, 'all')
        await click(root, '确定')
        await click(root, '取消')
        expect(root.textContent).toContain(`已选 0 · 共 ${remainingCount}`)
      } finally {
        unmount()
      }
    },
  )

  it.each(['返回', '确定'])(
    'waits for the outgoing filter view before changing footer space on %s',
    async (action) => {
      const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature: createFeature() })
      try {
        await click(root, '筛选器')
        dispatchCatalogEvent(
          findCatalogElement(root, (node) => node.props['data-filter-dimension'] === 'keyword'),
          'onClick',
        )
        await nextTick()
        expect(root.textContent).toContain('应用筛选')
        await completeFilterLeave(root)
        expect(root.textContent).not.toContain('应用筛选')
        dispatchCatalogEvent(button(root, action), 'onClick')
        await nextTick()
        expect(root.textContent).not.toContain('应用筛选')
        await completeFilterLeave(root)
        expect(root.textContent).toContain('应用筛选')
        // A closed sheet starts in the overview even if its detail transition never completed.
        await edit(root, 'status')
        await activate(root, '关闭筛选')
        await click(root, '筛选器')
        expect(root.textContent).toContain('应用筛选')
        expect(root.textContent).toContain('全部插件')
      } finally {
        unmount()
      }
    },
  )

  it('opens introductions from the card and its three-dot control, forwarding only explicit actions', async () => {
    const feature = createFeature()
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature })
    await activate(root, '查看插件介绍 哔哩哔哩')
    expect(findCatalogElement(root, (node) => node.tag === 'dialog').textContent).toContain(
      '发现音乐',
    )
    expect(feature.actions.setEnabled).not.toHaveBeenCalled()
    await click(root, '停用插件')
    expect(feature.actions.setEnabled).toHaveBeenCalledExactlyOnceWith('source', false)
    await click(root, '关闭介绍')
    await activate(root, '更多插件操作 外置目录')
    const details = findCatalogElement(root, (node) => node.tag === 'dialog')
    expect(details.textContent).toContain('外置插件')
    expect(details.textContent).toContain('发布者Example')
    expect(details.textContent).toContain('代次3')
    expect(feature.actions.manageExternal).not.toHaveBeenCalled()
    await click(root, '管理插件')
    expect(feature.actions.manageExternal).toHaveBeenCalledExactlyOnceWith('external')
    expect(root.textContent).not.toContain('关闭介绍')
    unmount()
  })

  it('keeps selection separate from introductions and preserves it while inspecting plugin actions', async () => {
    const feature = createFeature()
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature })
    await click(root, '操作器')
    await activate(root, '选择插件 标签管理')
    expect(root.textContent).toContain('已选 1 · 共 3')
    expect(root.textContent).not.toContain('关闭介绍')
    await activate(root, '更多插件操作 标签管理')
    expect(findCatalogElement(root, (node) => node.tag === 'dialog').textContent).toContain(
      '加载失败',
    )
    await click(root, '重试加载')
    expect(feature.actions.retry).toHaveBeenCalledExactlyOnceWith('tags')
    await click(root, '关闭介绍')
    expect(root.textContent).toContain('已选 1 · 共 3')
    dispatchCatalogEvent(
      findCatalogElement(root, (node) => node.props['aria-label'] === '勾选插件 标签管理'),
      'onChange',
    )
    await nextTick()
    expect(root.textContent).toContain('已选 0 · 共 3')
    unmount()
  })

  it('updates an open introduction from host snapshots and closes when the plugin disappears', async () => {
    const feature = shallowRef(createFeature())
    const host = defineComponent({
      setup: () => () => h(ClassicPlugins, { feature: feature.value }),
    })
    const { root, unmount } = mountCatalogComponent(host, {})
    await activate(root, '查看插件介绍 外置目录')
    const original = feature.value
    feature.value = {
      ...original,
      state: {
        ...original.state,
        items: original.state.items.map((item) => ({ ...item, enabled: false })),
      },
    }
    await nextTick()
    expect(findCatalogElement(root, (node) => node.tag === 'dialog').textContent).toContain(
      '已撤销',
    )
    feature.value = { ...original, state: { ...original.state, items: [] } }
    await nextTick()
    expect(root.textContent).not.toContain('关闭介绍')
    feature.value = original
    await nextTick()
    expect(root.textContent).not.toContain('关闭介绍')
    unmount()
  })

  it('switches plugin presentation through the shared bottom toolbar', async () => {
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature: createFeature() })
    await click(root, '展示方式')
    const list = findCatalogElement(
      root,
      (node) => node.tag === 'button' && node.textContent.startsWith('列表'),
    )
    dispatchCatalogEvent(list, 'onClick')
    await nextTick()
    expect(findCatalogElement(root, (node) => node.props['data-display'] === 'list')).toBeDefined()
    unmount()
  })

  it('changes only selected built-ins through named host actions', async () => {
    const feature = createFeature()
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature })
    await click(root, '操作器')
    const all = findCatalogElement(
      root,
      (node) => node.props['aria-label'] === '全选当前 3 个匹配插件',
    )
    dispatchCatalogEvent(all, 'onChange')
    await nextTick()
    expect(root.textContent).toContain('已选 3 · 共 3')
    await click(root, '启用内置插件启用')
    expect(feature.actions.setEnabled).toHaveBeenCalledWith('tags', true)
    expect(feature.actions.setEnabled).toHaveBeenCalledTimes(1)
    await click(root, '停用内置插件停用')
    expect(feature.actions.setEnabled).toHaveBeenCalledWith('source', false)
    expect(feature.actions.setEnabled).toHaveBeenCalledTimes(2)
    await click(root, '刷新外置插件刷新')
    expect(feature.actions.refresh).toHaveBeenCalledTimes(1)
    await click(root, '关闭')
    expect(root.textContent).toContain('已选 0 · 共 3')
    unmount()
  })

  it('limits select-all to the visible category and removes hidden selections', async () => {
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature: createFeature() })
    await click(root, '内置 2')
    await click(root, '操作器')
    dispatchCatalogEvent(
      findCatalogElement(root, (node) => node.props['aria-label'] === '全选当前 2 个匹配插件'),
      'onChange',
    )
    await nextTick()
    expect(root.textContent).toContain('已选 2 · 共 2')
    await click(root, '外置 1')
    expect(root.textContent).toContain('已选 0 · 共 1')
    expect(button(root, '停用内置插件停用').props.disabled).toBe(true)
    unmount()
  })

  it('serializes batch requests, prevents duplicate submission and stops on presentation disposal', async () => {
    const initial = createFeature()
    const feature = {
      ...initial,
      state: {
        ...initial.state,
        items: initial.state.items.map((item) => Object.assign({}, item, { enabled: true })),
      },
    }
    let complete!: () => void
    const pending = new Promise<void>((resolve) => {
      complete = resolve
    })
    vi.mocked(feature.actions.setEnabled).mockReturnValue(pending)
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature })
    await click(root, '操作器')
    dispatchCatalogEvent(
      findCatalogElement(root, (node) => node.props['aria-label'] === '全选当前 3 个匹配插件'),
      'onChange',
    )
    await nextTick()
    await click(root, '停用内置插件停用')
    expect(feature.actions.setEnabled).toHaveBeenCalledExactlyOnceWith('source', false)
    expect(button(root, '停用内置插件停用').props.disabled).toBe(true)
    await click(root, '停用内置插件停用')
    expect(feature.actions.setEnabled).toHaveBeenCalledTimes(1)
    unmount()
    complete()
    await pending
    await nextTick()
    expect(feature.actions.setEnabled).toHaveBeenCalledTimes(1)
  })

  it('keeps external installation unavailable on runtimes that do not support it', async () => {
    const feature = createFeature(false)
    const { root, unmount } = mountCatalogComponent(ClassicPlugins, { feature })
    expect(button(root, '导入').props.disabled).toBe(true)
    await click(root, '外置 1')
    expect(root.textContent).toContain('当前运行端不支持外置插件')
    unmount()
  })
})
