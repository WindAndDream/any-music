import type { CatalogDrawerView } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CatalogDrawerCard from '../../../src/components/music-sources/CatalogDrawerCard.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const drawer: CatalogDrawerView = {
  id: 'drawer:1',
  pluginId: 'test',
  pluginName: '测试平台',
  kind: 'search',
  input: '华语',
  title: '华语搜索',
  isExpanded: false,
  isSourceEnabled: true,
  loadedPageCount: 1,
  tracks: [],
  hasMore: true,
  isLoading: false,
  status: 'ready',
  errorMessage: '',
  invalidReason: '',
}

beforeEach(() => vi.stubGlobal('Element', CatalogTestElement))
afterEach(() => vi.unstubAllGlobals())

describe('CatalogDrawerCard selection and actions', () => {
  it('keeps default cards unselectable while hold and keyboard ordering remain available', () => {
    const onSelect = vi.fn(),
      onPressStart = vi.fn(),
      onShift = vi.fn()
    const view = mountCatalogComponent(CatalogDrawerCard, {
      drawer,
      selected: false,
      onSelect,
      onPressStart,
      onShift,
    })
    try {
      const card = findCatalogElement(view.root, (node) => node.tag === 'article')
      expect(() => findCatalogElement(card, (node) => node.tag === 'input')).toThrow()
      dispatchCatalogEvent(card, 'onClick')
      dispatchCatalogEvent(card, 'onPointerdown')
      expect(onPressStart.mock.lastCall?.[1]).toBe(drawer.id)
      const keys = card.props.onKeydown as ((event: unknown) => void)[]
      for (const key of ['Enter', ' ', 'ArrowDown'])
        keys.forEach((handler) =>
          handler({
            key,
            target: card,
            currentTarget: card,
            preventDefault() {},
            stopPropagation() {},
          }),
        )
      expect(onSelect).not.toHaveBeenCalled()
      expect(onShift).toHaveBeenCalledExactlyOnceWith(drawer.id, 1)
    } finally {
      view.unmount()
    }
  })
  it('starts hold detection from card whitespace while preserving text and controls', () => {
    const onPressStart = vi.fn()
    const onSelect = vi.fn()
    const mounted = mountCatalogComponent(CatalogDrawerCard, {
      drawer,
      selected: false,
      selectable: true,
      onPressStart,
      onSelect,
    })
    const find = (className: string) =>
      findCatalogElement(mounted.root, (node) =>
        String(node.props.class).split(' ').includes(className),
      )
    for (const className of [
      'catalog-card',
      'catalog-card__body',
      'catalog-card__header',
      'catalog-card__metrics',
    ])
      dispatchCatalogEvent(find(className), 'onPointerdown')
    expect(onPressStart).toHaveBeenCalledTimes(4)
    for (const className of ['catalog-card__status', 'catalog-card__view', 'catalog-card__select'])
      dispatchCatalogEvent(find(className), 'onPointerdown')
    const icon = findCatalogElement(find('catalog-card__more'), (node) => node.tag === 'path')
    dispatchCatalogEvent(icon, 'onPointerdown')
    dispatchCatalogEvent(
      findCatalogElement(mounted.root, (node) => node.tag === 'input'),
      'onPointerdown',
    )
    expect(onPressStart).toHaveBeenCalledTimes(4)
    expect(() =>
      findCatalogElement(
        mounted.root,
        (node) => node.tag === 'button' && 'data-catalog-handle' in node.props,
      ),
    ).toThrow()
    expect(onSelect).not.toHaveBeenCalled()
    mounted.unmount()
  })

  it('keeps keyboard selection and reordering on the card without intercepting child controls', () => {
    const onShift = vi.fn()
    const onSelect = vi.fn()
    const onDragCancel = vi.fn()
    const mounted = mountCatalogComponent(CatalogDrawerCard, {
      drawer,
      selected: false,
      selectable: true,
      onShift,
      onSelect,
      onDragCancel,
    })
    const card = findCatalogElement(mounted.root, (node) => node.tag === 'article')
    expect(card.props.tabindex).toBe('0')
    expect(card.props['aria-label']).toContain('长按空白拖动排序')
    const handlers = card.props.onKeydown as ((event: unknown) => void)[]
    const key = (value: string, target = card) => {
      const event = {
        key: value,
        target,
        currentTarget: card,
        preventDefault() {},
        stopPropagation() {},
      }
      handlers.forEach((handler) => handler(event))
    }
    key('ArrowUp')
    key('ArrowRight')
    expect(onShift.mock.calls).toEqual([
      [drawer.id, -1],
      [drawer.id, 1],
    ])
    key('Enter')
    key(' ')
    expect(onSelect).toHaveBeenCalledTimes(2)
    key('Escape')
    expect(onDragCancel).toHaveBeenCalledOnce()
    key(
      'ArrowDown',
      findCatalogElement(card, (node) => node.tag === 'input'),
    )
    expect(onShift).toHaveBeenCalledTimes(2)
    mounted.unmount()
  })

  it.each([
    ['idle', 0, '等待查看', undefined],
    ['restoring', 0, '等待查看', '加载第一页中'],
    ['ready', 1, '1 / 20 首', undefined],
    ['error', 1, '1 / 20 首', '需要验证'],
    ['missing', 1, '1 / 20 首', '音乐源已卸载'],
  ] as const)(
    'keeps %s headers limited to request kind and tracks, with notices before metrics',
    (status, count, summary, notice) => {
      const mounted = mountCatalogComponent(CatalogDrawerCard, {
        drawer: {
          ...drawer,
          status,
          isPinned: true,
          total: 20,
          errorCode: status === 'error' ? 'verification-required' : undefined,
          tracks: count ? [{ id: 'test:1' }] : [],
        },
        selected: false,
        selectable: true,
      })
      const header = findCatalogElement(mounted.root, (node) => node.tag === 'header')
      const labels = findCatalogElement(
        header,
        (node) => node.props.class === 'catalog-card__summary',
      )
      expect(
        labels.children
          .filter((node) => node.tag === 'span')
          .map((node) => node.textContent.trim()),
      ).toEqual(['搜索', summary])
      expect(header.textContent).not.toContain('置顶')
      if (notice) expect(header.textContent).not.toContain(notice)
      const notices = findCatalogElement(
        mounted.root,
        (node) => node.props.class === 'catalog-card__notices',
      )
      expect(notices.textContent).toContain('置顶')
      if (notice) expect(notices.textContent).toContain(notice)
      const metadata = notices.parent!
      expect(metadata.props['aria-label']).toBe('列表状态与加载概况')
      expect(metadata.props.tabindex).toBe('0')
      const metricsIndex = metadata.children.findIndex(
        (node) => node.props.class === 'catalog-card__metrics',
      )
      expect(metadata.children[metricsIndex - 1]).toBe(notices)
      mounted.unmount()
    },
  )

  it.each(['disconnected', 'error', 'invalid', 'missing'] as const)(
    'keeps %s source cards neutral and opens only already loaded tracks',
    (status) => {
      for (const hasTracks of [false, true]) {
        const onView = vi.fn()
        const onShowError = vi.fn()
        const mounted = mountCatalogComponent(CatalogDrawerCard, {
          drawer: {
            ...drawer,
            status,
            isSourceEnabled: false,
            errorMessage: '旧错误',
            tracks: hasTracks ? ([{ id: 'test:1' }] as never) : [],
          },
          selected: false,
          selectable: false,
          onView,
          onShowError,
        })
        expect(mounted.root.textContent).toContain(
          status === 'missing' ? '音乐源已卸载' : '音乐源已停用',
        )
        expect(mounted.root.textContent).not.toContain('处理错误')
        expect(mounted.root.textContent).not.toContain('还有更多')
        const button = findCatalogElement(
          mounted.root,
          (node) => node.tag === 'button' && node.textContent.includes('查看歌曲'),
        )
        expect(Boolean(button.props.disabled)).toBe(!hasTracks)
        dispatchCatalogEvent(button, 'onClick')
        expect(onView).toHaveBeenCalledTimes(hasTracks ? 1 : 0)
        expect(onShowError).not.toHaveBeenCalled()
        mounted.unmount()
      }
    },
  )

  it.each(['search', 'import-url'] as const)(
    'shows stable %s request time with semantic datetime',
    (kind) => {
      const createdAtMs = new Date(2026, 8, 30, 23, 45).getTime()
      const mounted = mountCatalogComponent(CatalogDrawerCard, {
        drawer: { ...drawer, kind, createdAtMs },
        selected: false,
        selectable: true,
      })
      expect(mounted.root.textContent).toContain(kind === 'search' ? '搜索时间' : '导入时间')
      const time = findCatalogElement(mounted.root, (node) => node.tag === 'time')
      expect(time.textContent).toBe('2026-09-30 23:45')
      expect(time.props.datetime).toBe(new Date(createdAtMs).toISOString())
      mounted.unmount()
    },
  )

  it('selects text, whitespace and primary actions once while keeping the menu independent', () => {
    const onSelect = vi.fn()
    const onShowActions = vi.fn()
    const onView = vi.fn()
    const mounted = mountCatalogComponent(CatalogDrawerCard, {
      drawer,
      selected: false,
      selectable: true,
      onSelect,
      onShowActions,
      onView,
    })
    const find = (className: string) =>
      findCatalogElement(mounted.root, (node) =>
        String(node.props.class).split(' ').includes(className),
      )
    dispatchCatalogEvent(find('catalog-card'), 'onClick')
    dispatchCatalogEvent(find('catalog-card__body'), 'onClick')
    dispatchCatalogEvent(find('catalog-card__metrics'), 'onClick')
    dispatchCatalogEvent(find('catalog-card__created-at'), 'onClick')
    expect(onSelect).toHaveBeenCalledTimes(4)

    const title = findCatalogElement(
      mounted.root,
      (node) => node.tag === 'span' && node.textContent === drawer.title,
    )
    dispatchCatalogEvent(title, 'onClick')
    dispatchCatalogEvent(find('catalog-card__status'), 'onClick')
    const timeText = findCatalogElement(
      find('catalog-card__created-at'),
      (node) => node.tag === 'span' && node.textContent === '搜索时间',
    )
    dispatchCatalogEvent(timeText, 'onClick')
    const actionIcon = findCatalogElement(find('catalog-card__more'), (node) => node.tag === 'path')
    dispatchCatalogEvent(actionIcon, 'onClick')
    dispatchCatalogEvent(find('catalog-card__view'), 'onClick')
    expect(onSelect).toHaveBeenCalledTimes(8)
    expect(onShowActions).toHaveBeenCalledExactlyOnceWith(drawer.id)
    expect(onView).not.toHaveBeenCalled()

    const checkbox = findCatalogElement(mounted.root, (node) => node.tag === 'input')
    dispatchCatalogEvent(checkbox, 'onClick')
    dispatchCatalogEvent(checkbox, 'onChange')
    expect(onSelect).toHaveBeenCalledTimes(9)
    expect(onSelect).toHaveBeenLastCalledWith(drawer.id)
    const request = find('catalog-card__request')
    dispatchCatalogEvent(request, 'onClick')
    expect(onSelect).toHaveBeenCalledTimes(10)
    dispatchCatalogEvent(
      findCatalogElement(request, (node) => node.tag === 'span'),
      'onClick',
    )
    dispatchCatalogEvent(
      findCatalogElement(request, (node) => node.tag === 'strong'),
      'onClick',
    )
    expect(onSelect).toHaveBeenCalledTimes(12)
    mounted.unmount()
  })

  it('keeps failed lists selectable and exposes their error action and pin status', () => {
    const onSelect = vi.fn()
    const onShowError = vi.fn()
    const mounted = mountCatalogComponent(CatalogDrawerCard, {
      drawer: { ...drawer, status: 'error', isPinned: true, errorMessage: '后续页不可用' },
      selected: true,
      selectable: true,
      onSelect,
      onShowError,
    })
    expect(mounted.root.textContent).toContain('置顶')
    expect(mounted.root.textContent).toContain('操作')
    expect(mounted.root.textContent).not.toContain('全部喜欢')
    dispatchCatalogEvent(
      findCatalogElement(mounted.root, (node) => node.tag === 'article'),
      'onClick',
    )
    dispatchCatalogEvent(
      findCatalogElement(
        mounted.root,
        (node) => node.tag === 'button' && node.textContent.includes('处理错误'),
      ),
      'onClick',
    )
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenLastCalledWith(drawer.id)
    expect(onShowError).not.toHaveBeenCalled()
    mounted.unmount()
  })
})
