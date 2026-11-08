import { computed, shallowRef, toValue } from 'vue'
import type { MaybeRefOrGetter, ShallowRef } from 'vue'

import type { UiPluginCenterItem } from '../../product/theme-features'
import { editingStateKey, useEditingSession } from '../use-editing-session'

export type PluginCenterFilter = 'all' | 'builtin' | 'external'
export type PluginCenterDisplay = 'grid' | 'list'
const viewKey = editingStateKey<{
  filter: ShallowRef<PluginCenterFilter>
  display: ShallowRef<PluginCenterDisplay | undefined>
}>('plugin-center-view')

/** Retain browsing preferences across page and complete-theme replacement. */
export function usePluginCenterView(
  items: MaybeRefOrGetter<readonly UiPluginCenterItem[]>,
  defaultDisplay?: MaybeRefOrGetter<PluginCenterDisplay | undefined>,
) {
  const view = useEditingSession('plugins').state(viewKey, () => ({
    filter: shallowRef<PluginCenterFilter>('all'),
    display: shallowRef<PluginCenterDisplay>(),
  }))
  const counts = computed(() => {
    const entries = toValue(items)
    const builtin = entries.filter((item) => item.origin === 'builtin').length
    return { all: entries.length, builtin, external: entries.length - builtin }
  })
  const visible = computed(() =>
    toValue(items).filter(
      (item) => view.filter.value === 'all' || item.origin === view.filter.value,
    ),
  )
  const display = computed({
    get: () => view.display.value ?? toValue(defaultDisplay) ?? 'grid',
    set: (value: PluginCenterDisplay) => {
      view.display.value = value
    },
  })
  return { ...view, display, counts, visible }
}
