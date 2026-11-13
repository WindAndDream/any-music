import { editingStateKey } from '@any-music/ui'
import type { EditingSession } from '@any-music/ui'
import type { TagDetailView, TagDisplayMode } from '@any-music/ui/theme'
import { computed, reactive, watch } from 'vue'

import { tagKey, type useTagManagementFilters } from './use-tag-management-filters'

interface DirectoryState {
  displayMode: TagDisplayMode
  displayModeChosen?: boolean
  operatorOpen: boolean
  selectedTagKeys: Set<string>
  detailKey: string
  detailView: TagDetailView
  detailSelectedIds: Set<string>
  tagNameDraft: string
  mergeOpen: boolean
  mergeTarget: string
  createOpen: boolean
  createNameDraft: string
}
const directoryKey = editingStateKey<DirectoryState>('tags:directory')

/** Presentation-independent editing state; only explicit close clears a selection or draft. */
export function useTagDirectory(
  source: ReturnType<typeof useTagManagementFilters>,
  editing: EditingSession,
) {
  const view = editing.state(directoryKey, () =>
    reactive<DirectoryState>({
      displayMode: 'fill',
      operatorOpen: false,
      selectedTagKeys: new Set(),
      detailKey: '',
      detailView: 'actions',
      detailSelectedIds: new Set(),
      tagNameDraft: '',
      mergeOpen: false,
      mergeTarget: '',
      createOpen: false,
      createNameDraft: '',
    }),
  )
  const selectedTags = computed(() =>
    source.tagOptions.value.filter(({ key }) => view.selectedTagKeys.has(key)),
  )
  const detailTag = computed(() => source.index.value.tags.get(view.detailKey) ?? null)
  const detailRecords = computed(() => source.index.value.records.get(view.detailKey) ?? [])
  const detailPlaylists = computed(() => source.index.value.playlists.get(view.detailKey) ?? [])
  const detailIds = computed(
    () =>
      new Set([
        ...detailRecords.value.map(({ track }) => track.id),
        ...detailPlaylists.value.map(({ playlist }) => playlist.id),
      ]),
  )
  watch(
    detailIds,
    (ids) => {
      view.detailSelectedIds = new Set([...view.detailSelectedIds].filter((id) => ids.has(id)))
    },
    { flush: 'sync' },
  )
  watch(
    source.tagOptions,
    (tags) => {
      const visible = new Set(tags.map(({ key }) => key))
      view.selectedTagKeys = new Set([...view.selectedTagKeys].filter((key) => visible.has(key)))
    },
    { immediate: true, flush: 'sync' },
  )
  watch(detailTag, (tag) => {
    if (!tag) closeDetail()
  })
  function openDetail(key: string): void {
    const tag = source.index.value.tags.get(key)
    if (!tag) return
    if (view.detailKey !== key) {
      view.detailSelectedIds = new Set()
      editing.clearScope('tag-detail-tracks')
      editing.clearScope('tag-detail-playlists')
      view.detailView = 'actions'
    }
    view.detailKey = key
    view.tagNameDraft = tag.name
  }
  function closeDetail(): void {
    view.detailSelectedIds = new Set()
    editing.clearScope('tag-detail-tracks')
    editing.clearScope('tag-detail-playlists')
    view.detailKey = ''
    view.detailView = 'actions'
    view.tagNameDraft = ''
  }
  function setOperatorOpen(open: boolean): void {
    view.operatorOpen = open
    if (!open) {
      view.selectedTagKeys = new Set()
      view.mergeOpen = false
      view.mergeTarget = ''
    }
  }
  function activateTag(key: string): void {
    if (!view.operatorOpen) return openDetail(key)
    if (!source.index.value.tags.has(key)) return
    if (view.selectedTagKeys.has(key)) view.selectedTagKeys.delete(key)
    else view.selectedTagKeys.add(key)
  }
  function toggleAllTags(): void {
    if (!view.operatorOpen) return
    view.selectedTagKeys =
      selectedTags.value.length === source.tagOptions.value.length
        ? new Set()
        : new Set(source.tagOptions.value.map(({ key }) => key))
  }
  function editSelectedTag(): void {
    if (selectedTags.value.length === 1) openDetail(selectedTags.value[0]!.key)
  }
  function beginMerge(): void {
    if (selectedTags.value.length < 2) return
    view.mergeTarget = selectedTags.value[0]!.name
    view.mergeOpen = true
  }
  return {
    view,
    selectedTags,
    detailTag,
    detailRecords,
    detailPlaylists,
    openDetail,
    closeDetail,
    setOperatorOpen,
    activateTag,
    toggleAllTags,
    toggleDetailItem: (id: string) => {
      if (!detailIds.value.has(id)) return
      if (view.detailSelectedIds.has(id)) view.detailSelectedIds.delete(id)
      else view.detailSelectedIds.add(id)
    },
    toggleAllDetailItems: (ids: readonly string[]) => {
      const eligible = ids.filter((id) => detailIds.value.has(id))
      const allSelected = eligible.every((id) => view.detailSelectedIds.has(id))
      for (const id of eligible) {
        if (allSelected) view.detailSelectedIds.delete(id)
        else view.detailSelectedIds.add(id)
      }
    },
    editSelectedTag,
    beginMerge,
    renameDetail: (name: string) => {
      view.detailKey = tagKey(name)
      view.tagNameDraft = name
    },
  }
}
