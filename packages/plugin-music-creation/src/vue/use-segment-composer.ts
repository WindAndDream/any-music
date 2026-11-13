import type { LibraryTrackRecord, MaterialCollection, SegmentRecipe, Track } from '@any-music/core'
import { editingStateKey, useEditingSession, type EditingSession } from '@any-music/ui'
import type {
  AudioExportFormat,
  ConfirmAction,
  MusicCreationDraft,
  MusicPlatformOption,
} from '@any-music/ui'
import type { ShallowRef } from 'vue'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { useMaterialLibraryFilters } from './use-material-library-filters'

export interface SegmentComposerProps {
  editing?: EditingSession
  draft?: MusicCreationDraft
  records: readonly LibraryTrackRecord[]
  pendingRecords: readonly LibraryTrackRecord[]
  materialCollections: readonly MaterialCollection[]
  platforms: readonly MusicPlatformOption[]
  errorMessage: string
  exportBusy: boolean
  exportMessage: string
}

export interface SegmentComposerEmits {
  updateDraft: [draft: MusicCreationDraft]
  clearData: []
  createCollection: [name: string]
  deleteCollection: [collectionId: string, deleteMaterialRecords: boolean]
  addMaterial: [collectionId: string, track: Track]
  removePendingMaterial: [trackId: string]
  removeMaterial: [collectionId: string, trackId: string]
  save: [title: string, materialCollectionId: string, recipe: readonly SegmentRecipe[]]
  preview: [segment: SegmentRecipe]
  download: [title: string, recipe: readonly SegmentRecipe[], format: AudioExportFormat]
}

type SegmentComposerEmit = <EventName extends keyof SegmentComposerEmits>(
  eventName: EventName,
  ...args: SegmentComposerEmits[EventName]
) => void

