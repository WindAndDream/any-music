import type { CatalogTrackFilterState } from '@any-music/ui'
import { createCatalogTrackFilterState } from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'

import CatalogFilterCalendar from '../../../src/components/music-sources/CatalogFilterCalendar.vue'
import CatalogFilterHistoryList from '../../../src/components/music-sources/CatalogFilterHistoryList.vue'
import CatalogTrackFilterEditor from '../../../src/components/music-sources/CatalogTrackFilterEditor.vue'
import CatalogTrackFilterSummary from '../../../src/components/music-sources/CatalogTrackFilterSummary.vue'

// Node 宿主执行实际转场生命周期和焦点逻辑，CSS 动画由生产构建保留。
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return { ...vue, Transition: vue.BaseTransition }
})

import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function findButton(root: CatalogTestElement, label: string) {
  return findCatalogElement(
    root,
    (node) => node.tag === 'button' && node.textContent.trim() === label,
  )
}

/** 年月日标题是模式入口，按稳定维度定位，避免与网格中的年月选项混淆。 */
function findCalendarHeading(root: CatalogTestElement, dimension: '年份' | '月份' | '日期') {
  const headingDimensions = { 年份: 'year', 月份: 'month', 日期: 'day' }
  return findCatalogElement(
    root,
    (node) =>
      node.tag === 'button' && node.props['data-calendar-heading'] === headingDimensions[dimension],
  )
}

function enterInput(input: CatalogTestElement, value: string): void {
  input.value = value
  input.dispatchListeners('input', { target: input })
}

