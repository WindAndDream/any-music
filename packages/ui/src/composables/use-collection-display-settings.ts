import { toAppErrorState } from '@any-music/core'
import { computed, shallowRef, onScopeDispose } from 'vue'
import type { ShallowRef } from 'vue'

import { getActionSuccessMessage } from '../product/action-feedback'
import { COLLECTION_DISPLAY_GROUPS } from '../product/track-display-preferences'
import type {
  CollectionDisplayDefaults,
  CollectionDisplayId,
  CollectionDisplayRegion,
  CollectionDisplayPreferences,
  SetCollectionDisplayDefault,
} from '../product/track-display-preferences'
import { editingStateKey, useEditingSession } from './use-editing-session'
import { useSettingsFeedback } from './use-settings-feedback'

/** Settings navigation survives presentation replacement; saved defaults stay host-owned. */
export function useCollectionDisplaySettings(props: {
  readonly settings?: CollectionDisplayDefaults
  readonly suspended?: boolean
  readonly setDefault?: SetCollectionDisplayDefault
}) {
  const session = useEditingSession('settings')
  let active = true
  onScopeDispose(() => {
    active = false
  })
  const feedback = useSettingsFeedback()
  const expanded = session.state(expandedKey, () => shallowRef<CollectionDisplayId | null>(null))
  const selected = session.state(selectedKey, () => shallowRef<Selection | null>(null))
  const open = session.state(openKey, () => shallowRef(false))
  const region = computed(() =>
    COLLECTION_DISPLAY_GROUPS.find(
      (group) => group.id === selected.value?.collection,
    )?.regions.find((entry) => entry.id === selected.value?.region),
  )
  const value = computed(() => get(selected.value?.collection, selected.value?.region))
  const layoutSections = computed(() => [
    {
      id: 'layout',
      label: '排列方式',
      description: '选择此板块的默认排列方式。',
      value: value.value.layout ?? region.value?.layoutOptions?.[0]?.id ?? '',
      options: region.value?.layoutOptions ?? [],
    },
  ])
  function selectLayout(_section: string, id: string) {
    const option = region.value?.layoutOptions?.find((entry) => entry.id === id)
    if (option) update({ layout: option.id })
  }
  function get(
    collection?: CollectionDisplayId,
    regionId?: CollectionDisplayRegion,
  ): CollectionDisplayPreferences {
    return {
      displayMode: 'standard',
      mobileColumns: 1,
      itemStyle: 'minimal',
      ...(collection && regionId ? props.settings?.[collection]?.[regionId] : {}),
    }
  }
  function select(collection: CollectionDisplayId, regionId: CollectionDisplayRegion) {
    if (!active || !session.active || props.suspended) return
    selected.value = { collection, region: regionId }
    open.value = true
  }
  function update(patch: Partial<CollectionDisplayPreferences>) {
    if (
      !active ||
      !session.active ||
      !open.value ||
      props.suspended ||
      !selected.value ||
      !props.setDefault
    )
      return
    try {
      const error = props.setDefault(selected.value.collection, selected.value.region, patch)
      feedback(
        error
          ? { status: 'error', error }
          : { status: 'success', message: getActionSuccessMessage('displaySettings') },
      )
    } catch (cause) {
      feedback({
        status: 'error',
        error: toAppErrorState(cause, 'storage-write-failed', '展示方式保存失败。'),
      })
    }
  }
  return {
    expanded,
    selected,
    region,
    value,
    open,
    get,
    select,
    update,
    layoutSections,
    selectLayout,
  }
}
type Selection = { collection: CollectionDisplayId; region: CollectionDisplayRegion }
const expandedKey = editingStateKey<ShallowRef<CollectionDisplayId | null>>(
  'settings:display:expanded',
)
const selectedKey = editingStateKey<ShallowRef<Selection | null>>('settings:display:selected')
const openKey = editingStateKey<ShallowRef<boolean>>('settings:display:open')
