import { useConfirmAction } from '@any-music/ui'
import { useBackHandler } from '@any-music/ui/catalog'
import type { TagManagementFilterState, TagManagementPresentation } from '@any-music/ui/theme'
import { computed, nextTick, onScopeDispose, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

type Dimension = keyof TagManagementFilterState

function leave(element: Element): void {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}

/** Theme navigation edits the plugin-owned draft; matching and final commit stay with the plugin. */
export function useTagManagementFilterPanel(
  props: Readonly<{ editor: TagManagementPresentation }>,
  overview: Readonly<Ref<HTMLElement | null>>,
) {
  const confirm = useConfirmAction()
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })
  const active = shallowRef<Dimension | null>(null)
  const detailOpen = shallowRef(false)
  const previous = shallowRef<Dimension | null>(null)
  const snapshot = shallowRef<TagManagementFilterState | null>(null)
  const draft = computed(() => props.editor.state.filterDraft)
  const subject = computed(() => (props.editor.state.entityKind === 'playlists' ? '歌单' : '歌曲'))
  const unit = computed(() => (props.editor.state.entityKind === 'playlists' ? '个' : '首'))
  const platformOptions = computed(() =>
    props.editor.state.platformOptions.map((platform) => ({
      value: platform.id,
      label: platform.name,
      description: `${platform.count} ${unit.value}已标记`,
    })),
  )
  const usageOptions = computed(
    () =>
      [
        {
          value: 'single',
          label: `仅关联一${unit.value}`,
          description: `只显示关联一${unit.value}${subject.value}的标签`,
        },
        {
          value: 'multiple',
          label: `关联多${unit.value}`,
          description: `只显示关联两${unit.value}及以上${subject.value}的标签`,
        },
      ] as const,
  )
  const scopeOptions = computed(
    () =>
      [
        {
          value: 'single',
          label: '单个平台',
          description: `只显示${subject.value}来自同一平台的标签`,
        },
        {
          value: 'multiple',
          label: '跨平台',
          description: `只显示${subject.value}来自多个平台的标签`,
        },
      ] as const,
  )
  const sortOptions = computed(
    () =>
      [
        { value: 'updated-desc', label: '最近维护', description: '最近维护过的标签排在前面' },
        { value: 'name-asc', label: '标签名称', description: '按标签名称顺序排列' },
        {
          value: 'usage-desc',
          label: `关联${subject.value}最多`,
          description: `关联${subject.value}较多的标签排在前面`,
        },
      ] as const,
  )
  const defaults = computed<TagManagementFilterState>(() => ({
    searchQuery: '',
    selectedPlatformIds: [],
    usage: [],
    platformScope: [],
    sortMode: [],
  }))
  const dimensions = computed(() => [
    {
      id: 'searchQuery' as const,
      label: '标签名称',
      description: '按名称关键词查找标签',
      icon: 'search' as const,
      labels: draft.value?.searchQuery.trim() ? [draft.value.searchQuery.trim()] : [],
    },
    {
      id: 'selectedPlatformIds' as const,
      label: '关联平台',
      description: `可多选，满足任一平台即可；不改变标签的全局${subject.value}数量`,
      icon: 'music' as const,
      labels:
        draft.value?.selectedPlatformIds.map(
          (id) => platformOptions.value.find((option) => option.value === id)?.label ?? id,
        ) ?? [],
    },
    {
      id: 'usage' as const,
      label: `关联${subject.value}`,
      description: `可多选，匹配其中任意一种全局${subject.value}数量`,
      icon: 'library' as const,
      labels:
        draft.value?.usage.map(
          (value) => usageOptions.value.find((option) => option.value === value)!.label,
        ) ?? [],
    },
    {
      id: 'platformScope' as const,
      label: '平台覆盖',
      description: '可多选，匹配其中任意一种平台覆盖范围',
      icon: 'tags' as const,
      labels:
        draft.value?.platformScope.map(
          (value) => scopeOptions.value.find((option) => option.value === value)!.label,
        ) ?? [],
    },
    {
      id: 'sortMode' as const,
      label: '排序方式',
      description: '可多选，按选择先后确定排序优先级；默认按最近维护排序',
      icon: 'list' as const,
      labels:
        draft.value?.sortMode.map(
          (value, index) =>
            `${index + 1}. ${sortOptions.value.find((option) => option.value === value)!.label}`,
        ) ?? [],
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
  // Keep the outgoing view's available height until its fade has completed.
  function handleViewAfterLeave(): void {
    detailOpen.value = active.value !== null
  }
  function set<Key extends Dimension>(key: Key, value: TagManagementFilterState[Key]): void {
    if (draft.value) props.editor.actions.setFilterDraft({ ...draft.value, [key]: value })
  }
  function edit(dimension: Dimension): void {
    if (!draft.value) return
    snapshot.value = {
      ...draft.value,
      selectedPlatformIds: [...draft.value.selectedPlatformIds],
      usage: [...draft.value.usage],
      platformScope: [...draft.value.platformScope],
      sortMode: [...draft.value.sortMode],
    }
    previous.value = dimension
    active.value = dimension
  }
  function finish(): void {
    active.value = null
    snapshot.value = null
  }
  function back(): void {
    if (active.value && snapshot.value) {
      const dimension = active.value
      const value = snapshot.value[dimension]
      // Platform availability can change while the dimension is open.
      set(
        dimension,
        dimension === 'selectedPlatformIds'
          ? (value as readonly string[]).filter((id) =>
              props.editor.state.platformOptions.some((platform) => platform.id === id),
            )
          : value,
      )
    }
    finish()
  }
  function remove(dimension: Dimension, index: number): void {
    if (!draft.value) return
    if (dimension === 'searchQuery') set(dimension, defaults.value[dimension])
    else
      set(
        dimension,
        draft.value[dimension].filter((_, candidate) => candidate !== index),
      )
  }
  async function clear(): Promise<void> {
    const original = draft.value
    if (!original) return
    const accepted = await confirm({
      title: '清空全部筛选？',
      message: '将移除当前草稿中的全部条件并恢复最近维护排序，应用后更新标签列表。',
      confirmLabel: '清空全部',
      tone: 'danger',
    })
    if (accepted && !disposed && draft.value === original)
      props.editor.actions.setFilterDraft(defaults.value)
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
    draft,
    defaults,
    dimensions,
    groups,
    current,
    usageOptions,
    scopeOptions,
    sortOptions,
    platformOptions,
    set,
    edit,
    back,
    finish,
    remove,
    clear,
    leave,
    handleViewAfterLeave,
    focusView,
  }
}