describe('catalog track filter editor interactions', () => {
  it('focuses the selected naming option and restores naming without changing other dimensions', async () => {
    const filters = shallowRef<CatalogTrackFilterState>({
      ...createCatalogTrackFilterState(),
      naming: 'custom',
      platformIds: ['source-a'],
      searchFilters: [{ query: '关键词' }],
    })
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'naming',
      filterContext: 'drawers',
      tagStats: [],
      historyEntries: [
        {
          dimension: 'naming',
          filters: { ...createCatalogTrackFilterState(), naming: 'original' },
        },
      ],
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
    })
    const radio = (value: string) =>
      findCatalogElement(view.root, (node) => node.tag === 'input' && node.props.value === value)
    expect(radio('custom').isFocused).toBe(true)
    expect(radio('all').isFocused).toBe(false)
    dispatchCatalogEvent(radio('all'), 'onChange', false)
    await nextTick()
    expect(filters.value.naming).toBe('all')
    dispatchCatalogEvent(findButton(view.root, '来源原名'), 'onClick', false)
    await nextTick()
    expect(filters.value.naming).toBe('original')
    expect(radio('original').props.checked).toBe(true)
    expect(radio('original').isFocused).toBe(true)
    expect(filters.value.platformIds).toEqual(['source-a'])
    expect(filters.value.searchFilters).toEqual([{ query: '关键词' }])
    view.unmount()
  })

  it('previews platform unions and displays names when restoring platform history', async () => {
    const filters = shallowRef<CatalogTrackFilterState>({
      ...createCatalogTrackFilterState(),
      platformIds: ['source-a'],
      naming: 'custom',
      searchFilters: [{ query: '关键词' }],
    })
    const preview = vi.fn()
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'platforms',
      filterContext: 'drawers',
      tagStats: [],
      platformStats: [
        { id: 'source-a', name: '甲平台', count: 2 },
        { id: 'source-b', name: '乙平台', count: 3 },
      ],
      historyEntries: [
        {
          dimension: 'platforms',
          filters: { ...createCatalogTrackFilterState(), platformIds: ['source-b'] },
        },
      ],
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
      onPreviewChange: preview,
    })
    const platform = findCatalogElement(
      view.root,
      (node) => node.tag === 'label' && node.textContent.includes('乙平台'),
    )
    const checkbox = findCatalogElement(platform, (node) => node.tag === 'input')
    expect(checkbox.props.checked).toBe(false)
    dispatchCatalogEvent(checkbox, 'onChange', false)
    await nextTick()
    expect(filters.value.platformIds).toEqual(['source-a', 'source-b'])
    expect(preview).toHaveBeenLastCalledWith(filters.value)
    dispatchCatalogEvent(findButton(view.root, '乙平台'), 'onClick', false)
    await nextTick()
    expect(filters.value.platformIds).toEqual(['source-b'])
    expect(filters.value.naming).toBe('custom')
    expect(filters.value.searchFilters).toEqual([{ query: '关键词' }])
    expect(view.root.textContent).not.toContain('source-b')
    view.unmount()
  })

  it('shows one focused search input immediately and restores search history by clicking it', async () => {
    const filters = shallowRef(createCatalogTrackFilterState())
    const confirm = vi.fn()
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'search',
      tagStats: [],
      historyEntries: [
        {
          dimension: 'search',
          filters: { ...createCatalogTrackFilterState(), searchFilters: [{ query: '历史关键词' }] },
        },
      ],
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
      onConfirm: confirm,
    })
    const input = findCatalogElement(view.root, (node) => node.tag === 'input')
    expect(input.isFocused).toBe(true)
    expect(view.root.textContent).not.toContain('添加搜索条件')
    expect(view.root.textContent).not.toContain('搜索范围')
    enterInput(input, '新关键词')
    await nextTick()
    expect(filters.value.searchFilters).toEqual([{ query: '新关键词' }])
    dispatchCatalogEvent(findButton(view.root, '历史关键词'), 'onClick', false)
    await nextTick()
    expect(input.value).toBe('历史关键词')
    expect(filters.value.searchFilters).toEqual([{ query: '历史关键词' }])
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
      false,
    )
    expect(confirm).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('switches dates through the current-range buttons and resets the add action after submission', async () => {
    const filters = shallowRef(createCatalogTrackFilterState())
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'published',
      tagStats: [],
      historyEntries: [],
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
    })
    const pendingRange = findCatalogElement(view.root, (node) =>
      String(node.props.class ?? '').includes('catalog-filter-editor__pending'),
    )
    const startSummary = findCatalogElement(
      pendingRange,
      (node) => node.tag === 'button' && node.props['aria-label'] === '设置起始日期',
    )
    const endSummary = findCatalogElement(
      pendingRange,
      (node) => node.tag === 'button' && node.props['aria-label'] === '设置结束日期',
    )
    expect(startSummary.props.type).toBe('button')
    expect(endSummary.props.type).toBe('button')
    expect(startSummary.props['aria-pressed']).toBe(true)
    expect(endSummary.props['aria-pressed']).toBe(false)
    expect(() => findButton(view.root, '加入时间段')).toThrow()
    const date = findCatalogElement(
      view.root,
      (node) =>
        node.tag === 'button' &&
        node.props.tabindex === 0 &&
        Boolean(node.props['data-calendar-date']),
    )
    const selectedDate = String(date.props['data-calendar-date'])
    dispatchCatalogEvent(date, 'onClick', false)
    await nextTick()
    expect(() => findButton(view.root, '加入时间段')).toThrow()
    dispatchCatalogEvent(endSummary, 'onClick', false)
    await nextTick()
    expect(startSummary.props['aria-pressed']).toBe(false)
    expect(endSummary.props['aria-pressed']).toBe(true)
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '设置结束日期').props[
        'aria-pressed'
      ],
    ).toBe(true)
    expect(filters.value.publishedRanges).toEqual([])
    expect(
      findCatalogElement(
        pendingRange,
        (node) => node.tag === 'time' && node.props.datetime === selectedDate,
      ).textContent,
    ).toBe(selectedDate)
    expect(pendingRange.textContent).toContain('起始')
    expect(pendingRange.textContent).toContain('结束')
    expect(() =>
      findCatalogElement(pendingRange, (node) => /^结束\s*正在设置$/u.test(node.textContent)),
    ).not.toThrow()
    expect(findButton(view.root, '加入时间段').props.disabled).toBe(false)
    dispatchCatalogEvent(startSummary, 'onClick', false)
    await nextTick()
    expect(startSummary.props['aria-pressed']).toBe(true)
    expect(endSummary.props['aria-pressed']).toBe(false)
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '设置起始日期').props[
        'aria-pressed'
      ],
    ).toBe(true)
    expect(findButton(view.root, '加入时间段').props.disabled).toBe(false)
    expect(() =>
      findCatalogElement(pendingRange, (node) => /^起始\s*正在设置$/u.test(node.textContent)),
    ).not.toThrow()
    expect(() =>
      findCatalogElement(pendingRange, (node) => /^结束\s*正在设置$/u.test(node.textContent)),
    ).toThrow()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '设置结束日期'),
      'onClick',
      false,
    )
    await nextTick()
    const firstDay = findCatalogElement(
      view.root,
      (node) =>
        Boolean(node.props['data-calendar-date']) &&
        String(node.props['data-calendar-date']) < selectedDate,
    )
    expect(firstDay.props.disabled).toBe(true)
    dispatchCatalogEvent(findButton(view.root, '加入时间段'), 'onClick', false)
    await nextTick()
    expect(filters.value.publishedRanges).toEqual([{ from: selectedDate, to: selectedDate }])
    expect(view.root.textContent).toContain(`${selectedDate} 至 ${selectedDate}`)
    expect(() => findButton(view.root, '加入时间段')).toThrow()
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '设置起始日期')
        .isFocused,
    ).toBe(true)
    view.unmount()
  })

  it('switches endpoint controls without changing the other date and keeps the update action available', async () => {
    const filters = shallowRef<CatalogTrackFilterState>({
      ...createCatalogTrackFilterState(),
      publishedRanges: [{ from: '2026-02-01', to: '2026-02-15' }],
    })
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'published',
      tagStats: [],
      historyEntries: [],
      initialIndex: 0,
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
    })
    const start = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === '设置起始日期',
    )
    const end = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.props['aria-label'] === '设置结束日期',
    )
    expect(end.props['aria-pressed']).toBe(true)
    dispatchCatalogEvent(start, 'onClick', false)
    await nextTick()
    expect(start.props['aria-pressed']).toBe(true)
    expect(end.props['aria-pressed']).toBe(false)
    expect(
      findCatalogElement(view.root, (node) => node.props['data-calendar-date'] === '2026-02-16')
        .props.disabled,
    ).toBe(true)
    const date = findCatalogElement(
      view.root,
      (node) => node.props['data-calendar-date'] === '2026-02-05',
    )
    dispatchCatalogEvent(date, 'onClick', false)
    await nextTick()
    const pendingRange = findCatalogElement(view.root, (node) =>
      String(node.props.class ?? '').includes('catalog-filter-editor__pending'),
    )
    expect(pendingRange.textContent).toContain('2026-02-05')
    expect(pendingRange.textContent).toContain('2026-02-15')
    dispatchCatalogEvent(findButton(view.root, '更新时间段'), 'onClick', false)
    await nextTick()
    expect(filters.value.publishedRanges).toEqual([{ from: '2026-02-05', to: '2026-02-15' }])
    view.unmount()
  })

  it('shows both endpoint selections in the end stage and only the start selection when switching back', async () => {
    const stage = shallowRef<'start' | 'end'>('end')
    const view = mountCatalogComponent(CatalogFilterCalendar, {
      from: '2026-02-05',
      to: '2026-02-15',
      month: '2026-02',
      get stage() {
        return stage.value
      },
    })
    const findDate = (date: string) =>
      findCatalogElement(view.root, (node) => node.props['data-calendar-date'] === date)
    expect(findDate('2026-02-05').props['aria-pressed']).toBe(true)
    expect(findDate('2026-02-15').props['aria-pressed']).toBe(true)
    expect(findDate('2026-02-10').props.class).toContain('is-between')
    stage.value = 'start'
    await nextTick()
    expect(findDate('2026-02-05').props['aria-pressed']).toBe(true)
    expect(findDate('2026-02-15').props['aria-pressed']).toBe(false)
    expect(findDate('2026-02-15').props.class).not.toContain('is-edge')
    expect(findDate('2026-02-10').props.class).not.toContain('is-between')
    view.unmount()
  })

  it('loads the clicked duration into both fields and replaces its original range', async () => {
    const filters = shallowRef<CatalogTrackFilterState>({
      ...createCatalogTrackFilterState(),
      durationRanges: [{ minMs: 60_000, maxMs: 180_000 }, { minMs: 300_000 }],
    })
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'duration',
      tagStats: [],
      historyEntries: [],
      initialIndex: 0,
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
    })
    const minimum = findCatalogElement(
      view.root,
      (node) => node.props['aria-label'] === '最短时长（分钟）',
    )
    const maximum = findCatalogElement(
      view.root,
      (node) => node.props['aria-label'] === '最长时长（分钟）',
    )
    expect(minimum.value).toBe('1')
    expect(maximum.value).toBe('3')
    enterInput(maximum, '4')
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.tag === 'form'),
      'onSubmit',
      false,
    )
    await nextTick()
    expect(filters.value.durationRanges).toEqual([
      { minMs: 60_000, maxMs: 240_000 },
      { minMs: 300_000 },
    ])
    view.unmount()
  })

  it('makes each summary criterion an edit button that emits its dimension and index', () => {
    const edit = vi.fn()
    const view = mountCatalogComponent(CatalogTrackFilterSummary, {
      filters: {
        ...createCatalogTrackFilterState(),
        durationRanges: [{ minMs: 60_000 }, { maxMs: 180_000 }],
      },
      resultCount: 2,
      totalCount: 3,
      onEdit: edit,
    })
    dispatchCatalogEvent(findButton(view.root, '3 分钟 以内'), 'onClick', false)
    expect(edit).toHaveBeenCalledWith('duration', 1)
    expect(() => findButton(view.root, '修改')).toThrow()
    expect(view.root.textContent).not.toContain('未筛选')
    view.unmount()
  })

  it('restores all historical duration ranges and fills inputs from the restored snapshot', async () => {
    const filters = shallowRef<CatalogTrackFilterState>({
      ...createCatalogTrackFilterState(),
      tags: ['现场'],
      durationRanges: [{ minMs: 600_000 }],
    })
    const historicalFilters = {
      ...createCatalogTrackFilterState(),
      durationRanges: [{ maxMs: 120_000 }, { minMs: 300_000 }],
    }
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'duration',
      tagStats: [],
      historyEntries: [{ dimension: 'duration', filters: historicalFilters }],
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
    })
    const historyButton = findCatalogElement(
      view.root,
      (node) => node.props['aria-label'] === '恢复筛选 2 分钟 以内；5 分钟 以上',
    )
    dispatchCatalogEvent(historyButton, 'onClick', false)
    await nextTick()
    expect(filters.value.durationRanges).toEqual(historicalFilters.durationRanges)
    expect(filters.value.tags).toEqual(['现场'])
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '最短时长（分钟）')
        .value,
    ).toBe('')
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '最长时长（分钟）')
        .value,
    ).toBe('2')
    view.unmount()
  })

  it('moves calendar selection and keyboard focus across a leap-month boundary', async () => {
    const selectedDate = shallowRef('2024-02-29')
    const month = shallowRef('2024-02')
    const view = mountCatalogComponent(CatalogFilterCalendar, {
      get from() {
        return selectedDate.value
      },
      to: '',
      stage: 'start',
      get month() {
        return month.value
      },
      'onUpdate:month': (value: string) => {
        month.value = value
      },
      onSelectDate: (value: string) => {
        selectedDate.value = value
      },
    })
    const selected = findCatalogElement(
      view.root,
      (node) => node.props['data-calendar-date'] === '2024-02-29',
    )
    const preventDefault = vi.fn()
    await (selected.props.onKeydown as (event: unknown) => Promise<void>)({
      key: 'ArrowRight',
      preventDefault,
    })
    expect(selectedDate.value).toBe('2024-03-01')
    expect(month.value).toBe('2024-03')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(
      findCatalogElement(view.root, (node) => node.props['data-calendar-date'] === '2024-03-01')
        .isFocused,
    ).toBe(true)
    view.unmount()
  })

  it('switches views through the numeric headings and hands focus to new year/month selections', async () => {
    const month = shallowRef('2026-09')
    const view = mountCatalogComponent(CatalogFilterCalendar, {
      from: '2026-09-29',
      to: '',
      stage: 'start',
      get month() {
        return month.value
      },
      'onUpdate:month': (value: string) => {
        month.value = value
      },
    })
    expect(findCalendarHeading(view.root, '年份').textContent.trim()).toBe('2026年')
    expect(findCalendarHeading(view.root, '月份').textContent.trim()).toBe('9月')
    expect(findCalendarHeading(view.root, '日期').textContent.trim()).toBe('29日')
    expect(findCalendarHeading(view.root, '日期').props['aria-pressed']).toBe(true)
    dispatchCatalogEvent(findCalendarHeading(view.root, '年份'), 'onClick', false)
    await nextTick()
    expect(findCalendarHeading(view.root, '年份').props['aria-pressed']).toBe(true)
    expect(findCalendarHeading(view.root, '日期').props['aria-pressed']).toBe(false)
    expect(view.root.textContent).toContain('选择模式 · 年份')
    dispatchCatalogEvent(findButton(view.root, '2025 年'), 'onClick', false)
    await nextTick()
    expect(month.value).toBe('2025-09')
    expect(findCalendarHeading(view.root, '年份').textContent.trim()).toBe('2025年')
    expect(findCalendarHeading(view.root, '年份').props['aria-pressed']).toBe(false)
    expect(findCalendarHeading(view.root, '月份').props['aria-pressed']).toBe(true)
    expect(findButton(view.root, '9 月').isFocused).toBe(true)
    dispatchCatalogEvent(findCalendarHeading(view.root, '日期'), 'onClick', false)
    await nextTick()
    expect(findCalendarHeading(view.root, '日期').props['aria-pressed']).toBe(true)
    expect(view.root.textContent).toContain('选择模式 · 日期')
    expect(
      findCatalogElement(view.root, (node) => node.props['data-calendar-date'] === '2025-09-01')
        .props.tabindex,
    ).toBe(0)
    // 在标题切换模式不提交新的端点，也不改变当前浏览月份。
    expect(month.value).toBe('2025-09')
    dispatchCatalogEvent(findCalendarHeading(view.root, '月份'), 'onClick', false)
    await nextTick()
    expect(findCalendarHeading(view.root, '月份').props['aria-pressed']).toBe(true)
    dispatchCatalogEvent(findButton(view.root, '2 月'), 'onClick', false)
    await nextTick()
    expect(month.value).toBe('2025-02')
    expect(findCalendarHeading(view.root, '月份').textContent.trim()).toBe('2月')
    expect(findCalendarHeading(view.root, '月份').props['aria-pressed']).toBe(false)
    expect(findCalendarHeading(view.root, '日期').props['aria-pressed']).toBe(true)
    expect(findCalendarHeading(view.root, '日期').textContent.trim()).toBe('1日')
    expect(
      findCatalogElement(view.root, (node) => node.props['data-calendar-date'] === '2025-02-01')
        .isFocused,
    ).toBe(true)
    view.unmount()
  })

  it('keeps the heading day in sync with the active endpoint and keyboard date selection', async () => {
    const month = shallowRef('2024-02')
    const from = shallowRef('2024-02-10')
    const to = shallowRef('2024-02-28')
    const stage = shallowRef<'start' | 'end'>('start')
    const view = mountCatalogComponent(CatalogFilterCalendar, {
      get from() {
        return from.value
      },
      get to() {
        return to.value
      },
      get stage() {
        return stage.value
      },
      get month() {
        return month.value
      },
      'onUpdate:month': (value: string) => {
        month.value = value
      },
      onSelectDate: (value: string) => {
        if (stage.value === 'start') from.value = value
        else to.value = value
      },
    })
    expect(findCalendarHeading(view.root, '日期').textContent.trim()).toBe('10日')
    stage.value = 'end'
    await nextTick()
    expect(findCalendarHeading(view.root, '日期').textContent.trim()).toBe('28日')
    const selected = findCatalogElement(
      view.root,
      (node) => node.props['data-calendar-date'] === '2024-02-28',
    )
    await (selected.props.onKeydown as (event: unknown) => Promise<void>)({
      key: 'ArrowRight',
      preventDefault: vi.fn(),
    })
    expect(findCalendarHeading(view.root, '日期').textContent.trim()).toBe('29日')
    expect(from.value).toBe('2024-02-10')
    expect(to.value).toBe('2024-02-29')
    view.unmount()
  })

  it('bounds start-date keyboard, year, and month navigation by the selected end date', async () => {
    const month = shallowRef('2026-02')
    const selectedDate = shallowRef('2026-02-15')
    const view = mountCatalogComponent(CatalogFilterCalendar, {
      get from() {
        return selectedDate.value
      },
      to: '2026-02-15',
      stage: 'start',
      get month() {
        return month.value
      },
      'onUpdate:month': (value: string) => {
        month.value = value
      },
      onSelectDate: (value: string) => {
        selectedDate.value = value
      },
    })
    const selected = findCatalogElement(
      view.root,
      (node) => node.props['data-calendar-date'] === '2026-02-15',
    )
    await (selected.props.onKeydown as (event: unknown) => Promise<void>)({
      key: 'ArrowRight',
      preventDefault: vi.fn(),
    })
    expect(selectedDate.value).toBe('2026-02-15')
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '下个月').props.disabled,
    ).toBe(true)
    dispatchCatalogEvent(findCalendarHeading(view.root, '月份'), 'onClick', false)
    await nextTick()
    expect(findButton(view.root, '3 月').props.disabled).toBe(true)
    dispatchCatalogEvent(findCalendarHeading(view.root, '年份'), 'onClick', false)
    await nextTick()
    expect(findButton(view.root, '2027 年').props.disabled).toBe(true)
    dispatchCatalogEvent(findButton(view.root, '2025 年'), 'onClick', false)
    await nextTick()
    expect(findButton(view.root, '3 月').props.disabled).toBe(false)
    view.unmount()
  })

  it('collapses history at the configured count and renders each range on its own line', async () => {
    const restore = vi.fn()
    const entries = Array.from({ length: 5 }, (_, index) => ({
      dimension: 'published',
      filters: {
        ...createCatalogTrackFilterState(),
        publishedRanges: [
          { from: `2026-01-0${index + 1}`, to: '2026-01-10' },
          { from: '2026-02-01', to: '2026-02-02' },
        ],
      },
    }))
    const collapseAfter = shallowRef(2)
    const view = mountCatalogComponent(CatalogFilterHistoryList, {
      entries,
      title: '历史筛选时间',
      get collapseAfter() {
        return collapseAfter.value
      },
      onRestore: restore,
    })
    expect(() =>
      findCatalogElement(
        view.root,
        (node) =>
          node.props['aria-label'] ===
          '恢复筛选 2026-01-03 至 2026-01-10；2026-02-01 至 2026-02-02',
      ),
    ).toThrow()
    const expand = findButton(view.root, '展开其余 3 组')
    expect(expand.props['aria-expanded']).toBe(false)
    dispatchCatalogEvent(expand, 'onClick', false)
    await nextTick()
    const record = findCatalogElement(
      view.root,
      (node) =>
        node.props['aria-label'] === '恢复筛选 2026-01-03 至 2026-01-10；2026-02-01 至 2026-02-02',
    )
    const ranges = record.children.filter((node) =>
      String(node.props.class ?? '').includes('catalog-filter-history__date-range'),
    )
    expect(ranges).toHaveLength(2)
    expect(record.textContent).not.toContain('起始')
    expect(record.textContent).not.toContain('结束')
    expect(record.textContent).not.toContain('正在设置')
    expect(
      findCatalogElement(
        ranges[0]!,
        (node) => node.tag === 'time' && node.props.datetime === '2026-01-03',
      ).textContent,
    ).toBe('2026-01-03')
    expect(
      findCatalogElement(
        ranges[1]!,
        (node) => node.tag === 'time' && node.props.datetime === '2026-02-02',
      ).textContent,
    ).toBe('2026-02-02')
    // 历史只读日期不能产生嵌套按钮；整块仍一次恢复所有区间。
    expect(() =>
      findCatalogElement(record, (node) => node !== record && node.tag === 'button'),
    ).toThrow()
    dispatchCatalogEvent(record, 'onClick', false)
    expect(restore).toHaveBeenCalledWith(entries[2])
    expect(findButton(view.root, '收起历史').props['aria-expanded']).toBe(true)
    collapseAfter.value = 1
    await nextTick()
    expect(findButton(view.root, '展开其余 4 组').props['aria-expanded']).toBe(false)
    view.unmount()
  })

  it('reveals the next collapsed history after deletion and retains keyboard focus on the adjacent group', async () => {
    const entries = shallowRef(
      Array.from({ length: 3 }, (_, index) => ({
        dimension: 'tags' as const,
        filters: { ...createCatalogTrackFilterState(), tags: [`标签 ${index}`, '现场'] },
      })),
    )
    const restore = vi.fn()
    const view = mountCatalogComponent(CatalogFilterHistoryList, {
      get entries() {
        return entries.value
      },
      title: '标签筛选历史',
      collapseAfter: 1,
      onRestore: restore,
      onRemove: (entry: (typeof entries.value)[number]) => {
        entries.value = entries.value.filter((candidate) => candidate !== entry)
      },
    })
    const remove = findCatalogElement(
      view.root,
      (node) => node.props['aria-label'] === '删除历史筛选 标签 0；现场',
    )
    dispatchCatalogEvent(remove, 'onClick')
    await nextTick()
    expect(restore).not.toHaveBeenCalled()
    expect(entries.value).toHaveLength(2)
    expect(view.root.textContent).not.toContain('标签 0')
    expect(view.root.textContent).toContain('标签 1')
    expect(findButton(view.root, '展开其余 1 组').props['aria-expanded']).toBe(false)
    expect(
      findCatalogElement(
        view.root,
        (node) => node.props['aria-label'] === '删除历史筛选 标签 1；现场',
      ).isFocused,
    ).toBe(true)
    view.unmount()
  })

  it.each(['tags', 'duration'] as const)(
    'restores a complete %s history group through one button after expanding',
    async (dimension) => {
      const restore = vi.fn()
      const entries = [
        {
          dimension,
          filters: {
            ...createCatalogTrackFilterState(),
            tags: ['独奏'],
            durationRanges: [{ minMs: 0 }],
          },
        },
        {
          dimension,
          filters: {
            ...createCatalogTrackFilterState(),
            tags: ['现场', '纯音乐', '很长的标签名称也应该完整保留'],
            durationRanges: [{ minMs: 60_000, maxMs: 180_000 }, { maxMs: 30_000 }],
          },
        },
      ]
      const view = mountCatalogComponent(CatalogFilterHistoryList, {
        entries,
        title: dimension === 'tags' ? '标签筛选历史' : '历史筛选时长',
        collapseAfter: 1,
        onRestore: restore,
      })
      dispatchCatalogEvent(findButton(view.root, '展开其余 1 组'), 'onClick', false)
      await nextTick()
      const label =
        dimension === 'tags'
          ? '恢复筛选 现场；纯音乐；很长的标签名称也应该完整保留'
          : '恢复筛选 1 分钟 至 3 分钟；0.5 分钟 以内'
      const record = findCatalogElement(view.root, (node) => node.props['aria-label'] === label)
      expect(
        record.children.filter((node) => node.tag === 'span').map((node) => node.textContent),
      ).toEqual(
        dimension === 'tags' ? entries[1]!.filters.tags : ['1 分钟 至 3 分钟', '0.5 分钟 以内'],
      )
      expect(() =>
        findCatalogElement(record, (node) => node !== record && node.tag === 'button'),
      ).toThrow()
      dispatchCatalogEvent(record, 'onClick', false)
      expect(restore).toHaveBeenCalledExactlyOnceWith(entries[1])
      view.unmount()
    },
  )

  it('restores tag history without changing search or date filters', async () => {
    const filters = shallowRef<CatalogTrackFilterState>({
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: '关键词' }],
      tags: ['旧标签'],
    })
    const view = mountCatalogComponent(CatalogTrackFilterEditor, {
      dimension: 'tags',
      tagStats: [{ name: '现场', count: 1 }],
      historyEntries: [
        { dimension: 'tags', filters: { ...createCatalogTrackFilterState(), tags: ['现场'] } },
      ],
      get filters() {
        return filters.value
      },
      'onUpdate:filters': (next: CatalogTrackFilterState) => {
        filters.value = next
      },
    })
    dispatchCatalogEvent(findButton(view.root, '现场'), 'onClick', false)
    await nextTick()
    expect(filters.value.tags).toEqual(['现场'])
    expect(filters.value.searchFilters).toEqual([{ query: '关键词' }])
    view.unmount()
  })
})
