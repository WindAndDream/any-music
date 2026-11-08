import type { LibraryTrackRecord } from '@any-music/core'
import { UI_CONTRIBUTIONS } from '@any-music/ui'
import { describe, expect, it } from 'vitest'
import { createRenderer, defineComponent, h, shallowRef } from 'vue'

import { useMaterialLibraryFilters } from '../../src/vue/use-material-library-filters'

describe('material tag projection suspension', () => {
  it('retains dormant conditions across disable/re-enable without activating them automatically', () => {
    const enabled = shallowRef(true)
    const records: LibraryTrackRecord[] = [
      {
        track: {
          id: 'one',
          title: '原曲',
          sourceTags: ['来源标签'],
          artists: [],
          source: { pluginId: 'source', resourceId: 'one', mediaKind: 'audio' },
        },
        customTags: ['用户标签'],
        addedAtMs: 1,
        updatedAtMs: 1,
      },
    ]
    let filters!: ReturnType<typeof useMaterialLibraryFilters>
    const renderer = createRenderer<object, object>({
      patchProp() {},
      insert() {},
      remove() {},
      createElement: () => ({}),
      createText: () => ({}),
      createComment: () => ({}),
      setText() {},
      setElementText() {},
      parentNode: () => null,
      nextSibling: () => null,
    })
    const app = renderer.createApp(
      defineComponent({
        setup() {
          filters = useMaterialLibraryFilters(
            () => records,
            () => undefined,
            () => [],
          )
          return () => h('div')
        },
      }),
    )
    app.provide(UI_CONTRIBUTIONS, {
      resolve: () =>
        enabled.value
          ? [
              {
                id: 'feature.tags/filter',
                implementationId: 'tag-filter',
                revision: 1,
                viewRevision: 1,
                contextKey: '',
              },
            ]
          : [],
      accepts: () => enabled.value,
    })
    app.mount({})
    filters.filters.value = { ...filters.filters.value, membership: 'all', tag: '不存在' }
    expect(filters.visibleRecords.value).toEqual([])
    enabled.value = false
    expect(filters.visibleRecords.value).toEqual(records)
    expect(filters.filters.value.tagsDormant).toBe(true)
    filters.filters.value = { ...filters.filters.value, query: '用户标签' }
    expect(filters.visibleRecords.value).toEqual([])
    filters.filters.value = { ...filters.filters.value, query: '来源标签' }
    expect(filters.visibleRecords.value).toEqual(records)
    enabled.value = true
    expect(filters.visibleRecords.value).toEqual(records)
    filters.filters.value = { ...filters.filters.value, tagsDormant: false }
    expect(filters.visibleRecords.value).toEqual([])
    app.unmount()
  })
})
