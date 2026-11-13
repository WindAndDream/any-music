import { PLUGIN_DEVELOPMENT_STATUS_LABELS } from '@any-music/ui'
import { useBackHandler } from '@any-music/ui/catalog'
import type { UiPluginDevelopmentStatus } from '@any-music/ui/theme'
import { computed, nextTick, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { createPluginFilters } from './use-classic-plugins'
import type { PluginFilterState } from './use-classic-plugins'

type Dimension = keyof PluginFilterState

function leave(element: Element): void {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}

/** Dimension edits stay in the draft; Back restores that dimension and Apply commits outside. */
export function usePluginFilterPanel(
  draft: Ref<PluginFilterState | null>,
  categories: () => readonly string[],
  overview: Readonly<Ref<HTMLElement | null>>,
) {
  const active = shallowRef<Dimension | null>(null)
  const detailOpen = shallowRef(false)
  const previous = shallowRef<Dimension | null>(null)
  const snapshot = shallowRef<PluginFilterState | null>(null)
  const statusOptions = [
    { value: 'enabled', label: '已启用', description: '只显示当前启用的插件' },
    { value: 'disabled', label: '未启用', description: '显示已停用或已撤销的插件' },
    { value: 'error', label: '加载失败', description: '查找需要重试或处理的插件' },
  ] as const
  const categoryOptions = computed(() =>
    categories().map((category) => ({
      value: category,
      label: category,
      description: `只显示${category}插件`,
    })),
  )
  const developmentStatusOptions = (
    Object.keys(PLUGIN_DEVELOPMENT_STATUS_LABELS) as UiPluginDevelopmentStatus[]
  ).map((value) => ({
    value,
    label: PLUGIN_DEVELOPMENT_STATUS_LABELS[value],
    description: `只显示开发者标记为“${PLUGIN_DEVELOPMENT_STATUS_LABELS[value]}”的内置插件`,
  }))
  const dimensions = computed(() => [
    {
      id: 'keyword' as const,
      label: '关键词',
      description: '搜索插件名称、描述或发布者',
      icon: 'search' as const,
      labels: draft.value?.keyword.trim() ? [draft.value.keyword.trim()] : [],
    },
    {
      id: 'category' as const,
      label: '插件类型',
      description: '按插件提供的功能分类筛选',
      icon: 'plugin' as const,
      labels: draft.value?.category ?? [],
    },
    {
      id: 'status' as const,
      label: '插件状态',
      description: '按启用状态或加载结果筛选',
      icon: 'check' as const,
      labels:
        draft.value?.status.map(
          (status) => statusOptions.find(({ value }) => value === status)!.label,
        ) ?? [],
    },
    {
      id: 'developmentStatus' as const,
      label: '开发者状态',
      description: '按内置插件的开发与维护状态筛选',
      icon: 'plugin' as const,
      labels:
        draft.value?.developmentStatus.map((status) => PLUGIN_DEVELOPMENT_STATUS_LABELS[status]) ??
        [],
    },
  ])
  const groups = computed(() =>
    dimensions.value.map(({ id, label, labels }) => ({ dimension: id, title: label, labels })),
  )
  const current = computed(() => dimensions.value.find(({ id }) => id === active.value)!)
  watch(
    () => draft.value === null,
    () => {
      active.value = null
      detailOpen.value = false
      snapshot.value = null
    },
  )
  function set<Key extends Dimension>(key: Key, value: PluginFilterState[Key]): void {
    if (draft.value) draft.value = { ...draft.value, [key]: value }
  }
  function edit(dimension: Dimension): void {
    if (!draft.value) return
    snapshot.value = { ...draft.value }
    previous.value = dimension
    active.value = dimension
  }
  function finish(): void {
    active.value = null
    snapshot.value = null
  }
  function back(): void {
    if (active.value && snapshot.value) set(active.value, snapshot.value[active.value])
    finish()
  }
  function remove(dimension: Dimension, index: number): void {
    if (!draft.value) return
    if (dimension === 'keyword') set('keyword', '')
    else if (dimension === 'category')
      set(
        'category',
        draft.value.category.filter((_, entryIndex) => entryIndex !== index),
      )
    else if (dimension === 'status')
      set(
        'status',
        draft.value.status.filter((_, entryIndex) => entryIndex !== index),
      )
    else
      set(
        'developmentStatus',
        draft.value.developmentStatus.filter((_, entryIndex) => entryIndex !== index),
      )
  }
  function clear(): void {
    draft.value = createPluginFilters()
  }
  function afterLeave(): void {
    // Match Discover: resize the sheet footer only after the outgoing view is gone.
    detailOpen.value = active.value !== null
  }
  async function focusView(element: Element): Promise<void> {
    await nextTick()
    if (active.value)
      element.querySelector<HTMLElement>('[data-editor-focus]')?.focus({ preventScroll: true })
    else
      overview.value
        ?.querySelector<HTMLElement>(`[data-filter-dimension="${previous.value}"]`)
        ?.focus({ preventScroll: true })
  }
  useBackHandler({ active: () => draft.value !== null && active.value !== null, handle: back })
  return {
    active,
    detailOpen,
    dimensions,
    groups,
    current,
    categoryOptions,
    statusOptions,
    developmentStatusOptions,
    set,
    edit,
    back,
    finish,
    remove,
    clear,
    leave,
    afterLeave,
    focusView,
  }
}
