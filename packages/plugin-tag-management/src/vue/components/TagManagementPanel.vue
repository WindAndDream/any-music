<script lang="ts">
import type { ShallowRef } from 'vue'

const entityKindKey = editingStateKey<ShallowRef<TagEntityKind>>('tags:entity-kind')
</script>

<script setup lang="ts">
import { AppError, toAppErrorState } from '@any-music/core'
import type { LibraryTrackRecord, Track } from '@any-music/core'
import {
  CUSTOM_TRACK_PLATFORM_ID,
  editingStateKey,
  provideEditingSession,
  useEditingSession,
  useConfirmAction,
  useActionFeedback,
} from '@any-music/ui'
import type { EditingSession, MusicPlatformOption, TrackDisplayPreferences } from '@any-music/ui'
import type {
  TagDisplayMode,
  TagEntityKind,
  TagPlaylistRecord,
  TagManagementPresentation,
} from '@any-music/ui/theme'
import {
  computed,
  shallowRef,
  reactive,
  readonly,
  markRaw,
  onScopeDispose,
  toRefs,
  watch,
} from 'vue'

import { normalizeCustomTag } from '../../tags'
import { useTagDirectory } from '../use-tag-directory'
import { tagKey, useTagManagementFilters } from '../use-tag-management-filters'
import TagCreateForm from './TagCreateForm.vue'
import TagDetailsPanel from './TagDetailsPanel.vue'
import TagFilterBar from './TagFilterBar.vue'
import TagMaintenanceToolbar from './TagMaintenanceToolbar.vue'
import TagPlatformDrawer from './TagPlatformDrawer.vue'
import TagTrackCard from './TagTrackCard.vue'

const props = defineProps<{
  editing?: EditingSession
  defaultDisplayMode?: TagDisplayMode
  defaultTrackDisplayPreferences?: TrackDisplayPreferences
  records: readonly LibraryTrackRecord[]
  playlists?: readonly TagPlaylistRecord[]
  platforms: readonly MusicPlatformOption[]
  errorMessage: string
  tagDefinitions?: readonly { name: string; updatedAtMs: number }[]
  createTag: (name: string) => void
  removeTagAssociations: (kind: TagEntityKind, ids: readonly string[], tag: string) => void
}>()
const emit = defineEmits<{
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
  renameTag: [currentTag: string, nextTag: string]
  deleteTag: [tag: string]
  deleteTags: [tags: readonly string[]]
  mergeTags: [tags: readonly string[], target: string]
}>()
const editing = props.editing ?? useEditingSession('tags')
provideEditingSession(editing)
const entityKind = editing.state(entityKindKey, () => shallowRef<TagEntityKind>('tracks'))
const source = useTagManagementFilters(
  () => props.records,
  () => props.platforms,
  editing,
  () => props.tagDefinitions ?? [],
  { kind: entityKind, playlists: () => props.playlists ?? [] },
)
const directory = useTagDirectory(source, editing)
watch(
  () => props.defaultDisplayMode,
  (mode) => {
    if (mode && !directory.view.displayModeChosen) directory.view.displayMode = mode
  },
  { immediate: true },
)
const confirm = useConfirmAction()
const feedback = useActionFeedback()
const confirming = shallowRef(false)
const localError = shallowRef('')
let active = true
onScopeDispose(() => {
  active = false
})
function assertCurrent(): void {
  if (!active || !editing.active) throw new AppError('conflict', '标签编辑会话已失效。')
}
const guard =
  <Args extends unknown[]>(action: (...args: Args) => void) =>
  (...args: Args) => {
    assertCurrent()
    localError.value = ''
    action(...args)
  }
