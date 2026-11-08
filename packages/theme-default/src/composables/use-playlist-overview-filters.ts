import type { MusicPlaylist } from '@any-music/core'
import {
  filterCatalogTagStats,
  getCatalogTagStats,
  useBackHandler,
  useUiContributionAvailability,
} from '@any-music/ui/catalog'
import {
  createPlaylistOverviewFilters,
  filterPlaylistOverview,
  useConfirmAction,
  usePlaylistOverviewFilterEditor,
  formatPlaylistTrackCountRange,
} from '@any-music/ui/library'
import type {
  PlaylistOverviewFilters,
  PlaylistOverviewFilterDimension,
} from '@any-music/ui/library'
import { computed, nextTick, watch } from 'vue'
import type { Ref } from 'vue'

export type Dimension = PlaylistOverviewFilterDimension
export interface PlaylistOverviewFilterProps {
  draft: PlaylistOverviewFilters | null
  playlists: readonly MusicPlaylist[]
  customTagsByPlaylistId?: ReadonlyMap<string, readonly string[]>
  resultCount: number
  totalCount: number
  disabled: boolean
}
function leave(element: Element) {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
export function usePlaylistOverviewFilters(
  props: Readonly<PlaylistOverviewFilterProps>,
  update: (filters: PlaylistOverviewFilters | null) => void,
  overview: Readonly<Ref<HTMLElement | null>>,
) {
  const editor = usePlaylistOverviewFilterEditor()
  const { active, previous, local } = editor
  const confirm = useConfirmAction()
  const contribution = useUiContributionAvailability('trackList.filters', () => ({
    area: 'playlists',
  }))
  const tagsEnabled = computed(() => contribution.allows('tag-filter'))
  watch(
    tagsEnabled,
    (enabled) => {
      if (!enabled && local.value.tags.length) local.value = { ...local.value, tagsDormant: true }
    },
    { immediate: true, flush: 'sync' },
  )
  const tagStats = computed(() =>
    tagsEnabled.value
      ? getCatalogTagStats(props.playlists, props.customTagsByPlaylistId ?? new Map())
      : [],
  )
  const visibleTagStats = computed(() =>
    filterCatalogTagStats(tagStats.value, editor.tagQuery.value),
  )
  const coverOptions = [
    { value: 'present', label: '已设置封面', description: '只显示已上传封面的歌单' },
    { value: 'missing', label: '未设置封面', description: '只显示使用默认封面的歌单' },
  ] as const
  const dimensions = computed(() => [
    {
      id: 'keyword' as const,
      label: '文本搜索',
      icon: 'search' as const,
      description: '按歌单名称或简介搜索',
      labels: props.draft?.keyword.trim() ? [props.draft.keyword.trim()] : [],
    },
    {
      id: 'trackCountRanges' as const,
      label: '歌曲数量',
      icon: 'music' as const,
      description: '按歌单内的歌曲数量筛选，多个数量段匹配任意一个',
      labels: props.draft?.trackCountRanges.map(formatPlaylistTrackCountRange) ?? [],
    },
    {
      id: 'tags' as const,
      label: '用户标签',
      icon: 'tag' as const,
      description: !tagsEnabled.value
        ? '标签功能已停用，已选条件保留但不参与筛选'
        : local.value.tagsDormant
          ? '已选标签暂不参与筛选，确定后恢复'
          : '选择多个标签时匹配其中任意一个',
      labels: props.draft?.tags ?? [],
    },
    {
      id: 'cover' as const,
      label: '歌单封面',
      icon: 'image' as const,
      description: '按是否设置了封面筛选，选择多个条件时匹配其中任意一个',
      labels:
        props.draft?.cover.map(
          (value) => coverOptions.find((option) => option.value === value)!.label,
        ) ?? [],
    },
  ])
  const groups = computed(() =>
    dimensions.value.map((item) => ({
      dimension: item.id,
      title: item.label,
      labels: item.labels,
    })),
  )
  const selectedCount = computed(() =>
    groups.value.reduce((sum, group) => sum + group.labels.length, 0),
  )
  const current = computed(() => dimensions.value.find((item) => item.id === active.value)!)
  const previewCount = computed(() =>
    active.value
      ? filterPlaylistOverview(
          props.playlists,
          editor.preview.value,
          props.customTagsByPlaylistId,
          tagsEnabled.value,
        ).length
      : props.resultCount,
  )
  watch(
    () => props.draft === null,
    () => {
      active.value = null
      editor.resetPendingRange()
      editor.tagQuery.value = ''
    },
  )
  function edit(dimension: Dimension, index?: number) {
    if (!props.draft || props.disabled) return
    previous.value = dimension
    local.value = { ...props.draft }
    editor.resetPendingRange()
    editor.tagQuery.value = ''
    active.value = dimension
    if (dimension === 'trackCountRanges' && index !== undefined) editor.editRange(index)
  }
  function back() {
    active.value = null
  }
  function applyDimension() {
    if (!props.draft || !active.value || props.disabled) return
    if (!editor.confirmDraft()) return
    const dimension = active.value
    update({
      ...props.draft,
      [dimension]: local.value[dimension],
      ...(dimension === 'tags' && tagsEnabled.value ? { tagsDormant: undefined } : {}),
    })
    back()
  }
  function remove(dimension: Dimension, index?: number) {
    if (!props.draft || props.disabled) return
    if (
      (dimension === 'tags' || dimension === 'trackCountRanges' || dimension === 'cover') &&
      index !== undefined
    )
      update({
        ...props.draft,
        [dimension]: props.draft[dimension].filter((_, candidate) => candidate !== index),
      })
    else update({ ...props.draft, [dimension]: createPlaylistOverviewFilters()[dimension] })
  }
  async function clear() {
    const draft = props.draft
    if (!draft || props.disabled || !selectedCount.value) return
    if (
      await confirm({
        title: '清空全部筛选？',
        message: `将移除当前草稿中的 ${selectedCount.value} 条条件，应用后更新歌单列表。`,
        confirmLabel: '清空全部',
        tone: 'danger',
      })
    ) {
      if (props.draft === draft && !props.disabled) update(createPlaylistOverviewFilters())
    }
  }
  async function focusView(element: Element) {
    await nextTick()
    if (active.value)
      element.querySelector<HTMLElement>('[data-editor-focus]')?.focus({
        preventScroll: true,
      })
    else
      overview.value
        ?.querySelector<HTMLElement>(`[data-filter-dimension="${previous.value}"]`)
        ?.focus({ preventScroll: true })
  }
  useBackHandler({ active: () => props.draft !== null && active.value !== null, handle: back })

  return {
    editor,
    tagsEnabled,
    tagStats,
    visibleTagStats,
    coverOptions,
    active,
    local,
    dimensions,
    groups,
    current,
    previewCount,
    edit,
    back,
    applyDimension,
    remove,
    clear,
    focusView,
    leave,
  }
}
