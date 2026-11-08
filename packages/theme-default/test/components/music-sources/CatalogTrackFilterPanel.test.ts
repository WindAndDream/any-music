import type { Track } from '@any-music/core'
import type {
  CatalogFilterHistoryEntry,
  CatalogTagStat,
  CatalogTrackFilterState,
} from '@any-music/ui'
import {
  createCatalogTrackFilterState,
  createEditingSession,
  provideEditingSession,
  filterCatalogTracks,
  provideCatalogFilterHistory,
  provideConfirmationDialog,
} from '@any-music/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import CatalogTrackFilterPanel from '../../../src/components/music-sources/CatalogTrackFilterPanel.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const transitionControl = vi.hoisted(() => ({
  hold: false,
  finish: undefined as (() => void) | undefined,
}))

function finishTransition(): void {
  transitionControl.finish?.()
}

// 在 Node 中运行真实受控组件更新，并可暂停离场以验证外层底栏的切换时机。
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup(_props, { slots, attrs }) {
        let previousKey: unknown
        return () => {
          const children = slots.default?.()
          const key = children?.[0]?.key
          if (previousKey !== undefined && key !== previousKey) {
            const finish = () => (attrs.onAfterLeave as (() => void) | undefined)?.()
            if (transitionControl.hold) transitionControl.finish = finish
            else finish()
          }
          previousKey = key
          return children
        }
      },
    }),
  }
})

beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => {
  transitionControl.hold = false
  transitionControl.finish = undefined
  vi.unstubAllGlobals()
})

/** 使用受控父组件观察真实草稿更新与确认服务，避免只检查组件内部实现。 */
function mountFilterPanel(
  initialFilters: CatalogTrackFilterState,
  previewOptions?: {
    tracks: readonly Track[]
    customTagsByTrackId: ReadonlyMap<string, readonly string[]>
    tagStats: readonly CatalogTagStat[]
  },
) {
  const filters = shallowRef(initialFilters)
  const resultCount = shallowRef(3)
  const updatePreview = (next: CatalogTrackFilterState): void => {
    if (previewOptions)
      resultCount.value = filterCatalogTracks(
        previewOptions.tracks,
        previewOptions.customTagsByTrackId,
        next,
      ).length
  }
  updatePreview(initialFilters)
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const host = defineComponent({
    setup() {
      confirmation = provideConfirmationDialog()
      provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
      return () =>
        h(CatalogTrackFilterPanel, {
          historyScope: 'test',
          filters: filters.value,
          'onUpdate:filters': (next: CatalogTrackFilterState) => {
            filters.value = next
          },
          tagStats: previewOptions?.tagStats ?? [],
          resultCount: resultCount.value,
          totalCount: previewOptions?.tracks.length ?? 12,
          onPreviewChange: updatePreview,
        })
    },
  })
  const view = mountCatalogComponent(host, {})
  return { ...view, filters, resultCount, confirmation }
}

