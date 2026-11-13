import type {
  LibraryTrackRecord,
  MaterialCollection,
  MusicPlaylist,
  SegmentRecipe,
  Track,
} from '@any-music/core'
import type { DeepReadonly, VNodeChild } from 'vue'

import type { MusicPlatformOption } from '../composables/library/use-favorite-filters'
import type { AudioExportFormat } from './audio-export-format'
import type { UiThemeComponent } from './theme-contracts'
import type { TrackDisplayPreferences } from './track-display-preferences'

type Events<Map> = {
  [Key in keyof Map as Key extends string ? `on${Capitalize<Key>}` : never]?: (
    ...args: Map[Key] extends unknown[] ? Map[Key] : never
  ) => void
}
type Control<Props, Emits = {}> = UiThemeComponent<Props & Events<Emits>>

/** Empty selections mean all values; sort criteria use selection order, defaulting to recent. */
export interface TagManagementFilterState {
  selectedPlatformIds: readonly string[]
  usage: readonly ('single' | 'multiple')[]
  platformScope: readonly ('single' | 'multiple')[]
  sortMode: readonly ('updated-desc' | 'name-asc' | 'usage-desc')[]
  searchQuery: string
}
export interface TagOption {
  name: string
  count: number
}
export interface TagManagementTag extends TagOption {
  key: string
  platformIds: readonly string[]
  updatedAtMs: number
}
export type TagDisplayMode = 'fill' | 'rows'
export type TagEntityKind = 'tracks' | 'playlists'
/** Readonly host projection; playlist membership and tag persistence remain host/plugin owned. */
export interface TagPlaylistRecord {
  playlist: MusicPlaylist
  customTags: readonly string[]
  platformIds: readonly string[]
  coverUrl?: string
}
export type TagDetailView = 'actions' | 'edit' | 'platforms' | 'tracks'
export interface TagPlatformOption extends MusicPlatformOption {
  count: number
  isCustom: boolean
}
export interface TagPlatformDrawer {
  platform: TagPlatformOption
  records: readonly LibraryTrackRecord[]
}
interface TagEdits {
  addTag: [track: Track, tag: string]
  removeTag: [track: Track, tag: string]
}

/** Host-adapted neutral specialist controls; themes own the surrounding page layout. */
export interface TagManagementPresentation {
  readonly state: DeepReadonly<{
    readonly entityKind: TagEntityKind
    readonly taggedPlaylistCount: number
    readonly filters: TagManagementFilterState
    readonly filterDraft: TagManagementFilterState | null
    readonly filterPreviewCount: number
    readonly confirming: boolean
    readonly taggedRecords: readonly LibraryTrackRecord[]
    readonly platformOptions: readonly TagPlatformOption[]
    readonly allTagOptions: readonly TagManagementTag[]
    readonly tagOptions: readonly TagManagementTag[]
    readonly hasFilters: boolean
    readonly displayMode: TagDisplayMode
    readonly operatorOpen: boolean
    readonly selectedTagKeys: ReadonlySet<string>
    readonly selectedTags: readonly TagManagementTag[]
    readonly detailTag: TagManagementTag | null
    readonly detailRecords: readonly LibraryTrackRecord[]
    readonly detailPlaylists: readonly TagPlaylistRecord[]
    readonly detailSelectedIds: ReadonlySet<string>
    readonly defaultTrackDisplayPreferences?: TrackDisplayPreferences
    readonly detailView: TagDetailView
    readonly tagNameDraft: string
    readonly mergeOpen: boolean
    readonly mergeTarget: string
    readonly createOpen: boolean
    readonly createNameDraft: string
    readonly errorMessage: string
  }>
  readonly actions: {
    setEntityKind(kind: TagEntityKind): void
    setFilters(value: TagManagementFilterState): void
    beginFilters(): void
    setFilterDraft(value: TagManagementFilterState): void
    applyFilters(): void
    cancelFilters(): void
    resetFilters(): void
    setDisplayMode(mode: TagDisplayMode): void
    setOperatorOpen(open: boolean): void
    activateTag(key: string): void
    toggleAllTags(): void
    closeDetail(): void
    setDetailView(view: TagDetailView): void
    toggleDetailItem(id: string): void
    toggleAllDetailItems(ids: readonly string[]): void
    removeSelectedDetailTags(): Promise<void>
    setTagNameDraft(value: string): void
    editSelectedTag(): void
    beginMerge(): void
    cancelMerge(): void
    setMergeTarget(value: string): void
    beginCreate(): void
    cancelCreate(): void
    setCreateNameDraft(value: string): void
    createTag(): void
    mergeSelectedTags(): Promise<void>
    deleteSelectedTags(): Promise<void>
    getPlatformName(record: LibraryTrackRecord): string
    renameTag(current: string, next: string): Promise<void>
    deleteTag(tag: string): Promise<void>
    addTag(track: Track, tag: string): void
    removeTag(track: Track, tag: string): void
  }
  readonly controls: {
    Create: Control<{ editor: TagManagementPresentation }>
    Filter: Control<
      {
        modelValue: TagManagementFilterState
        platformOptions?: readonly TagPlatformOption[]
        taggedTrackCount: number
        entityKind?: TagEntityKind
        taggedPlaylistCount?: number
        tagCount: number
      },
      { 'update:modelValue': [value: TagManagementFilterState] }
    >
    Maintenance: Control<
      { tagOptions: readonly TagOption[] },
      { renameTag: [current: string, next: string]; deleteTag: [tag: string] }
    >
    Details: UiThemeComponent<
      { editor: TagManagementPresentation; suspended?: boolean },
      { tracks?: () => VNodeChild; playlists?: () => VNodeChild }
    >
    Drawer: Control<
      { platform: TagPlatformOption; records: readonly LibraryTrackRecord[]; expanded: boolean },
      TagEdits & { toggle: [id: string] }
    >
    Track: Control<{ record: LibraryTrackRecord; platformName: string }, TagEdits>
  }
}

