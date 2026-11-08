import {
  createCatalogTrackFilterState,
  createEditingSession,
  provideEditingSession,
  provideCatalogFilterHistory,
  provideConfirmationDialog,
} from '@any-music/ui'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'

import ClassicTrackFilters from '../../../src/components/library/ClassicTrackFilters.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

vi.mock('vue', async (load) => {
  const vue = await load<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup(_props, { slots, attrs }) {
        let previousKey: unknown
        return () => {
          const children = slots.default?.()
          const key = children?.[0]?.key
          if (previousKey !== undefined && key !== previousKey)
            (attrs.onAfterLeave as (() => void) | undefined)?.()
          previousKey = key
          return children
        }
      },
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const { defineComponent: defineOverlay, h: renderOverlay } = await import('vue')
  return {
    default: defineOverlay({
      props: ['open'],
      setup:
        (props, { slots }) =>
        () =>
          props.open ? renderOverlay('section', [slots.default?.(), slots.footer?.()]) : null,
    }),
  }
})
beforeEach(() => {
  vi.stubGlobal('Document', CatalogTestElement)
  vi.stubGlobal('ShadowRoot', CatalogTestElement)
})
afterEach(() => vi.unstubAllGlobals())

const createTrack = (id: string, pluginId: string) => ({
  id,
  title: id,
  artists: [],
  source: { pluginId, resourceId: id, mediaKind: 'audio' as const },
})

