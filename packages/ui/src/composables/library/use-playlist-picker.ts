import type { MusicPlaylist } from '@any-music/core'
import { computed, hasInjectionContext, inject, provide, reactive, shallowRef, watch } from 'vue'
import type { InjectionKey, ShallowRef } from 'vue'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../../components/music-sources/catalog-track-display-mode'
import { editingStateKey, useEditingSession } from '../use-editing-session'
import type { EditingSession } from '../use-editing-session'
import { createPlaylistOverviewFilters, filterPlaylistOverview } from './use-playlist-collection'
import type { PlaylistOverviewFilters } from './use-playlist-collection'

export interface PlaylistPickerProps {
  open: boolean
  playlists: readonly MusicPlaylist[]
  selectedCount: number
  suspended?: boolean
}

interface PlaylistPickerPresentation {
  coverUrls: () => Readonly<Record<string, string>>
  customTagsByPlaylistId?: () => ReadonlyMap<string, readonly string[]> | undefined
  mobileLayout?: () => boolean
}
const presentationKey: InjectionKey<PlaylistPickerPresentation> = Symbol(
  'playlist-picker-presentation',
)

/** Theme roots share host-resolved artwork with every nested picker, without cache access. */
export function providePlaylistPickerPresentation(presentation: PlaylistPickerPresentation) {
  provide(presentationKey, presentation)
}

function createState() {
  return reactive({
    selection: [] as string[],
    filters: createPlaylistOverviewFilters(),
    draft: null as PlaylistOverviewFilters | null,
    displayOpen: false,
    displayMode: 'standard' as CatalogTrackDisplayMode,
    mobileColumns: 1 as MobileTrackColumns,
  })
}
const pickerKey = editingStateKey<ReturnType<typeof createState>>('playlist-picker')
const pickerOpenKey = editingStateKey<ShallowRef<boolean>>('playlist-picker-open')

export function usePlaylistPickerOpen(editing: EditingSession = useEditingSession()) {
  return editing.state(pickerOpenKey, () => shallowRef(false))
}

/** A picker owns its draft only; playlist membership and writes remain with the host. */
export function usePlaylistPicker(props: Readonly<PlaylistPickerProps>) {
  const presentation = hasInjectionContext() ? inject(presentationKey, undefined) : undefined
  const coverUrls = computed(() => presentation?.coverUrls() ?? {})
  const customTagsByPlaylistId = computed(() => presentation?.customTagsByPlaylistId?.())
  const mobileLayout = computed(() => presentation?.mobileLayout?.() ?? false)
  const view = useEditingSession('playlist-picker').state(pickerKey, createState)
  const visible = computed(() => filterPlaylistOverview(props.playlists, view.filters))
  const preview = computed(() =>
    filterPlaylistOverview(props.playlists, view.draft ?? view.filters),
  )
  const selectedIds = computed(() => new Set(view.selection))
  const allSelected = computed(
    () => visible.value.length > 0 && visible.value.every(({ id }) => selectedIds.value.has(id)),
  )
  const modalOpen = computed(() => view.displayOpen || view.draft !== null)
  const filterCount = computed(
    () =>
      Number(!!view.filters.keyword.trim()) +
      view.filters.trackCountRanges.length +
      view.filters.cover.length,
  )
  const enabled = () => props.open && !props.suspended
  function reset() {
    Object.assign(view, createState())
  }

  watch(
    () => props.open,
    (open) => {
      if (!open) reset()
    },
  )
  watch(
    () => props.playlists.map(({ id }) => id),
    (ids) => {
      const available = new Set(ids)
      view.selection = view.selection.filter((id) => available.has(id))
    },
    { flush: 'sync' },
  )

  function select(id: string) {
    if (!enabled() || !visible.value.some((playlist) => playlist.id === id)) return
    const ids = new Set(view.selection)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    view.selection = [...ids]
  }
  function toggleAll() {
    if (!enabled()) return
    const ids = new Set(view.selection)
    for (const { id } of visible.value) {
      if (allSelected.value) ids.delete(id)
      else ids.add(id)
    }
    view.selection = [...ids]
  }
  function applyFilters() {
    if (!enabled() || !view.draft) return
    view.filters = { ...view.draft }
    view.draft = null
  }
  function submit(): readonly string[] {
    if (!enabled() || modalOpen.value || props.selectedCount === 0) return []
    const ids = new Set(props.playlists.map(({ id }) => id))
    return view.selection.filter((id) => ids.has(id))
  }
  return {
    coverUrls,
    customTagsByPlaylistId,
    mobileLayout,
    view,
    visible,
    preview,
    selectedIds,
    allSelected,
    modalOpen,
    filterCount,
    select,
    toggleAll,
    applyFilters,
    submit,
    reset,
  }
}