async function mutate(action: () => Promise<void>): Promise<void> {
  assertCurrent()
  if (confirming.value) return
  localError.value = ''
  try {
    await action()
  } catch (cause) {
    if (!active || !editing.active) throw cause
    localError.value = toAppErrorState(cause).message
  }
}
async function confirmEdit(request: Parameters<typeof confirm>[0]): Promise<boolean> {
  const snapshot = source.index.value
  confirming.value = true
  try {
    const accepted = await confirm(request)
    assertCurrent()
    // A mutation while the confirmation is open invalidates its affected-song snapshot.
    return accepted && snapshot === source.index.value
  } finally {
    confirming.value = false
  }
}
async function renameTag(current: string, next: string): Promise<void> {
  await mutate(async () => {
    next = normalizeCustomTag(next)
    const willMerge = tagKey(current) !== tagKey(next) && source.index.value.tags.has(tagKey(next))
    if (
      willMerge &&
      !(await confirmEdit({
        title: '合并标签',
        message: `标签“${next}”已存在，确定将“${current}”合并到该标签吗？歌曲和歌单中的同名标签会一起更新。`,
        confirmLabel: '合并标签',
        tone: 'danger',
      }))
    )
      return
    assertCurrent()
    emit('renameTag', current, next)
    directory.renameDetail(next)
  })
}
function affectedCount(names: readonly string[]): number {
  const ids = new Set<string>()
  const keys = new Set(names.map(tagKey))
  for (const record of props.records)
    if (record.customTags.some((tag) => keys.has(tagKey(tag)))) ids.add(record.track.id)
  return ids.size
}
async function deleteTags(names: readonly string[]): Promise<void> {
  await mutate(async () => {
    if (!names.length) return
    const accepted = await confirmEdit({
      title: names.length === 1 ? '删除标签' : '批量删除标签',
      message: `确定全局删除 ${names.length} 个标签吗？将影响 ${affectedCount(names)} 首歌曲，并清除歌单中的同名标签；歌曲和歌单本身不会被删除。`,
      confirmLabel: '删除标签',
      tone: 'danger',
    })
    if (accepted) {
      if (names.length === 1) emit('deleteTag', names[0]!)
      else emit('deleteTags', names)
    }
  })
}
async function mergeSelectedTags(): Promise<void> {
  await mutate(async () => {
    const names = directory.selectedTags.value.map(({ name }) => name)
    if (names.length < 2) return
    const target = normalizeCustomTag(directory.view.mergeTarget)
    const accepted = await confirmEdit({
      title: '合并标签',
      message: `确定将 ${names.length} 个标签合并为“${target}”吗？将更新 ${affectedCount(names)} 首歌曲的标签，并同步更新歌单中的同名标签，重复关联自动去重。`,
      confirmLabel: '合并标签',
      tone: 'danger',
    })
    if (!accepted) return
    emit('mergeTags', names, target)
    directory.view.mergeOpen = false
    directory.view.mergeTarget = ''
  })
}
async function removeSelectedDetailTags(): Promise<void> {
  await mutate(async () => {
    const tag = directory.detailTag.value
    const selection = directory.view.detailSelectedIds
    const ids = [...selection]
    if (!tag || !ids.length) return
    const kind = entityKind.value
    const key = directory.view.detailKey
    const accepted = await confirmEdit({
      title: '移除标签',
      message: `确定从选中的 ${ids.length} ${kind === 'playlists' ? '个歌单' : '首音乐'}中移除标签“${tag.name}”吗？其他标签和关联保持不变。`,
      confirmLabel: '移除标签',
      tone: 'danger',
    })
    if (
      !accepted ||
      directory.view.detailKey !== key ||
      entityKind.value !== kind ||
      directory.view.detailSelectedIds !== selection
    )
      return
    props.removeTagAssociations(kind, ids, tag.name)
    directory.view.detailSelectedIds = new Set()
  })
}
const platformNames = computed(
  () => new Map(source.platformOptions.value.map(({ id, name }) => [id, name])),
)
const { displayMode, operatorOpen, selectedTagKeys, tagNameDraft, mergeOpen, mergeTarget } = toRefs(
  directory.view,
)
const editor: TagManagementPresentation = {
  state: readonly(
    reactive({
      entityKind,
      taggedPlaylistCount: computed(() => source.taggedPlaylists.value.length),
      filters: source.filters,
      filterDraft: source.filterDraft,
      filterPreviewCount: source.filterPreviewCount,
      taggedRecords: source.taggedRecords,
      platformOptions: source.platformOptions,
      allTagOptions: source.allTagOptions,
      tagOptions: source.tagOptions,
      hasFilters: source.hasFilters,
      displayMode,
      operatorOpen,
      selectedTagKeys,
      tagNameDraft,
      mergeOpen,
      mergeTarget,
      createOpen: computed(() => directory.view.createOpen),
      createNameDraft: computed(() => directory.view.createNameDraft),
      selectedTags: directory.selectedTags,
      detailTag: directory.detailTag,
      detailRecords: directory.detailRecords,
      detailPlaylists: directory.detailPlaylists,
      detailSelectedIds: computed(() => directory.view.detailSelectedIds),
      defaultTrackDisplayPreferences: computed(() => props.defaultTrackDisplayPreferences),
      detailView: computed(() => directory.view.detailView),
      confirming,
      errorMessage: computed(() => localError.value || props.errorMessage),
    }),
  ),
  actions: {
    setEntityKind: guard((kind) => {
      if (kind === entityKind.value || confirming.value) return
      directory.closeDetail()
      directory.setOperatorOpen(false)
      source.filterDraft.value = null
      source.resetFilters()
      entityKind.value = kind
    }),
    beginCreate: guard(() => {
      directory.view.createOpen = true
    }),
    cancelCreate: guard(() => {
      directory.view.createOpen = false
      directory.view.createNameDraft = ''
    }),
    setCreateNameDraft: guard((value) => {
      directory.view.createNameDraft = value
    }),
    createTag: guard(() => {
      try {
        const name = normalizeCustomTag(directory.view.createNameDraft)
        if (source.index.value.tags.has(tagKey(name))) {
          feedback({ status: 'warning', message: '已存在重复标签。' })
          return
        }
        props.createTag(name)
        directory.view.createOpen = false
        directory.view.createNameDraft = ''
        feedback({ status: 'success', message: '标签已创建。' })
      } catch (cause) {
        const error = toAppErrorState(cause)
        feedback({
          status: error.code === 'conflict' ? 'warning' : 'error',
          message: error.message,
        })
      }
    }),
    setFilters: guard((value) => {
      source.filters.value = value
    }),
    beginFilters: guard(source.beginFilters),
    setFilterDraft: guard((value) => {
      if (source.filterDraft.value) source.filterDraft.value = value
    }),
    applyFilters: guard(source.applyFilters),
    cancelFilters: guard(() => {
      source.filterDraft.value = null
    }),
    resetFilters: guard(source.resetFilters),
    setDisplayMode: guard((mode) => {
      directory.view.displayMode = mode
      directory.view.displayModeChosen = true
    }),
    setOperatorOpen: guard(directory.setOperatorOpen),
    activateTag: guard(directory.activateTag),
    toggleAllTags: guard(directory.toggleAllTags),
    closeDetail: guard(directory.closeDetail),
    setDetailView: guard((view) => {
      directory.view.detailView = view
    }),
    toggleDetailItem: guard((id) => {
      if (!confirming.value) directory.toggleDetailItem(id)
    }),
    toggleAllDetailItems: guard((ids) => {
      if (!confirming.value) directory.toggleAllDetailItems(ids)
    }),
    removeSelectedDetailTags,
    setTagNameDraft: guard((value) => {
      directory.view.tagNameDraft = value
    }),
    editSelectedTag: guard(directory.editSelectedTag),
    beginMerge: guard(directory.beginMerge),
    cancelMerge: guard(() => {
      directory.view.mergeOpen = false
      directory.view.mergeTarget = ''
    }),
    setMergeTarget: guard((value) => {
      directory.view.mergeTarget = value
    }),
    mergeSelectedTags,
    deleteSelectedTags: () => deleteTags(directory.selectedTags.value.map(({ name }) => name)),
    getPlatformName: (record) => {
      const id =
        record.track.source.mediaKind === 'custom'
          ? CUSTOM_TRACK_PLATFORM_ID
          : record.track.source.pluginId
      return platformNames.value.get(id) ?? id
    },
    renameTag,
    deleteTag: (name) => deleteTags([name]),
    addTag: guard((track, tag) => emit('addTag', track, tag)),
    removeTag: guard((track, tag) => emit('removeTag', track, tag)),
  },
  controls: markRaw({
    Create: TagCreateForm,
    Filter: TagFilterBar,
    Maintenance: TagMaintenanceToolbar,
    Details: TagDetailsPanel,
    Drawer: TagPlatformDrawer,
    Track: TagTrackCard,
  }),
}
defineSlots<{ default(props: { editor: TagManagementPresentation }): unknown }>()
</script>

<template><slot :editor="editor" /></template>
