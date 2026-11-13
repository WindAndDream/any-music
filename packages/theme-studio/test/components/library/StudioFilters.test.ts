import { createCatalogTrackFilterState, provideCatalogFilterHistory } from '@any-music/ui/catalog'
import type { CatalogTrackFilterState } from '@any-music/ui/catalog'
import { createEditingSession } from '@any-music/ui/library'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive, shallowRef } from 'vue'

import StudioFilters from '../../../src/components/library/StudioFilters.vue'
import { findStudioNode, invokeStudio, mountStudio } from '../../helpers/test-renderer'

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
})