describe('CatalogTrackFilterPanel overview actions', () => {
  it('switches the outer footer only after the outgoing view has left', async () => {
    const detailOpen = shallowRef(false)
    const host = defineComponent({
      setup() {
        provideConfirmationDialog()
        provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
        return () =>
          h(CatalogTrackFilterPanel, {
            historyScope: 'test',
            filters: createCatalogTrackFilterState(),
            tagStats: [],
            resultCount: 0,
            totalCount: 0,
            onDetailOpenChange: (value: boolean) => {
              detailOpen.value = value
            },
          })
      },
    })
    const view = mountCatalogComponent(host, {})
    transitionControl.hold = true
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === 'search'),
      'onClick',
      false,
    )
    await nextTick()
    expect(detailOpen.value).toBe(false)
    expect(transitionControl.finish).toBeDefined()
    finishTransition()
    await nextTick()
    expect(detailOpen.value).toBe(true)

    transitionControl.finish = undefined
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '返回筛选概览'),
      'onClick',
      false,
    )
    await nextTick()
    expect(detailOpen.value).toBe(true)
    expect(transitionControl.finish).toBeDefined()
    finishTransition()
    await nextTick()
    expect(detailOpen.value).toBe(false)
    view.unmount()
  })

  it.each([
    ['search', 'queue'],
    ['platforms', 'queue'],
    ['published', 'queue'],
    ['duration', 'queue'],
    ['naming', 'drawers'],
  ] as const)(
    'synchronizes the retained %s detail after the panel is reopened',
    async (dimension, context) => {
      const open = shallowRef(true)
      const detailOpen = shallowRef(false)
      const session = createEditingSession()
      const host = defineComponent({
        setup() {
          provideEditingSession(session)
          provideConfirmationDialog()
          provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
          return () =>
            open.value
              ? h(CatalogTrackFilterPanel, {
                  filters: createCatalogTrackFilterState(),
                  filterContext: context,
                  historyScope: 'test',
                  tagStats: [],
                  platformStats: [{ id: 'source', name: '测试平台', count: 2 }],
                  resultCount: 2,
                  totalCount: 2,
                  onDetailOpenChange: (value: boolean) => {
                    detailOpen.value = value
                  },
                })
              : null
        },
      })
      const view = mountCatalogComponent(host, {})
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === dimension),
        'onClick',
        false,
      )
      await nextTick()
      expect(detailOpen.value).toBe(true)
      open.value = false
      await nextTick()
      detailOpen.value = false
      open.value = true
      await nextTick()
      expect(detailOpen.value).toBe(true)
      expect(view.root.textContent).toContain('返回')
      if (dimension === 'platforms') expect(view.root.textContent).toContain('测试平台')
      view.unmount()
      session.dispose()
    },
  )

  it('restores the dimension rail scroll position after returning to the overview', async () => {
    const view = mountFilterPanel(createCatalogTrackFilterState())
    const rail = findCatalogElement(view.root, (node) => node.props['aria-label'] === '筛选类型')
    rail.scrollLeft = 175
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === 'duration'),
      'onClick',
      false,
    )
    await nextTick()
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '返回筛选概览'),
      'onClick',
      false,
    )
    await nextTick()
    expect(
      findCatalogElement(view.root, (node) => node.props['aria-label'] === '筛选类型').scrollLeft,
    ).toBe(175)
    view.unmount()
  })

  it.each([
    { dimension: 'search', key: 'searchFilters', title: '搜索筛选' },
    { dimension: 'tags', key: 'tags', title: '标签筛选' },
    { dimension: 'published', key: 'publishedRanges', title: '发布时间' },
    { dimension: 'duration', key: 'durationRanges', title: '歌曲时长' },
  ] as const)(
    'removes one $dimension criterion immediately without confirmation',
    async (entry) => {
      const initialFilters: CatalogTrackFilterState = {
        searchFilters: [{ query: '当前关键词' }],
        tags: ['现场', '纯音乐'],
        publishedRanges: [
          { from: '2026-04-01', to: '2026-04-02' },
          { from: '2026-05-01', to: '2026-05-02' },
        ],
        durationRanges: [{ minMs: 60_000 }, { maxMs: 180_000 }],
      }
      const view = mountFilterPanel(initialFilters)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) =>
          String(node.props['aria-label'] ?? '').startsWith(`删除${entry.title}条件 `),
        ),
        'onClick',
        false,
      )
      // 点击当帧就提交新草稿，无需响应弹窗，也不会改动其他维度或同组剩余项。
      expect(view.confirmation.activeRequest.value).toBeUndefined()
      expect(view.filters.value).toEqual({
        ...initialFilters,
        [entry.key]: initialFilters[entry.key].slice(1),
      })
      await nextTick()
      expect(
        findCatalogElement(
          view.root,
          (node) => node.props['data-filter-dimension'] === entry.dimension,
        ).isFocused,
      ).toBe(true)
      view.unmount()
    },
  )

  it('keeps clear-all pending until accepted and preserves the draft when canceled', async () => {
    const initialFilters = {
      ...createCatalogTrackFilterState(),
      tags: ['现场'],
      durationRanges: [{ minMs: 60_000 }],
    }
    const view = mountFilterPanel(initialFilters)
    const clear = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent === '清空全部',
    )
    dispatchCatalogEvent(clear, 'onClick', false)
    expect(view.confirmation.activeRequest.value?.title).toBe('清空全部筛选？')
    expect(view.filters.value).toEqual(initialFilters)
    view.confirmation.cancel()
    await nextTick()
    expect(view.filters.value).toEqual(initialFilters)

    dispatchCatalogEvent(clear, 'onClick', false)
    view.confirmation.accept()
    await nextTick()
    await nextTick()
    expect(view.filters.value).toEqual(createCatalogTrackFilterState())
    expect(() =>
      findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent === '清空全部',
      ),
    ).toThrow()
    view.unmount()
  })

  it('shows reactive preview counts inside both overview and detail headings', async () => {
    const view = mountFilterPanel(createCatalogTrackFilterState())
    const summaryHeader = findCatalogElement(
      view.root,
      (node) => node.props.class === 'catalog-filter-summary__header',
    )
    expect(summaryHeader.textContent).toContain('筛选预览3 / 12 首')
    view.resultCount.value = 7
    await nextTick()
    expect(summaryHeader.textContent).toContain('筛选预览7 / 12 首')

    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === 'search'),
      'onClick',
      false,
    )
    await nextTick()
    const detailHeader = findCatalogElement(
      view.root,
      (node) => node.props.class === 'catalog-filters__detail-header',
    )
    expect(detailHeader.textContent).toContain('筛选预览7 / 12 首')
    expect(view.root.textContent).toContain('搜索筛选')
    view.unmount()
  })

  it.each(['search', 'tags', 'published', 'duration'] as const)(
    'previews unconfirmed %s input with other criteria and restores counts on Back',
    async (dimension) => {
      const tracks = [
        { id: 'first', title: '晨间音乐', durationMs: 60_000, publishedDate: '2026-09-01' },
        { id: 'second', title: '夜晚音乐', durationMs: 180_000, publishedDate: '2026-09-02' },
        { id: 'untagged', title: '晨间音乐', durationMs: 60_000, publishedDate: '2026-09-01' },
      ].map((track): Track => ({
        id: track.id,
        title: track.title,
        durationMs: track.durationMs,
        publishedAtMs: new Date(`${track.publishedDate}T12:00:00`).getTime(),
        artists: [],
        source: { pluginId: 'test', mediaKind: 'audio', resourceId: track.id },
      }))
      const initialFilters = {
        ...createCatalogTrackFilterState(),
        tags: ['现场'],
        publishedRanges:
          dimension === 'published' ? [{ from: '2026-09-01', to: '2026-09-30' }] : [],
      }
      const view = mountFilterPanel(initialFilters, {
        tracks,
        customTagsByTrackId: new Map([
          ['first', ['现场']],
          ['second', ['现场']],
        ]),
        tagStats: [{ name: '现场', count: 2 }],
      })
      expect(view.resultCount.value).toBe(2)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) =>
          dimension === 'published'
            ? node.props['data-filter-edit'] === 'published:0'
            : node.props['data-filter-dimension'] === dimension,
        ),
        'onClick',
        false,
      )
      await nextTick()
      if (dimension === 'tags') {
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'input' && node.props.type === 'checkbox',
          ),
          'onChange',
          false,
        )
      } else if (dimension === 'published') {
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.props['data-calendar-date'] === '2026-09-01',
          ),
          'onClick',
          false,
        )
      } else {
        const input = findCatalogElement(view.root, (node) =>
          dimension === 'search'
            ? node.tag === 'input' && node.props.type === 'search'
            : node.props['aria-label'] === '最长时长（分钟）',
        )
        input.value = dimension === 'search' ? '晨间' : '1'
        input.dispatchListeners('input', { target: input })
      }
      await nextTick()
      const expectedCount = dimension === 'tags' ? 3 : 1
      expect(view.resultCount.value).toBe(expectedCount)
      expect(
        findCatalogElement(
          view.root,
          (node) => node.props.class === 'catalog-filters__detail-header',
        ).textContent,
      ).toContain(`筛选预览${expectedCount} / 3 首`)
      expect(view.filters.value).toEqual(initialFilters)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === '返回筛选概览'),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.resultCount.value).toBe(2)
      expect(view.filters.value).toEqual(initialFilters)
      view.unmount()
    },
  )
})

