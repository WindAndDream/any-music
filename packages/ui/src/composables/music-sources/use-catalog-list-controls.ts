import type { ShallowRef } from 'vue'
import { computed, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { editingStateKey, useEditingSession, type EditingSession } from '../use-editing-session'

interface UseCatalogListControlsOptions<Item> {
  editing?: EditingSession
  items: MaybeRefOrGetter<readonly Item[]>
  getId: (item: Item) => string
  getName: (item: Item) => string
}

/** 名称筛选与多选行为在抽屉层、歌曲层保持一致；“全选”只作用于当前筛选结果。 */
export function useCatalogListControls<Item>(options: UseCatalogListControlsOptions<Item>) {
  const query = (options.editing ?? useEditingSession()).state(queryKey, () => shallowRef(''))
  const selectedIds = (options.editing ?? useEditingSession()).state(selectedIdsKey, () =>
    shallowRef<ReadonlySet<string>>(new Set()),
  )
  const visibleItems = computed(() => {
    const searchKey = createSearchKey(query.value)
    if (!searchKey) return toValue(options.items)
    return toValue(options.items).filter((item) => {
      return createSearchKey(options.getName(item)).includes(searchKey)
    })
  })
  const visibleIds = computed(() => visibleItems.value.map(options.getId))
  const selectedCount = computed(() => selectedIds.value.size)
  const areAllVisibleSelected = computed(
    () => visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.has(id)),
  )
  const areSomeVisibleSelected = computed(
    () => !areAllVisibleSelected.value && visibleIds.value.some((id) => selectedIds.value.has(id)),
  )

  watch(
    () => toValue(options.items),
    (items) => {
      const availableIds = new Set(items.map(options.getId))
      const nextIds = new Set([...selectedIds.value].filter((id) => availableIds.has(id)))
      if (nextIds.size !== selectedIds.value.size) selectedIds.value = nextIds
    },
    { flush: 'sync' },
  )

  function toggleItem(itemId: string): void {
    const nextIds = new Set(selectedIds.value)
    if (nextIds.has(itemId)) nextIds.delete(itemId)
    else nextIds.add(itemId)
    selectedIds.value = nextIds
  }

  function toggleAllVisible(): void {
    const nextIds = new Set(selectedIds.value)
    if (areAllVisibleSelected.value) {
      for (const itemId of visibleIds.value) nextIds.delete(itemId)
    } else {
      for (const itemId of visibleIds.value) nextIds.add(itemId)
    }
    selectedIds.value = nextIds
  }

  function clearSelection(): void {
    selectedIds.value = new Set()
  }

  return {
    query,
    selectedIds: readonly(selectedIds),
    selectedCount,
    visibleItems,
    areAllVisibleSelected,
    areSomeVisibleSelected,
    toggleItem,
    toggleAllVisible,
    clearSelection,
  }
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

const queryKey = editingStateKey<ShallowRef<string>>(
  'composables/music-sources/use-catalog-list-controls.ts:query',
)
const selectedIdsKey = editingStateKey<ShallowRef<ReadonlySet<string>>>(
  'composables/music-sources/use-catalog-list-controls.ts:selectedIds',
)
