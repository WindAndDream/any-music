import { usePluginCenterView } from '@any-music/ui'
import {
  editingStateKey,
  useActionFeedback,
  useCatalogListControls,
  useEditingSession,
} from '@any-music/ui/catalog'
import type {
  UiPluginCenterItem,
  UiPluginDevelopmentStatus,
  UiThemeFeatureMap,
} from '@any-music/ui/theme'
import { computed, shallowRef, watch } from 'vue'
import type { ShallowRef } from 'vue'

import { usePresentationActivity } from './use-presentation-activity'

export interface PluginFilterState {
  keyword: string
  category: readonly string[]
  status: readonly ('enabled' | 'disabled' | 'error')[]
  developmentStatus: readonly UiPluginDevelopmentStatus[]
}
export const createPluginFilters = (): PluginFilterState => ({
  keyword: '',
  category: [],
  status: [],
  developmentStatus: [],
})
const controlsKey = editingStateKey<{
  filters: ShallowRef<PluginFilterState>
  draft: ShallowRef<PluginFilterState | null>
  operatorOpen: ShallowRef<boolean>
}>('classic-plugin-controls')

function matches(item: UiPluginCenterItem, filters: PluginFilterState): boolean {
  const keyword = filters.keyword.normalize('NFKC').trim().toLocaleLowerCase()
  return (
    (!keyword ||
      `${item.name} ${item.description} ${item.publisher ?? ''}`
        .normalize('NFKC')
        .toLocaleLowerCase()
        .includes(keyword)) &&
    (filters.category.length === 0 || filters.category.includes(item.category)) &&
    (filters.developmentStatus.length === 0 ||
      (item.origin === 'builtin' &&
        filters.developmentStatus.includes(item.developmentStatus ?? 'stable'))) &&
    (filters.status.length === 0 ||
      filters.status.some(
        (status) =>
          (status === 'enabled' && item.enabled) ||
          (status === 'disabled' && !item.enabled) ||
          (status === 'error' &&
            (item.status.status === 'error' || item.status.status === 'invalid')),
      ))
  )
}

/** Browsing and selection stay in the renderer; all mutations use named host actions. */
export function useClassicPlugins(props: Readonly<{ feature: UiThemeFeatureMap['plugins'] }>) {
  const view = usePluginCenterView(
    () => props.feature.state.items,
    () => props.feature.state.defaultDisplay,
  )
  const editing = useEditingSession('plugins')
  const { filters, draft, operatorOpen } = editing.state(controlsKey, () => ({
    filters: shallowRef(createPluginFilters()),
    draft: shallowRef<PluginFilterState | null>(null),
    operatorOpen: shallowRef(false),
  }))
  const displayOpen = shallowRef(false)
  const detailsId = shallowRef<string>()
  const details = computed(() =>
    props.feature.state.items.find((item) => item.id === detailsId.value),
  )
  watch(details, (item) => {
    if (!item) detailsId.value = undefined
  })
  const batchBusy = shallowRef(false)
  const modalOpen = computed(
    () => displayOpen.value || draft.value !== null || Boolean(details.value),
  )
  const disabled = computed(
    () =>
      props.feature.availability.status !== 'available' ||
      props.feature.state.busy ||
      batchBusy.value,
  )
  const categories = computed(() => [
    ...new Set(props.feature.state.items.map((item) => item.category)),
  ])
  const visible = computed(() => view.visible.value.filter((item) => matches(item, filters.value)))
  const preview = computed(() =>
    view.visible.value.filter((item) => matches(item, draft.value ?? filters.value)),
  )
  const controls = useCatalogListControls({
    editing: editing.scope('classic-selection'),
    items: visible,
    getId: (item) => item.id,
    getName: (item) => item.name,
  })
  const selected = computed(() =>
    visible.value.filter((item) => controls.selectedIds.value.has(item.id)),
  )
  const selectedBuiltins = computed(() =>
    selected.value.filter((item) => item.origin === 'builtin'),
  )
  const canEnable = computed(() => selectedBuiltins.value.some((item) => !item.enabled))
  const canDisable = computed(() => selectedBuiltins.value.some((item) => item.enabled))
  const activity = usePresentationActivity()
  const feedback = useActionFeedback()

  watch(operatorOpen, (open) => {
    if (!open) controls.clearSelection()
  })
  function applyFilters(): void {
    if (!draft.value || disabled.value) return
    filters.value = { ...draft.value }
    draft.value = null
  }
  async function setSelectedEnabled(enabled: boolean): Promise<void> {
    if (disabled.value) return
    const ids = selectedBuiltins.value
      .filter((item) => item.enabled !== enabled)
      .map((item) => item.id)
    if (!ids.length) return
    const current = activity.checkpoint()
    batchBusy.value = true
    try {
      // Serialize requests so the host can enforce the last-enabled-source rule after each write.
      for (const id of ids) {
        if (!current() || props.feature.availability.status !== 'available') break
        const item = props.feature.state.items.find((entry) => entry.id === id)
        if (item?.origin === 'builtin' && item.enabled !== enabled)
          // eslint-disable-next-line no-await-in-loop -- Recheck host policy after each mutation.
          await props.feature.actions.setEnabled(id, enabled)
      }
    } catch (cause) {
      if (current())
        feedback({
          status: 'error',
          message: cause instanceof Error ? cause.message : '插件状态更新失败，请重试。',
        })
    } finally {
      batchBusy.value = false
    }
  }
  return {
    ...view,
    visible,
    filters,
    draft,
    preview,
    categories,
    controls,
    selected,
    displayOpen,
    detailsId,
    details,
    operatorOpen,
    modalOpen,
    disabled,
    canEnable,
    canDisable,
    applyFilters,
    setSelectedEnabled,
  }
}