describe('CatalogTrackFilterPanel history confirmation', () => {
  it('shows only the active filter owner history, including when switching list and song contexts', async () => {
    const activeScopeId = shallowRef('catalog:drawers')
    const entries = ['catalog:drawers', 'catalog:tracks:first', 'catalog:tracks:second'].map(
      (scopeId, index) => ({
        scopeId,
        dimension: 'search' as const,
        filters: {
          ...createCatalogTrackFilterState(),
          searchFilters: [{ query: `专属历史${index}` }],
        },
      }),
    )
    const host = defineComponent({
      setup() {
        provideConfirmationDialog()
        provideCatalogFilterHistory({ load: () => entries, save: vi.fn() })
        return () =>
          h(CatalogTrackFilterPanel, {
            historyScope: activeScopeId.value,
            filterContext: activeScopeId.value === 'catalog:drawers' ? 'drawers' : 'tracks',
            filters: createCatalogTrackFilterState(),
            tagStats: [],
            resultCount: 0,
            totalCount: 0,
          })
      },
    })
    const view = mountCatalogComponent(host, {})
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === 'search'),
      'onClick',
      false,
    )
    await nextTick()
    for (const [index, entry] of entries.entries()) {
      activeScopeId.value = entry.scopeId
      // eslint-disable-next-line no-await-in-loop -- 同一个受控面板必须逐次等待 props 回流，不能并发切换归属。
      await nextTick()
      expect(view.root.textContent).toContain(`专属历史${index}`)
      for (const otherIndex of [0, 1, 2].filter((value) => value !== index))
        expect(view.root.textContent).not.toContain(`专属历史${otherIndex}`)
    }
    view.unmount()
  })
  it.each(['search', 'tags', 'duration', 'published'] as const)(
    'deletes %s history groups without restoring or modifying the active draft',
    async (dimension) => {
      const initialFilters = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '当前关键词' }],
        tags: ['当前标签'],
        publishedRanges: [{ from: '2026-04-01', to: '2026-04-02' }],
        durationRanges: [{ minMs: 240_000 }],
      }
      const filters = shallowRef<CatalogTrackFilterState>(initialFilters)
      const historicalFilters = {
        ...createCatalogTrackFilterState(),
        searchFilters: [{ query: '历史关键词' }],
        tags: ['现场', '纯音乐'],
        publishedRanges: [
          { from: '2026-01-01', to: '2026-01-02' },
          { from: '2026-02-01', to: '2026-02-02' },
        ],
        durationRanges: [{ minMs: 60_000, maxMs: 180_000 }, { maxMs: 30_000 }],
      }
      const historyEntries: CatalogFilterHistoryEntry[] = [
        { scopeId: 'test', dimension, filters: historicalFilters },
        {
          scopeId: 'test',
          dimension: dimension === 'search' ? 'tags' : 'search',
          filters: historicalFilters,
        },
      ]
      const save = vi.fn()
      const host = defineComponent({
        setup() {
          provideConfirmationDialog()
          provideCatalogFilterHistory({ load: () => historyEntries, save })
          return () =>
            h(CatalogTrackFilterPanel, {
              historyScope: 'test',
              filters: filters.value,
              'onUpdate:filters': (next: CatalogTrackFilterState) => {
                filters.value = next
              },
              tagStats: [{ name: '当前标签', count: 1 }],
              resultCount: 1,
              totalCount: 1,
            })
        },
      })
      const view = mountCatalogComponent(host, {})
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === dimension),
        'onClick',
        false,
      )
      await nextTick()
      const remove = findCatalogElement(
        view.root,
        (node) => node.props['data-history-remove'] === 0,
      )
      const restore = findCatalogElement(remove.parent!, (node) =>
        String(node.props['aria-label'] ?? '').startsWith('恢复筛选'),
      )
      expect(remove.parent).toBe(restore.parent)
      const input =
        dimension === 'search'
          ? findCatalogElement(
              view.root,
              (node) => node.tag === 'input' && node.props.type === 'search',
            )
          : findCatalogElement(view.root, (node) =>
              dimension === 'published'
                ? 'data-calendar-date' in node.props && node.props.tabindex === 0
                : 'data-editor-focus' in node.props,
            )
      input.isFocused = false
      dispatchCatalogEvent(remove, 'onClick')
      await nextTick()
      expect(save).toHaveBeenCalledOnce()
      expect(save.mock.calls[0]?.[0]).toHaveLength(1)
      expect(save.mock.calls[0]?.[0][0].dimension).toBe(historyEntries[1]!.dimension)
      expect(filters.value).toEqual(initialFilters)
      expect(view.root.textContent).toContain('暂无历史记录')
      expect(input.isFocused).toBe(true)
      // 最后确定的仍是原草稿，说明删除动作没有恢复历史或移除正在使用的条件。
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '确定',
        ),
        'onClick',
        false,
      )
      await nextTick()
      expect(filters.value).toEqual(initialFilters)
      view.unmount()
    },
  )

  it.each(['search', 'tags', 'duration', 'published'] as const)(
    'records the newly confirmed %s draft on the first confirmation',
    async (dimension) => {
      const filters = shallowRef<CatalogTrackFilterState>(createCatalogTrackFilterState())
      const save = vi.fn()
      const host = defineComponent({
        setup() {
          provideConfirmationDialog()
          provideCatalogFilterHistory({ load: () => [], save })
          return () =>
            h(CatalogTrackFilterPanel, {
              historyScope: 'test',
              filters: filters.value,
              'onUpdate:filters': (next: CatalogTrackFilterState) => {
                filters.value = next
              },
              tagStats: [{ name: '现场', count: 1 }],
              resultCount: 1,
              totalCount: 1,
            })
        },
      })
      const view = mountCatalogComponent(host, {})
      const find = (label: string) =>
        findCatalogElement(view.root, (node) => node.props['aria-label'] === label)
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === dimension),
        'onClick',
        false,
      )
      await nextTick()
      if (dimension === 'tags') {
        dispatchCatalogEvent(
          findCatalogElement(
            view.root,
            (node) => node.tag === 'input' && node.props.type === 'checkbox',
          ),
          'onChange',
          false,
        )
      } else if (dimension === 'published') {
        dispatchCatalogEvent(find('设置结束日期'), 'onClick', false)
      } else {
        const input =
          dimension === 'duration'
            ? find('最短时长（分钟）')
            : findCatalogElement(
                view.root,
                (node) => node.tag === 'input' && node.props.type === 'search',
              )
        input.value = dimension === 'duration' ? '1.5' : '首次搜索'
        input.dispatchListeners('input', { target: input })
      }
      await nextTick()
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '确定',
        ),
        'onClick',
        false,
      )
      await nextTick()
      expect(save).toHaveBeenCalledOnce()
      expect(save).toHaveBeenCalledWith([{ scopeId: 'test', dimension, filters: filters.value }])
      view.unmount()
    },
  )
})