describe('ClassicTrackFilters', () => {
  it.each(['queue:tracks', 'favorites:tracks', 'downloads:tracks'])(
    'edits and previews tags within the current platform in %s',
    async (scope) => {
      const filters = shallowRef(createCatalogTrackFilterState())
      const applied = vi.fn()
      const platformId = shallowRef<string | undefined>('a')
      const host = defineComponent({
        setup() {
          provideConfirmationDialog()
          provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
          return () =>
            h(ClassicTrackFilters, {
              scope,
              platformId: platformId.value,
              state: {
                tracks: [
                  createTrack('one', 'a'),
                  createTrack('two', 'a'),
                  createTrack('three', 'b'),
                ],
                platformNames: new Map([
                  ['a', '平台甲'],
                  ['b', '平台乙'],
                ]),
                addedAtMsByTrackId: new Map(),
                customNamesByTrackId: new Map(),
                customTagsByTrackId: new Map([
                  ['one', ['通勤']],
                  ['two', ['放松']],
                  ['three', ['其他平台']],
                ]),
                filters: createCatalogTrackFilterState(),
                filterDraft: filters.value,
              },
              actions: {
                setFilterDraft: (value: CatalogTrackFilterState | null) => {
                  if (value) filters.value = value
                },
                applyFilters: () => applied(filters.value),
                cancelFilters: vi.fn(),
              },
            })
        },
      })
      const view = mountCatalogComponent(host, {})
      expect(view.root.textContent).not.toContain('平台筛选')
      dispatchCatalogEvent(
        findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === 'tags'),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.root.textContent).toContain('通勤1 首')
      expect(view.root.textContent).not.toContain('其他平台')
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) =>
            node.tag === 'input' &&
            node.props.type === 'checkbox' &&
            node.parent?.textContent.includes('通勤') === true,
        ),
        'onChange',
        false,
      )
      await nextTick()
      expect(view.root.textContent).toContain('1 / 2 首')
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '确定',
        ),
        'onClick',
        false,
      )
      await nextTick()
      expect(filters.value.tags).toEqual(['通勤'])
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '应用筛选',
        ),
        'onClick',
        false,
      )
      expect(applied).toHaveBeenCalledWith(expect.objectContaining({ tags: ['通勤'] }))
      platformId.value = undefined
      await nextTick()
      expect(view.root.textContent).toContain('平台筛选')
      view.unmount()
    },
  )
  it('keeps only the detail footer when a retained filter is closed and reopened', async () => {
    const open = shallowRef(true)
    const editing = createEditingSession()
    const host = defineComponent({
      setup() {
        provideEditingSession(editing)
        provideConfirmationDialog()
        provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
        return () =>
          h(ClassicTrackFilters, {
            scope: 'queue',
            state: {
              tracks: [],
              platformNames: new Map(),
              addedAtMsByTrackId: new Map(),
              customNamesByTrackId: new Map(),
              customTagsByTrackId: new Map(),
              filters: createCatalogTrackFilterState(),
              filterDraft: open.value ? createCatalogTrackFilterState() : null,
            },
            actions: {
              setFilterDraft: vi.fn(),
              cancelFilters: () => {
                open.value = false
              },
              applyFilters: vi.fn(),
            },
          })
      },
    })
    const view = mountCatalogComponent(host, {})
    dispatchCatalogEvent(
      findCatalogElement(view.root, (node) => node.props['data-filter-dimension'] === 'platforms'),
      'onClick',
      false,
    )
    await nextTick()
    expect(view.root.textContent).not.toContain('应用筛选')
    open.value = false
    await nextTick()
    open.value = true
    await nextTick()
    expect(view.root.textContent).toContain('返回')
    expect(view.root.textContent).toContain('确定')
    expect(view.root.textContent).not.toContain('应用筛选')
    view.unmount()
    editing.dispose()
  })

  it.each([
    ['queue', '添加时间'],
    ['favorites', '喜欢时间'],
    ['downloads', '任务日期'],
  ])('previews %s dates using the collection timestamp', async (scope, label) => {
    const track = {
      id: 'song',
      title: '歌曲',
      artists: [],
      publishedAtMs: new Date('2020-01-01').getTime(),
      source: { pluginId: 'a', resourceId: '1', mediaKind: 'audio' as const },
    }
    const filters = {
      ...createCatalogTrackFilterState(),
      publishedRanges: [{ from: '2026-10-01', to: '2026-10-31' }],
    }
    const host = defineComponent({
      setup() {
        provideConfirmationDialog()
        provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
        return () =>
          h(ClassicTrackFilters, {
            scope,
            state: {
              tracks: [track],
              platformNames: new Map(),
              addedAtMsByTrackId: new Map([['song', new Date('2026-10-15T12:00:00').getTime()]]),
              customNamesByTrackId: new Map(),
              customTagsByTrackId: new Map(),
              filters,
              filterDraft: filters,
            },
            actions: { setFilterDraft: vi.fn(), cancelFilters: vi.fn(), applyFilters: vi.fn() },
          })
      },
    })
    const view = mountCatalogComponent(host, {})
    expect(view.root.textContent).toContain(label)
    expect(view.root.textContent).toContain('匹配 1 / 1 首')
    view.unmount()
  })

  it.each(['queue', 'favorites', 'downloads'])(
    'offers platforms represented in %s tracks',
    async (scope) => {
      const track = (id: string, pluginId: string) => ({
        id,
        title: id,
        artists: [],
        source: { pluginId, resourceId: id, mediaKind: 'audio' as const },
      })
      const host = defineComponent({
        setup() {
          provideConfirmationDialog()
          provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
          return () =>
            h(ClassicTrackFilters, {
              scope,
              state: {
                tracks: [track('1', 'a'), track('2', 'a'), track('3', 'b')],
                platformNames: new Map([['a', '平台甲']]),
                addedAtMsByTrackId: new Map(),
                customNamesByTrackId: new Map(),
                customTagsByTrackId: new Map(),
                filters: createCatalogTrackFilterState(),
                filterDraft: createCatalogTrackFilterState(),
              },
              actions: { setFilterDraft: vi.fn(), cancelFilters: vi.fn(), applyFilters: vi.fn() },
            })
        },
      })
      const view = mountCatalogComponent(host, {})
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.props['data-filter-dimension'] === 'platforms',
        ),
        'onClick',
        false,
      )
      await nextTick()
      expect(view.root.textContent).toContain('平台甲2 首')
      expect(view.root.textContent).toContain('b1 首')
      view.unmount()
    },
  )
})