export interface UseSegmentComposerOptions {
  props: Readonly<SegmentComposerProps>
  emit: SegmentComposerEmit
  /** 丢弃草稿前的异步确认方式由表现层注入，控制器本身不依赖具体弹层。 */
  confirm: ConfirmAction
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** 素材选择、时间线草稿与保存/导出意图组成无界面的片段创作控制器。 */
export function useSegmentComposer(options: UseSegmentComposerOptions) {
  const { confirm, emit, props } = options
  const editing = props.editing ?? useEditingSession('composer')

  const activeCollectionId = editing.state(activeCollectionIdKey, () =>
    shallowRef(props.draft?.activeCollectionId ?? ''),
  )
  const title = editing.state(titleKey, () => shallowRef(props.draft?.title ?? ''))
  const recipe = editing.state(recipeKey, () =>
    shallowRef<readonly SegmentRecipe[]>(props.draft?.recipe ?? []),
  )
  const exportFormat = editing.state(exportFormatKey, () =>
    shallowRef<AudioExportFormat>(props.draft?.exportFormat ?? 'mp3'),
  )
  const localError = shallowRef('')
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })

  const activeCollection = computed(() =>
    props.materialCollections.find((collection) => collection.id === activeCollectionId.value),
  )
  const trackTitles = computed(
    () =>
      new Map(
        props.records.map((record) => [record.track.id, record.customName ?? record.track.title]),
      ),
  )
  const virtualDurationMs = computed(() =>
    recipe.value.reduce((total, segment) => total + segment.endMs - segment.startMs, 0),
  )
  const {
    filters,
    visibleRecords,
    collectionTrackIds,
    platformOptions,
    tagStats,
    showCurrentCollectionRecords,
  } = useMaterialLibraryFilters(
    () => props.records,
    () => activeCollection.value,
    () => props.platforms,
    editing,
  )
  const platformNames = computed(
    () => new Map(platformOptions.value.map((platform) => [platform.id, platform.name])),
  )
  const segmentStatsByTrackId = computed(() => {
    const stats = new Map<string, { segmentCount: number; totalDurationMs: number }>()
    for (const segment of recipe.value) {
      const current = stats.get(segment.sourceTrackId) ?? { segmentCount: 0, totalDurationMs: 0 }
      stats.set(segment.sourceTrackId, {
        segmentCount: current.segmentCount + 1,
        totalDurationMs: current.totalDurationMs + segment.endMs - segment.startMs,
      })
    }
    return stats
  })

  watch(
    () => props.materialCollections,
    (collections) => {
      if (collections.some((collection) => collection.id === activeCollectionId.value)) return
      const nextCollectionId = collections[0]?.id ?? ''
      // Rebinding an empty library is not a collection switch; keep its unfinished search.
      if (activeCollectionId.value === nextCollectionId) return
      activeCollectionId.value = nextCollectionId
      recipe.value = []
      showCurrentCollectionRecords()
    },
    { immediate: true },
  )

  // Persist each editing change before unmount/disable, with no replay during initial restore.
  watch(
    [activeCollectionId, title, recipe, exportFormat],
    () => {
      if (
        !disposed &&
        activeCollectionId.value &&
        activeCollection.value &&
        recipe.value.every((segment) =>
          activeCollection.value!.trackIds.includes(segment.sourceTrackId),
        )
      )
        emit('updateDraft', {
          activeCollectionId: activeCollectionId.value,
          title: title.value,
          recipe: recipe.value.map((segment) => ({ ...segment })),
          exportFormat: exportFormat.value,
        })
    },
    { flush: 'sync' },
  )

  async function selectCollection(collectionId: string): Promise<void> {
    if (collectionId === activeCollectionId.value) return
    if (recipe.value.length > 0) {
      const confirmed = await confirm({
        title: '切换素材合集',
        message: '切换素材合集会清空当前未保存的时间线，确定继续吗？',
        confirmLabel: '清空并切换',
        tone: 'danger',
      })
      if (!confirmed || disposed) return
    }
    recipe.value = []
    activeCollectionId.value = collectionId
    showCurrentCollectionRecords()
    localError.value = ''
  }

  function addMaterial(trackId: string): void {
    const track = props.records.find((record) => record.track.id === trackId)?.track
    if (!track || !activeCollectionId.value) return
    emit('addMaterial', activeCollectionId.value, track)
  }

  function addPendingMaterial(trackId: string): void {
    const track = props.pendingRecords.find((record) => record.track.id === trackId)?.track
    if (!track || !activeCollectionId.value) return
    emit('addMaterial', activeCollectionId.value, track)
    showCurrentCollectionRecords()
  }

  async function removeMaterial(trackId: string): Promise<void> {
    if (!activeCollectionId.value) return
    if (recipe.value.some((segment) => segment.sourceTrackId === trackId)) {
      const confirmed = await confirm({
        title: '移出时间线素材',
        message: '该素材已在当前时间线中，移出合集会同时删除这些未保存片段。',
        confirmLabel: '移出并删除片段',
        tone: 'danger',
      })
      if (!confirmed || disposed) return
      recipe.value = recipe.value.filter((segment) => segment.sourceTrackId !== trackId)
    }
    emit('removeMaterial', activeCollectionId.value, trackId)
  }

  function addSegment(segment: SegmentRecipe): void {
    if (!collectionTrackIds.value.has(segment.sourceTrackId)) {
      localError.value = '请先把歌曲加入当前素材合集。'
      return
    }
    recipe.value = [...recipe.value, segment]
    localError.value = ''
  }

  function removeSegment(index: number): void {
    recipe.value = recipe.value.filter((_segment, currentIndex) => currentIndex !== index)
  }

  function moveSegment(index: number, offset: -1 | 1): void {
    const targetIndex = index + offset
    if (targetIndex < 0 || targetIndex >= recipe.value.length) return
    const next = [...recipe.value]
    const current = next[index]
    const target = next[targetIndex]
    if (!current || !target) return
    next[index] = target
    next[targetIndex] = current
    recipe.value = next
  }

  function submit(): void {
    const normalizedTitle = title.value.trim()
    if (!activeCollectionId.value) {
      localError.value = '请先创建或选择一个素材合集。'
      return
    }
    if (!normalizedTitle) {
      localError.value = '请输入自定义歌曲名称。'
      return
    }
    if (recipe.value.length === 0) {
      localError.value = '至少添加一个片段。'
      return
    }
    emit('save', normalizedTitle, activeCollectionId.value, recipe.value)
  }

  function downloadSegment(segment: SegmentRecipe): void {
    const trackTitle = trackTitles.value.get(segment.sourceTrackId) ?? '素材片段'
    emit('download', `${trackTitle}-片段`, [segment], exportFormat.value)
  }

  function downloadDraft(): void {
    if (recipe.value.length === 0) return
    emit('download', title.value.trim() || '未命名自定义音乐', recipe.value, exportFormat.value)
  }

  return {
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
  }
}

const activeCollectionIdKey = editingStateKey<ShallowRef<string>>(
  'use-segment-composer.ts:activeCollectionId',
)
const titleKey = editingStateKey<ShallowRef<string>>('use-segment-composer.ts:title')
const recipeKey = editingStateKey<ShallowRef<readonly SegmentRecipe[]>>(
  'use-segment-composer.ts:recipe',
)
const exportFormatKey = editingStateKey<ShallowRef<AudioExportFormat>>(
  'use-segment-composer.ts:exportFormat',
)
