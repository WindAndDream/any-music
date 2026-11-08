<script setup lang="ts">
import { AppError } from '@any-music/core'
import { useConfirmAction, provideEditingSession, useEditingSession } from '@any-music/ui'
import type { MusicCreationPresentation } from '@any-music/ui/theme'
import { reactive, readonly, markRaw, computed, onScopeDispose } from 'vue'

import {
  type SegmentComposerEmits,
  type SegmentComposerProps,
  useSegmentComposer,
} from '../use-segment-composer'
import MaterialCollectionToolbar from './MaterialCollectionToolbar.vue'
import MaterialFilterBar from './MaterialFilterBar.vue'
import MaterialTrackRow from './MaterialTrackRow.vue'
import PendingMaterialStorage from './PendingMaterialStorage.vue'
import SegmentTimeline from './SegmentTimeline.vue'

const props = defineProps<SegmentComposerProps>()
const rawEmit = defineEmits<SegmentComposerEmits>()
let active = true
onScopeDispose(() => {
  active = false
})
const editing = props.editing ?? useEditingSession('composer')
const assertCurrent = () => {
  if (!active || !editing.active) throw new AppError('conflict', '创作编辑会话已失效。')
}
const emit: typeof rawEmit = ((...args: unknown[]) => {
  assertCurrent()
  ;(rawEmit as (...args: unknown[]) => void)(...args)
}) as typeof rawEmit
const confirm = useConfirmAction()
provideEditingSession(editing)

async function clearData(): Promise<void> {
  if (
    await confirm({
      title: '清空创作数据',
      message:
        '删除草稿、素材合集与待整理记录，已发布作品、喜欢和歌单会保留。停用创作功能会保留这些数据。',
      confirmLabel: '清空创作数据',
      tone: 'danger',
    })
  )
    emit('clearData')
}

const {
  activeCollection,
  activeCollectionId,
  addMaterial,
  addPendingMaterial,
  addSegment,
  collectionTrackIds,
  downloadDraft,
  downloadSegment,
  exportFormat,
  filters,
  formatDuration,
  localError,
  moveSegment,
  platformNames,
  platformOptions,
  recipe,
  removeMaterial,
  removeSegment,
  segmentStatsByTrackId,
  selectCollection,
  submit,
  tagStats,
  title,
  trackTitles,
  virtualDurationMs,
  visibleRecords,
} = useSegmentComposer({ confirm, emit, props })

const guard =
  <Args extends unknown[], Result>(action: (...args: Args) => Result) =>
  (...args: Args): Result => {
    assertCurrent()
    return action(...args)
  }
const editor: MusicCreationPresentation = {
  state: readonly(
    reactive({
      materialCollections: computed(() => props.materialCollections),
      records: computed(() => props.records),
      pendingRecords: computed(() => props.pendingRecords),
      errorMessage: computed(() => props.errorMessage),
      exportBusy: computed(() => props.exportBusy),
      exportMessage: computed(() => props.exportMessage),
      activeCollection,
      activeCollectionId,
      title,
      recipe,
      exportFormat,
      filters,
      visibleRecords,
      collectionTrackIds,
      platformNames,
      platformOptions,
      tagStats,
      trackTitles,
      segmentStatsByTrackId,
      virtualDurationMs,
      localError,
    }),
  ),
  actions: {
    setTitle: guard((value) => {
      title.value = value
    }),
    setExportFormat: guard((value) => {
      exportFormat.value = value
    }),
    setFilters: guard((value) => {
      filters.value = value
    }),
    selectCollection: guard(selectCollection),
    clearData: guard(clearData),
    createCollection: guard((name) => emit('createCollection', name)),
    deleteCollection: guard((id, cleanup) => emit('deleteCollection', id, cleanup)),
    removePendingMaterial: guard((id) => emit('removePendingMaterial', id)),
    preview: guard((segment) => emit('preview', segment)),
    addMaterial: guard(addMaterial),
    addPendingMaterial: guard(addPendingMaterial),
    removeMaterial: guard(removeMaterial),
    addSegment: guard(addSegment),
    moveSegment: guard(moveSegment),
    removeSegment: guard(removeSegment),
    downloadSegment: guard(downloadSegment),
    downloadDraft: guard(downloadDraft),
    submit: guard(submit),
    formatDuration,
  },
  controls: markRaw({
    Collections: MaterialCollectionToolbar,
    Filter: MaterialFilterBar,
    Material: MaterialTrackRow,
    Pending: PendingMaterialStorage,
    Timeline: SegmentTimeline,
  }),
}
defineSlots<{ default(props: { editor: MusicCreationPresentation }): unknown }>()
</script>

<template><slot :editor="editor" /></template>
