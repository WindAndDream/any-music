import { createCatalogTrackFilterState, provideCatalogFilterHistory } from '@any-music/ui/catalog'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import { createEditingSession } from '@any-music/ui/library'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive, shallowRef } from 'vue'

import StudioFilters from '../../../src/components/library/StudioFilters.vue'
import { findStudioNode, invokeStudio, mountStudio } from '../../helpers/test-renderer'

vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      emits: ['afterLeave'],
      setup(props, { slots, emit }) {
        vue.watch(
          () => props.open,
          (open) => {
            if (!open) emit('afterLeave')
          },
        )
        return () =>
          props.open
            ? vue.h('section', { role: 'dialog', 'aria-label': props.title }, [
                slots.default?.(),
                slots.footer?.(),
              ])
            : null
      },
    }),
  }
})

describe('StudioFilters', () => {
  it.each(['queue:tracks', 'favorites:tracks', 'downloads:tracks', 'history:tracks'])(
    'offers song tags and hides platform controls in a scoped %s list',
    async (scope) => {
      const editing = createEditingSession()
      const platformScoped = shallowRef(true)
      const state = shallowReactive({
        tracks: [
          {
            id: 'one',
            title: 'One',
            artists: [],
            source: { pluginId: 'a', resourceId: '1', mediaKind: 'audio' as const },
          },
        ],
        filters: createCatalogTrackFilterState(),
        filterDraft: createCatalogTrackFilterState(),
        platformNames: new Map([
          ['a', '平台甲'],
          ['b', '平台乙'],
        ]),
        customTagsByTrackId: new Map([
          ['one', ['通勤']],
          ['unrelated', ['其他列表']],
        ]),
      })
      const applyFilters = vi.fn()
      const view = mountStudio(
        defineComponent({
          setup() {
            provideCatalogFilterHistory({ load: () => [], save: vi.fn() })
            return () =>
              h(StudioFilters, {
                state,
                scope,
                editing,
                platformScoped: platformScoped.value,
                ...(scope === 'history:tracks'
                  ? { context: 'favorites' as const, historyRecords: true }
                  : {}),
                actions: {
                  setFilterDraft: (value: CatalogTrackFilterState | null) => {
                    if (value) state.filterDraft = value
                  },
                  applyFilters,
                  cancelFilters: vi.fn(),
                },
              })
          },
        }),
        {},
      )
      try {
        expect(view.root.textContent).toContain('标签筛选')
        expect(view.root.textContent).not.toContain('平台筛选')
        expect(view.root.textContent).not.toContain('其他列表')
        invokeStudio(
          findStudioNode(
            view.root,
            (node) =>
              node.tag === 'input' &&
              node.props.type === 'checkbox' &&
              node.parent?.textContent.includes('通勤') === true,
          ),
          'onChange',
        )
        await nextTick()
        expect(state.filterDraft.tags).toEqual(['通勤'])
        invokeStudio(
          findStudioNode(
            view.root,
            (node) => node.tag === 'button' && node.textContent === '应用筛选',
          ),
          'onClick',
        )
        expect(applyFilters).toHaveBeenCalledOnce()
        platformScoped.value = false
        await nextTick()
        expect(view.root.textContent).toContain('平台筛选')
      } finally {
        view.unmount()
        editing.dispose()
      }
    },
  )

  it('shows every saved platform by name before restoring the platform filter', async () => {
    const scope = 'catalog:drawers'
    const initial: CatalogTrackFilterState = {
      ...createCatalogTrackFilterState(),
      searchFilters: [{ query: '关键词' }],
    }
    const state = shallowReactive({
      tracks: [],
      filters: initial,
      filterDraft: initial,
      platformNames: new Map([
        ['source-a', '甲平台'],
        ['source-b', '乙平台'],
        ['source-c', '丙平台'],
      ]),
      customTagsByTrackId: new Map(),
    })
    const view = mountStudio(
      defineComponent({
        setup() {
          provideCatalogFilterHistory({
            load: () => [
              {
                scopeId: scope,
                dimension: 'platforms',
                filters: {
                  ...createCatalogTrackFilterState(),
                  platformIds: ['source-a', 'source-b', 'source-c'],
                },
              },
            ],
            save: vi.fn(),
          })
          return () =>
            h(StudioFilters, {
              state,
              scope,
              context: 'drawers',
              actions: {
                setFilterDraft: (value) => {
                  if (value) state.filterDraft = value
                },
                applyFilters: vi.fn(),
                cancelFilters: vi.fn(),
              },
            })
        },
      }),
      {},
    )
    try {
      const record = findStudioNode(view.root, (node) => node.props['aria-haspopup'] === 'dialog')
      expect(record.props['aria-label']).toBe('查看平台筛选历史 甲平台；乙平台；丙平台')
      invokeStudio(record, 'onClick')
      await nextTick()
      const dialog = findStudioNode(view.root, (node) => node.props.role === 'dialog')
      for (const name of state.platformNames.values()) expect(dialog.textContent).toContain(name)
      expect(state.filterDraft).toEqual(initial)
      invokeStudio(
        findStudioNode(dialog, (node) => node.tag === 'button' && node.textContent === '恢复筛选'),
        'onClick',
      )
      await nextTick()
      expect(state.filterDraft.platformIds).toEqual(['source-a', 'source-b', 'source-c'])
      expect(state.filterDraft.searchFilters).toEqual(initial.searchFilters)
      expect(() => findStudioNode(view.root, (node) => node.props.role === 'dialog')).toThrow()
    } finally {
      view.unmount()
    }
  })
})
