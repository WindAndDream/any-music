import { provideCatalogFilterHistory, provideConfirmationDialog } from '@any-music/ui'
import type { CatalogDrawerListSummary, CatalogDrawerView } from '@any-music/ui'
import SessionBadge from '@any-music/ui/components/music-sources/SessionBadge.vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CatalogDrawerList from '../../../src/components/music-sources/CatalogDrawerList.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'
import { mountMeasuredThemeGrid } from '../../helpers/virtual-grid-renderer'

const helpTransition = vi.hoisted(() => ({ finish: undefined as (() => void) | undefined }))

// 执行真实列表、编辑器与操作器；仅替换浏览器弹层和转场宿主，不启动产品界面。
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_props, { slots }) =>
      () =>
        slots.default?.(),
  })
  const transition = vue.defineComponent({
    inheritAttrs: false,
    setup(_props, { slots, attrs }) {
      let wasOpen = false
      return () => {
        const children = slots.default?.()
        if (attrs.name === 'app-dialog') {
          const open = Boolean(children?.some((child) => child.type !== vue.Comment))
          if (wasOpen && !open) helpTransition.finish = attrs.onAfterLeave as () => void
          wasOpen = open
        }
        return children
      }
    },
  })
  return { ...vue, Transition: transition, Teleport: passthrough }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title', 'suspended'],
      inheritAttrs: false,
      setup:
        (props, { slots }) =>
        () =>
          props.open
            ? vue.h('section', { 'aria-label': props.title, inert: props.suspended || undefined }, [
                slots.default?.(),
                slots.footer?.(),
              ])
            : null,
    }),
  }
})
vi.mock('@any-music/ui/components/SidePanel.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      inheritAttrs: false,
      setup:
        (props, { slots }) =>
        () =>
          props.open ? vue.h('aside', { 'aria-label': props.title }, slots.default?.()) : null,
    }),
  }
})
beforeEach(() => {
  vi.stubGlobal('Element', CatalogTestElement)
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => {
  helpTransition.finish = undefined
  vi.unstubAllGlobals()
})

function createDrawer(id: string): CatalogDrawerView {
  return {
    id,
    title: id,
    input: id,
    kind: 'search',
    pluginId: 'test',
    pluginName: '测试源',
    createdAtMs: new Date(2026, 8, 30).getTime(),
    isExpanded: false,
    isSourceEnabled: true,
    tracks: [],
    loadedPageCount: 0,
    hasMore: false,
    isLoading: false,
    status: 'idle',
    errorMessage: '',
    invalidReason: '',
  }
}
function mountList(
  drawers: readonly CatalogDrawerView[],
  discoveryInHeader = false,
  columns = 3,
  initialScrollTop?: number,
) {
  const items = shallowRef(drawers)
  const filterOpen = shallowRef(true)
  const operatorOpen = shallowRef(false)
  const summary = shallowRef<CatalogDrawerListSummary>()
  const onRemoveMany = vi.fn()
  const onDiscover = vi.fn()
  const onRestoreNames = vi.fn()
  const onToggleAllVisible = vi.fn()
  const onMove = vi.fn()
  const list = shallowRef<{ focusDrawer(id: string): void }>()
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const host = defineComponent({
    props: ['scroll'],
    setup(props) {
      confirmation = provideConfirmationDialog()
      provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
      return () =>
        h(CatalogDrawerList, {
          ref: list,
          drawers: items.value,
          scrollElement: props.scroll,
          initialScrollTop,
          invalidTrackIds: new Set<string>(),
          discoveryLabel: '搜索与导入',
          discoveryInHeader,
          filterOpen: filterOpen.value,
          operatorOpen: operatorOpen.value,
          overlayTarget: new CatalogTestElement('overlay') as unknown as HTMLElement,
          operatorOverlayTarget: new CatalogTestElement('operator') as unknown as HTMLElement,
          onCloseFilter: () => {
            filterOpen.value = false
          },
          onCloseOperator: () => {
            operatorOpen.value = false
          },
          onSummaryChange: (next: CatalogDrawerListSummary) => {
            summary.value = next
          },
          onRemoveMany,
          onDiscover,
          onRestoreNames,
          onToggleAllVisible,
          onMove,
        })
    },
  })
  return {
    ...mountMeasuredThemeGrid(host, () => columns),
    filterOpen,
    operatorOpen,
    summary,
    onRemoveMany,
    onDiscover,
    onRestoreNames,
    onToggleAllVisible,
    items,
    onMove,
    focusDrawer: (id: string) => list.value?.focusDrawer(id),
    confirmation,
  }
}
function clickText(root: CatalogTestElement, text: string): void {
  dispatchCatalogEvent(
    findCatalogElement(root, (node) => node.tag === 'button' && node.textContent.includes(text)),
    'onClick',
  )
}

function dropBounds(left: number, width: number, top: number) {
  return { left, top, width, height: 100, right: left + width, bottom: top + 100 }
}

function motion(cell: CatalogTestElement) {
  return findCatalogElement(cell, (node) => node.hasAttribute('data-am-grid-motion'))
}

describe('CatalogDrawerList interactions', () => {
  it('restores the directory offset after mount and can focus an offscreen request', async () => {
    const view = mountList(
      Array.from({ length: 200 }, (_, index) => createDrawer(`request-${index}`)),
      false,
      3,
      8_000,
    )
    try {
      view.filterOpen.value = false
      await vi.dynamicImportSettled()
      await nextTick()
      expect(view.scroll.scrollTop).toBe(8_000)
      expect(view.root.querySelector('[data-catalog-drawer-id="request-180"]')).toBeNull()
      view.focusDrawer('request-180')
      await vi.waitFor(() =>
        expect(
          (view.document.activeElement as unknown as CatalogTestElement)?.dataset.catalogDrawerId,
        ).toBe('request-180'),
      )
      expect(view.onMove).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('windows long discovery lists while selection and state filters use all matches', async () => {
    const drawers = Array.from({ length: 200 }, (_, index) => createDrawer(`request-${index}`))
    drawers[199] = { ...drawers[199]!, status: 'disconnected', isSourceEnabled: false }
    const view = mountList(drawers)
    try {
      view.filterOpen.value = false
      view.operatorOpen.value = true
      await vi.dynamicImportSettled()
      await nextTick()
      const cards = () => view.root.querySelectorAll('[data-catalog-drawer-id]')
      const first = cards()[0]!
      expect(first.dataset.catalogDrawerId).toBe('request-0')
      expect(cards().length).toBeLessThan(30)
      expect(view.summary.value?.visibleCount).toBe(200)
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['aria-label'] === '全选当前 200 个匹配音乐列表',
        ),
        'onChange',
      )
      expect(view.onToggleAllVisible).toHaveBeenCalledWith(200)

      view.scroll.scrollTop = 8_000
      view.scroll.dispatchEvent(new Event('scroll'))
      await nextTick()
      expect(cards()).not.toContain(first)
      expect(cards().length).toBeLessThan(30)
      expect(view.summary.value?.selectedCount).toBe(200)
      view.scroll.scrollTop = 0
      view.scroll.dispatchEvent(new Event('scroll'))
      await nextTick()
      expect(cards()[0]?.dataset.catalogDrawerId).toBe('request-0')
      clickText(view.root, '不可用')
      await nextTick()
      expect(cards().map((card) => card.dataset.catalogDrawerId)).toEqual(['request-199'])
      expect(view.summary.value?.visibleCount).toBe(1)
    } finally {
      view.unmount()
    }
  })

  it.each([
    ['same row forward', 3, 'a', 'c', ['b', 'c', 'a']],
    ['same row backward', 3, 'c', 'a', ['c', 'a', 'b']],
    ['across rows forward', 2, 'a', 'c', ['b', 'c', 'a']],
    ['across rows backward', 2, 'c', 'a', ['c', 'a', 'b']],
  ] as const)(
    'hands the real cards and their neighbors through a committed drop: %s',
    async (_label, columns, source, target, order) => {
      vi.useFakeTimers()
      vi.stubGlobal(
        'ShadowRoot',
        class {
          host = null
        },
      )
      vi.stubGlobal('window', Object.assign(new EventTarget(), { innerHeight: 600 }))
      vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '340ms' }))
      const frames = new Map<number, FrameRequestCallback>()
      let frameId = 0
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++frameId, callback)
        return frameId
      })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
      const view = mountList(['a', 'b', 'c'].map(createDrawer), false, columns)
      try {
        view.filterOpen.value = false
        await vi.dynamicImportSettled()
        await nextTick()
        const grid = findCatalogElement(
          view.root,
          (node) => node.props.role === 'list' && node.props['data-grid-layout'] === 'collection',
        )
        const height = Math.ceil(3 / columns) * 112 - 12
        Object.assign(grid, {
          getBoundingClientRect: () => ({
            ...dropBounds(0, 1000, 24),
            height,
            bottom: 24 + height,
          }),
        })
        const rows = () => grid.querySelectorAll('[data-catalog-drop-kind="drawer"]')
        const width = (1000 - (columns - 1) * 12) / columns
        const boundsAt = (index: number) =>
          dropBounds(
            (index % columns) * (width + 12),
            width,
            24 + Math.floor(index / columns) * 112,
          )
        for (const row of rows()) {
          Object.assign(row, {
            getBoundingClientRect: () => boundsAt(rows().indexOf(row)),
          })
          Object.assign(motion(row), { getBoundingClientRect: () => boundsAt(rows().indexOf(row)) })
        }
        const row = rows().find((node) => node.dataset.catalogDropId === source)!
        const neighbors = rows().filter((node) => node !== row)
        const card = findCatalogElement(
          row,
          (node) => node.props['data-catalog-drawer-id'] === source,
        )
        view.onMove.mockImplementation(() => {
          view.items.value = order.map((id) => view.items.value.find((item) => item.id === id)!)
        })
        const pointer = (id: string, offset = 0) => ({
          button: 0,
          pointerId: 1,
          isPrimary: true,
          clientX: boundsAt(['a', 'b', 'c'].indexOf(id)).left + 60 + offset,
          clientY: boundsAt(['a', 'b', 'c'].indexOf(id)).top + 50,
          target: card,
          currentTarget: card,
          preventDefault() {},
        })
        ;(card.props.onPointerdown as (event: unknown) => void)(pointer(source))
        vi.advanceTimersByTime(500)
        await nextTick()
        grid.dispatchListeners('pointerup', pointer(target, 15))
        await nextTick()
        await nextTick()
        expect(view.onMove).toHaveBeenCalledExactlyOnceWith(source, target, ['a', 'b', 'c'])
        expect(rows()[order.indexOf(source)]).toBe(row)
        expect(
          findCatalogElement(row, (node) => node.props['data-catalog-drawer-id'] === source),
        ).toBe(card)
        expect(row.getAttribute('data-am-grid-landing')).toBe('')
        expect(motion(row).props.style).toMatchObject({
          transform: expect.stringContaining('translate3d('),
          transition: 'none',
          contentVisibility: 'visible',
        })
        for (const neighbor of neighbors) {
          expect(neighbor.getAttribute('data-am-grid-settling')).toBe('')
          expect(neighbor.getAttribute('data-am-grid-landing')).toBeNull()
          expect(motion(neighbor).props.style).toMatchObject({
            transition: 'none',
            contentVisibility: 'visible',
          })
        }
        const callbacks = [...frames.values()]
        frames.clear()
        callbacks.forEach((callback) => callback(16))
        await nextTick()
        expect(motion(row).props.style).toEqual({ contentVisibility: 'visible' })
        expect(row.getAttribute('data-am-grid-landing')).toBe('')
        vi.advanceTimersByTime(340)
        await nextTick()
        expect(row.getAttribute('data-am-grid-landing')).toBeNull()
        expect(motion(row).props.style).toBeUndefined()
        for (const neighbor of neighbors) {
          expect(neighbor.getAttribute('data-am-grid-settling')).toBeNull()
          expect(motion(neighbor).props.style).toBeUndefined()
        }
      } finally {
        view.unmount()
        vi.useRealTimers()
      }
    },
  )

  it('reports operator select-all and deselect-all separately from card selection', async () => {
    const view = mountList([createDrawer('first'), createDrawer('second')])
    view.filterOpen.value = false
    view.operatorOpen.value = true
    await vi.dynamicImportSettled()
    await nextTick()
    const toggleAll = () =>
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['aria-label'] === '全选当前 2 个匹配音乐列表',
        ),
        'onChange',
      )
    toggleAll()
    await nextTick()
    toggleAll()
    await nextTick()
    expect(view.onToggleAllVisible.mock.calls).toEqual([[2], [0]])
    expect(view.summary.value?.selectedCount).toBe(0)
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '选择音乐列表 first'),
      'onChange',
    )
    await nextTick()
    expect(view.onToggleAllVisible).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('shows restore only when a renamed list is selected and restores only named selections', async () => {
    const view = mountList([
      { ...createDrawer('named'), isCustomNamed: true },
      createDrawer('original'),
    ])
    view.filterOpen.value = false
    view.operatorOpen.value = true
    await vi.dynamicImportSettled()
    await nextTick()
    const operator = findCatalogElement(view.root, (node) => node.tag === 'aside')
    expect(operator.textContent).not.toContain('恢复原名')
    const select = (id: string) =>
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === `选择音乐列表 ${id}`),
        'onChange',
      )
    select('original')
    await nextTick()
    expect(operator.textContent).not.toContain('恢复原名')
    select('named')
    await nextTick()
    expect(operator.textContent).toContain('恢复原名')
    clickText(operator, '恢复原名')
    expect(view.onRestoreNames).toHaveBeenCalledExactlyOnceWith(['named'])
    await nextTick()
    expect(operator.textContent).not.toContain('恢复原名')
    view.unmount()
  })
  it('keeps the desktop list title with discovery in the header and only collection actions in the operator', async () => {
    const view = mountList([], true)
    view.filterOpen.value = false
    view.operatorOpen.value = true
    await nextTick()
    const heading = findCatalogElement(
      view.root,
      (node) => node.props.class === 'catalog-drawers__header',
    )
    expect(
      findCatalogElement(heading, (node) => node.tag === 'h2')
        .textContent.replace(/\s+/g, ' ')
        .trim(),
    ).toBe('发现 0 个')
    expect(view.root.textContent).not.toContain('你的发现')
    const button = findCatalogElement(
      heading,
      (node) => node.tag === 'button' && node.textContent.includes('搜索与导入'),
    )
    const operator = findCatalogElement(view.root, (node) => node.tag === 'aside')
    expect(operator.textContent).toContain('删除已选列表')
    expect(operator.textContent).not.toContain('搜索与导入')
    expect(view.root.textContent).toContain('点击顶部的')
    dispatchCatalogEvent(button, 'onClick')
    expect(view.onDiscover).toHaveBeenCalledOnce()
    expect(view.operatorOpen.value).toBe(false)
    view.unmount()
  })

  it('shows separate unavailable and error counts and filters disconnected source cards', async () => {
    const view = mountList([
      createDrawer('available'),
      { ...createDrawer('disabled'), status: 'disconnected', isSourceEnabled: false },
      { ...createDrawer('removed'), status: 'missing', isSourceEnabled: false },
      { ...createDrawer('failed'), status: 'error' },
    ])
    const states = findCatalogElement(
      view.root,
      (node) => node.props['aria-label'] === '音乐列表状态筛选',
    )
    expect(states.textContent).toContain('全部 4')
    expect(states.textContent).toContain('可用 1')
    expect(states.textContent).toContain('不可用 2')
    expect(states.textContent).toContain('错误 1')
    expect(states.textContent).not.toContain('错误处理')
    const visibleIds = () =>
      view.root
        .querySelectorAll('[data-catalog-drawer-id]')
        .map((card) => card.dataset.catalogDrawerId)
    clickText(states, '不可用')
    await vi.dynamicImportSettled()
    await nextTick()
    expect(visibleIds()).toEqual(['disabled', 'removed'])
    expect(view.summary.value?.visibleCount).toBe(2)
    clickText(states, '错误')
    await nextTick()
    expect(visibleIds()).toEqual(['failed'])
    clickText(states, '可用 1')
    await nextTick()
    expect(visibleIds()).toEqual(['available'])
    clickText(states, '全部')
    await nextTick()
    expect(visibleIds()).toEqual(['available', 'disabled', 'removed', 'failed'])
    view.unmount()
  })

  it('replaces the mobile list heading with the account and keeps discovery beside it', () => {
    const onDiscover = vi.fn()
    const onRefresh = vi.fn()
    const host = defineComponent({
      setup() {
        provideConfirmationDialog()
        provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
        return () =>
          h(
            CatalogDrawerList,
            {
              drawers: [],
              invalidTrackIds: new Set<string>(),
              discoveryLabel: '搜索与导入',
              discoveryInHeader: true,
              operatorOpen: true,
              operatorOverlayTarget: new CatalogTestElement('operator') as unknown as HTMLElement,
              onDiscover,
            },
            {
              session: () =>
                h(SessionBadge, {
                  compact: true,
                  prominent: true,
                  session: { status: 'signed-in', user: { id: '1', name: '音乐爱好者' } },
                  refreshing: false,
                  onRefresh,
                }),
            },
          )
      },
    })
    const view = mountCatalogComponent(host, {})
    const heading = findCatalogElement(
      view.root,
      (node) => node.props.class === 'catalog-drawers__header',
    )
    expect(heading.textContent).not.toContain('音乐列表')
    expect(heading.textContent).toContain('音乐爱好者')
    const button = findCatalogElement(
      heading,
      (node) => node.tag === 'button' && node.textContent.includes('搜索与导入'),
    )
    expect(button.textContent).toContain('搜索与导入')
    expect(view.root.textContent).toContain('音乐爱好者')
    expect(heading.textContent).not.toContain('已登录')
    expect(view.root.textContent).not.toContain('你的发现')
    const operator = findCatalogElement(view.root, (node) => node.tag === 'aside')
    expect(operator.textContent).toContain('删除已选列表')
    expect(operator.textContent).not.toContain('搜索与导入')
    expect(view.root.textContent).toContain('点击顶部的')
    dispatchCatalogEvent(button, 'onClick')
    expect(onDiscover).toHaveBeenCalledOnce()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '刷新平台用户状态'),
      'onClick',
    )
    expect(onRefresh).toHaveBeenCalledOnce()
    view.unmount()
  })

  it.each([
    ['文本筛选', '列表名称、搜索词、链接或来源。'],
    ['平台筛选', '未选择时显示全部平台；选择多个平台时匹配其中任意一个。'],
    ['命名筛选', '按是否设置自定义名称筛选。'],
    ['搜索时间', '按搜索或导入的创建日期筛选，支持多个日期区间。'],
  ])(
    'opens a modal for %s and restores the filter sheet after Escape',
    async (label, description) => {
      const keyboard = new EventTarget()
      vi.stubGlobal('window', keyboard)
      const view = mountList([createDrawer('晨间')])
      clickText(view.root, label)
      await nextTick()
      expect(view.root.textContent).not.toContain(description.slice(0, -1))

      const help = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === `${label}说明`,
      )
      expect(help.props['aria-haspopup']).toBe('dialog')
      dispatchCatalogEvent(help, 'onClick', false)
      await nextTick()
      const sheet = findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '音乐列表筛选器',
      )
      const dialog = findCatalogElement(view.root, (node) => node.props.role === 'dialog')
      expect(dialog.props['aria-modal']).toBe('true')
      expect(dialog.textContent).toContain(`${label}说明`)
      expect(dialog.textContent).toContain(description)
      expect(sheet.props.inert).toBe(true)

      const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
      keyboard.dispatchEvent(escape)
      await nextTick()
      expect(escape.defaultPrevented).toBe(true)
      expect(view.root.textContent).not.toContain(description)
      expect(sheet.props.inert).toBe(true)
      expect(helpTransition.finish).toBeDefined()
      helpTransition.finish?.()
      await nextTick()
      expect(sheet.props.inert).toBeUndefined()
      expect(view.filterOpen.value).toBe(true)
      view.unmount()
    },
  )

  it('shows a text hint in the platform filter until a platform is available', async () => {
    const view = mountList([])
    clickText(view.root, '平台筛选')
    await nextTick()

    expect(view.root.textContent).toContain('当前无任何平台')

    view.items.value = [createDrawer('晨间')]
    await nextTick()
    expect(view.root.textContent).not.toContain('当前无任何平台')
    const platform = findCatalogElement(
      view.root,
      (node) => node.tag === 'label' && node.textContent.includes('测试源'),
    )
    expect(findCatalogElement(platform, (node) => node.tag === 'input').props.type).toBe('checkbox')
    view.unmount()
  })

  it('shows only list dimensions, previews text and cancels or applies the complete draft', async () => {
    const view = mountList([createDrawer('晨间'), createDrawer('夜曲')])
    expect(view.root.textContent).toContain('文本筛选')
    expect(view.root.textContent).toContain('搜索时间')
    expect(view.root.textContent).not.toContain('标签筛选')
    expect(view.root.textContent).not.toContain('歌曲时长')
    expect(view.root.textContent).toContain('2 / 2 个列表')
    clickText(view.root, '文本筛选')
    await nextTick()
    const input = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.type === 'search',
    )
    expect(input.props.placeholder).toBe('输入列表名称、搜索词、链接或来源')
    expect(input.props['aria-label']).toBe('搜索音乐列表')
    input.value = '无对应列表'
    input.dispatchListeners('input', { target: input })
    await nextTick()
    expect(view.summary.value?.visibleCount).toBe(2)
    clickText(view.root, '确定')
    await nextTick()
    const summary = findCatalogElement(view.root, (node) => node.props['aria-label'] === '筛选条件')
    expect(summary.textContent).toContain('无对应列表')
    expect(summary.textContent).not.toContain('匹配的音乐列表')
    expect(summary.textContent).not.toContain('没有匹配结果')
    const cancel = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent === '取消',
    )
    const apply = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent.trim() === '应用筛选',
    )
    expect(cancel.parent).toBe(apply.parent)
    const footer = findCatalogElement(
      view.root,
      (node) => node.props.class === 'classic-filter-footer',
    )
    const status = findCatalogElement(footer, (node) => node.props.role === 'status')
    expect(status.textContent).toBe('匹配 0 / 2 个列表')
    expect(findCatalogElement(status, (node) => node.tag === 'strong').textContent).toBe(
      '0 / 2 个列表',
    )
    clickText(view.root, '取消')
    await nextTick()
    expect(view.summary.value?.filterCount).toBe(0)
    view.filterOpen.value = true
    await nextTick()
    clickText(view.root, '文本筛选')
    await nextTick()
    const nextInput = findCatalogElement(
      view.root,
      (node) => node.tag === 'input' && node.props.type === 'search',
    )
    expect(nextInput.value).toBe('')
    nextInput.value = '夜曲'
    nextInput.dispatchListeners('input', { target: nextInput })
    await nextTick()
    clickText(view.root, '确定')
    await nextTick()
    clickText(view.root, '应用筛选')
    await nextTick()
    expect(view.summary.value).toEqual({
      selectedCount: 0,
      visibleCount: 1,
      totalCount: 2,
      filterCount: 1,
    })
    view.operatorOpen.value = true
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '全选当前 1 个匹配音乐列表',
      ),
      'onChange',
    )
    await nextTick()
    expect(view.summary.value?.selectedCount).toBe(1)
    clickText(view.root, '删除已选列表')
    expect(view.onRemoveMany).not.toHaveBeenCalled()
    view.confirmation.accept()
    await nextTick()
    expect(view.onRemoveMany).toHaveBeenCalledExactlyOnceWith(['夜曲'])
    view.unmount()
  })

  it('keeps discovery available for empty lists and closes the operator before opening it', async () => {
    const view = mountList([])
    view.filterOpen.value = false
    view.operatorOpen.value = true
    await nextTick()
    expect(view.root.textContent).toContain('还没有音乐列表')
    const checkbox = findCatalogElement(view.root, (node) => node.tag === 'input')
    expect(checkbox.props.disabled).toBe(true)
    const remove = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent.includes('删除已选列表'),
    )
    expect(remove.props.disabled).toBe(true)
    clickText(view.root, '搜索与导入')
    expect(view.onDiscover).toHaveBeenCalledOnce()
    expect(view.operatorOpen.value).toBe(false)
    view.unmount()
  })
})
