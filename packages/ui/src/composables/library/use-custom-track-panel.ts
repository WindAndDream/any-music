import type {
  CustomTrackDefinition,
  LibraryTrackRecord,
  MaterialCollection,
  Track,
} from '@any-music/core'
import type { ShallowRef } from 'vue'
import { computed, shallowRef } from 'vue'

import type { AudioExportFormat } from '../../product/audio-export-format'
import { editingStateKey, useEditingSession } from '../use-editing-session'

export interface CustomTrackPanelProps {
  records: readonly LibraryTrackRecord[]
  customTracks: readonly CustomTrackDefinition[]
  materialCollections: readonly MaterialCollection[]
  platformNames: ReadonlyMap<string, string>
  favoriteTrackIds: ReadonlySet<string>
  currentTrackId?: string
  errorMessage: string
  exportBusy: boolean
  exportMessage: string
}

export interface CustomTrackPanelEmits {
  play: [track: Track]
  queue: [track: Track]
  compose: [trackId: string]
  favorite: [track: Track]
  unfavorite: [trackId: string]
  download: [trackId: string, format: AudioExportFormat]
  delete: [trackId: string]
}

function createSearchKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

/** 自定义歌曲检索、来源资料映射与展开状态不依赖具体卡片或抽屉组件。 */
export function useCustomTrackPanel(props: Readonly<CustomTrackPanelProps>) {
  const query = useEditingSession('custom-tracks').state(queryKey, () => shallowRef(''))
  const exportFormat = useEditingSession('custom-tracks').state(exportFormatKey, () =>
    shallowRef<AudioExportFormat>('mp3'),
  )
  const expandedTrackIds = shallowRef<ReadonlySet<string>>(new Set())

  const recordById = computed(
    () => new Map(props.records.map((record) => [record.track.id, record])),
  )
  const definitionById = computed(
    () => new Map(props.customTracks.map((definition) => [definition.trackId, definition])),
  )
  const collectionById = computed(
    () => new Map(props.materialCollections.map((collection) => [collection.id, collection])),
  )
  const visibleEntries = computed(() => {
    const searchKey = createSearchKey(query.value)
    return props.customTracks
      .map((definition) => {
        const record = recordById.value.get(definition.trackId)
        if (!record) return undefined
        const collection = collectionById.value.get(definition.materialCollectionId)
        const searchable = createSearchKey(
          [
            record.track.title,
            record.customName ?? '',
            definition.creator.displayName,
            collection?.name ?? '',
            ...definition.sourceCredits.flatMap((credit) => [
              credit.artistName,
              credit.artistId ?? '',
            ]),
          ].join('\n'),
        )
        if (searchKey && !searchable.includes(searchKey)) return undefined
        const sourceIds = [...new Set(definition.recipe.map((segment) => segment.sourceTrackId))]
        return {
          definition,
          record,
          collection,
          sourceRecords: sourceIds
            .map((trackId) => recordById.value.get(trackId))
            .filter((source): source is LibraryTrackRecord => source !== undefined),
        }
      })
      .filter((entry) => entry !== undefined)
      .toSorted((left, right) => right.definition.createdAtMs - left.definition.createdAtMs)
  })

  function toggleTrack(trackId: string): void {
    const next = new Set(expandedTrackIds.value)
    if (next.has(trackId)) next.delete(trackId)
    else next.add(trackId)
    expandedTrackIds.value = next
  }

  return {
    definitionById,
    expandedTrackIds,
    exportFormat,
    query,
    toggleTrack,
    visibleEntries,
  }
}

const queryKey = editingStateKey<ShallowRef<string>>(
  'composables/library/use-custom-track-panel.ts:query',
)
const exportFormatKey = editingStateKey<ShallowRef<AudioExportFormat>>(
  'composables/library/use-custom-track-panel.ts:exportFormat',
)
