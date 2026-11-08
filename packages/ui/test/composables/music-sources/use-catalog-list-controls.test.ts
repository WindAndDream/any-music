import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'

import { useCatalogListControls } from '../../../src/composables/music-sources/use-catalog-list-controls'

interface Item {
  id: string
  name: string
}

describe('useCatalogListControls', () => {
  it('filters normalized names and selects only the visible items', () => {
    const items = shallowRef<readonly Item[]>([
      { id: '1', name: '晨间音乐' },
      { id: '2', name: '夜晚音乐' },
      { id: '3', name: '播客' },
    ])
    const controls = useCatalogListControls({
      items,
      getId: (item) => item.id,
      getName: (item) => item.name,
    })

    controls.query.value = ' 音乐 '
    expect(controls.visibleItems.value.map((item) => item.id)).toEqual(['1', '2'])

    controls.toggleAllVisible()
    expect([...controls.selectedIds.value]).toEqual(['1', '2'])
    expect(controls.areAllVisibleSelected.value).toBe(true)

    controls.query.value = '晨间'
    controls.toggleAllVisible()
    expect([...controls.selectedIds.value]).toEqual(['2'])
  })

  it('prunes selections when source items are removed', () => {
    const items = shallowRef<readonly Item[]>([
      { id: '1', name: '一' },
      { id: '2', name: '二' },
    ])
    const controls = useCatalogListControls({
      items,
      getId: (item) => item.id,
      getName: (item) => item.name,
    })
    controls.toggleAllVisible()

    items.value = [{ id: '2', name: '二' }]

    expect([...controls.selectedIds.value]).toEqual(['2'])
  })
})