export interface MaterialLibraryFilterState {
  query: string
  platformId: string
  tagsDormant?: boolean
  tag: string
  membership: 'all' | 'included' | 'available'
  trackKind: 'all' | 'regular' | 'custom'
  sortMode: 'updated' | 'title' | 'duration'
}
export interface MaterialSegmentStats {
  segmentCount: number
  totalDurationMs: number
}
export interface MusicCreationPresentation {
  readonly state: DeepReadonly<{
    readonly materialCollections: readonly MaterialCollection[]
    readonly records: readonly LibraryTrackRecord[]
    readonly pendingRecords: readonly LibraryTrackRecord[]
    readonly errorMessage: string
    readonly exportBusy: boolean
    readonly exportMessage: string
    readonly activeCollection: MaterialCollection | undefined
    readonly activeCollectionId: string
    readonly title: string
    readonly recipe: readonly SegmentRecipe[]
    readonly exportFormat: AudioExportFormat
    readonly filters: MaterialLibraryFilterState
    readonly visibleRecords: readonly LibraryTrackRecord[]
    readonly collectionTrackIds: ReadonlySet<string>
    readonly platformNames: ReadonlyMap<string, string>
    readonly platformOptions: readonly (MusicPlatformOption & { count: number })[]
    readonly tagStats: readonly TagOption[]
    readonly trackTitles: ReadonlyMap<string, string>
    readonly segmentStatsByTrackId: ReadonlyMap<string, MaterialSegmentStats>
    readonly virtualDurationMs: number
    readonly localError: string
  }>
  readonly actions: {
    setTitle(value: string): void
    setExportFormat(value: AudioExportFormat): void
    setFilters(value: MaterialLibraryFilterState): void
    selectCollection(id: string): Promise<void>
    createCollection(name: string): void
    deleteCollection(id: string, cleanup: boolean): void
    clearData(): Promise<void>
    addMaterial(id: string): void
    addPendingMaterial(id: string): void
    removePendingMaterial(id: string): void
    removeMaterial(id: string): Promise<void>
    addSegment(segment: SegmentRecipe): void
    moveSegment(index: number, offset: -1 | 1): void
    removeSegment(index: number): void
    preview(segment: SegmentRecipe): void
    downloadSegment(segment: SegmentRecipe): void
    downloadDraft(): void
    submit(): void
    formatDuration(ms: number): string
  }
  readonly controls: {
    Collections: Control<
      { collections: readonly MaterialCollection[]; activeCollectionId: string },
      { select: [id: string]; create: [name: string]; delete: [id: string, cleanup: boolean] }
    >
    Filter: Control<
      {
        modelValue: MaterialLibraryFilterState
        platforms: readonly (MusicPlatformOption & { count: number })[]
        tagStats: readonly TagOption[]
      },
      { 'update:modelValue': [value: MaterialLibraryFilterState] }
    >
    Material: Control<
      {
        record: LibraryTrackRecord
        platformName: string
        included: boolean
        segmentCount: number
        clippedDurationMs: number
        exportBusy: boolean
      },
      {
        addMaterial: [id: string]
        removeMaterial: [id: string]
        addSegment: [segment: SegmentRecipe]
        preview: [segment: SegmentRecipe]
        download: [segment: SegmentRecipe]
      }
    >
    Pending: Control<
      {
        records: readonly LibraryTrackRecord[]
        activeCollectionId: string
        platformNames: ReadonlyMap<string, string>
        segmentStatsByTrackId: ReadonlyMap<string, MaterialSegmentStats>
      },
      { addToCollection: [id: string]; remove: [id: string] }
    >
    Timeline: Control<
      {
        segments: readonly SegmentRecipe[]
        trackTitles: ReadonlyMap<string, string>
        exportBusy: boolean
      },
      {
        move: [index: number, offset: -1 | 1]
        remove: [index: number]
        preview: [segment: SegmentRecipe]
        download: [segment: SegmentRecipe]
      }
    >
  }
}

/** Renderless host bindings expose bounded editing projections, never session disposal or storage. */
export type SpecialistEditor<Model> = UiThemeComponent<
  {},
  { default?: (props: { editor: Model }) => VNodeChild }
>
