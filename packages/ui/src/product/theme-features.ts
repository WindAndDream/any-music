import type {
  AppErrorState,
  CustomTrackDefinition,
  DownloadHistoryBatch,
  LibraryTrackRecord,
  MaterialCollection,
  MediaQuality,
  MusicPlaylist,
  MusicSourceDescriptor,
  MusicSourceAvailability,
  PlaybackHistoryEntry,
  PlaybackMode,
  Track,
} from '@any-music/core'
import type { DeepReadonly } from 'vue'

import type {
  CatalogTrackDisplayMode,
  MobileTrackColumns,
} from '../components/music-sources/catalog-track-display-mode'
import type { FavoriteFilterState } from '../composables/library/use-favorite-filters'
import type { CatalogFilterHistorySettings } from '../composables/music-sources/catalog-filter-history-settings'
import type { CatalogTrackFilterState } from '../composables/music-sources/use-catalog-track-filters'
import type { AppShellPreferences, AppThemePreference } from './app-shell-preferences'
import type { AudioExportFormat } from './audio-export-format'
import type { CatalogDrawerView, CatalogRequestKind } from './catalog-drawer'
import type { ProductDestination, ProductViewId } from './product-navigation'
import type { SettingsSectionId } from './settings-navigation'
import type {
  TagManagementPresentation,
  MusicCreationPresentation,
  SpecialistEditor,
} from './specialist-presentation'
import type { CollectionItemStyle, TrackDisplayPreferences } from './track-display-preferences'

export type UiThemeAction = void | Promise<void>
export type UiPluginDevelopmentStatus = 'stable' | 'updating' | 'fixing' | 'developing' | 'disabled'
/** Display metadata only; plugin authority remains in the host. */
export interface UiPluginCenterItem {
  id: string
  name: string
  description: string
  origin: 'builtin' | 'external'
  category: string
  enabled: boolean
  /** Developer maintenance notice; never replaces user enablement or loading/error state. */
  developmentStatus?: UiPluginDevelopmentStatus
  /** Host startup gate; activation attempts show this reason without enabling the module. */
  unavailableReason?: string
  status: UiThemeStatus
  publisher?: string
  generation?: number
}
export type UiThemeAvailability =
  | { readonly status: 'available' }
  | { readonly status: 'disabled' | 'unavailable'; readonly reason: string }
export type UiThemeStatus =
  | { readonly status: 'idle' | 'loading' | 'ready' | 'empty' }
  | { readonly status: 'partial'; readonly errors: readonly DeepReadonly<AppErrorState>[] }
  | { readonly status: 'invalid' | 'error'; readonly error: DeepReadonly<AppErrorState> }

/** Ephemeral source checks; never part of portable playlists or product snapshots. */
export interface UiPlaylistValidation {
  status: 'idle' | 'checking' | 'complete'
  checkedCount: number
  totalCount: number
  issues: readonly { trackId: string; title: string; error: AppErrorState }[]
}

/** Host-owned reactive projections and bound actions; no repositories, credentials or disposers. */
export interface UiThemeFeature<State, Actions> {
  readonly state: DeepReadonly<State>
  readonly actions: Readonly<Actions>
  readonly availability: UiThemeAvailability
  readonly status: UiThemeStatus
}

export interface UiThemeTrackListState {
  tracks: readonly Track[]
  /** Optional host projections shared by library roots; no controller or native authority. */
  playlists?: readonly MusicPlaylist[]
  currentTrackId?: string | null
  downloadBusy?: boolean
  selectedTrackIds: readonly string[]
  invalidTrackIds: readonly string[]
  favoriteTrackIds: readonly string[]
  queuedTrackIds: readonly string[]
  downloadedTrackIds: readonly string[]
  platformNames: ReadonlyMap<string, string>
  customNamesByTrackId: ReadonlyMap<string, string>
  customTagsByTrackId: ReadonlyMap<string, readonly string[]>
  addedAtMsByTrackId: ReadonlyMap<string, number>
  displayMode: CatalogTrackDisplayMode
  mobileColumns: MobileTrackColumns
  itemStyle?: CollectionItemStyle
  displayPreferences?: Readonly<Record<string, TrackDisplayPreferences>>
  defaultDisplayPreferences?: TrackDisplayPreferences
  filters: CatalogTrackFilterState
  filterDraft: CatalogTrackFilterState | null
}
export interface UiThemeTrackListActions {
  play: (trackId: string, collectionTrackIds?: readonly string[]) => UiThemeAction
  download: (trackIds: readonly string[], format?: AudioExportFormat) => UiThemeAction
  toggleFavorite: (trackId: string) => UiThemeAction
  select: (trackIds: readonly string[]) => void
  setFilterDraft: (draft: CatalogTrackFilterState | null) => void
  applyFilters: () => void
  cancelFilters: () => void
  showTrackActions: (trackId: string) => void
  enqueue: (trackIds: readonly string[]) => void
  toggleQueue?: (trackId: string) => UiThemeAction
  rename: (trackId: string, name: string) => void
  addToPlaylist: (playlistId: string, trackIds: readonly string[]) => void
  useAsMaterial: (trackIds: readonly string[]) => void
  addTag: (trackIds: readonly string[], tag: string) => void
  removeTag: (trackId: string, tag: string) => void
  setDisplayMode: (mode: CatalogTrackDisplayMode, scope?: string) => void
  setMobileColumns: (columns: MobileTrackColumns, scope?: string) => void
  setItemStyle?: (style: CollectionItemStyle) => void
}

/** Collection ordering remains host-owned, including the playback order of platform groups. */
export interface UiThemeCollectionState {
  arrangementMode: 'flat' | 'platform'
  mobileLayout: boolean
  platformOrder: readonly string[]
  totalCount: number
  platformTrackCounts: ReadonlyMap<string, number>
}
export interface UiThemeCollectionActions {
  setArrangementMode: (mode: 'flat' | 'platform') => void
  moveTrack: (id: string, targetId: string, visibleIds: readonly string[]) => void
  movePlatform: (id: string, targetId: string, visibleIds: readonly string[]) => void
}

export interface UiThemeFeatureMap {
  shell: UiThemeFeature<
    {
      activeViewId: ProductViewId
      destinations: readonly ProductDestination[]
      hidden: boolean
      description?: string
      presentation?: 'overlay' | 'embedded'
      canHide?: boolean
      resolvedTheme?: 'light' | 'dark'
      /** Host-projected responsive layout; viewport width does not identify the runtime. */
      mobileLayout?: boolean
    },
    {
      navigate: (id: ProductViewId) => void
      hide: () => void
      show: () => void
      openSettings: (section?: SettingsSectionId) => void
    }
  >
  navigation: UiThemeFeature<
    {
      activeViewId: ProductViewId
      destinations: readonly ProductDestination[]
      preferences: AppShellPreferences
      effectiveSidebarCollapsed?: boolean
    },
    {
      navigate: (id: ProductViewId) => void
      setPreferences: (value: AppShellPreferences) => void
      toggleSidebar?: () => void
    }
  >
  player: UiThemeFeature<
    {
      track: Track | null
      playing: boolean
      positionMs: number
      bufferedUntilMs?: number
      statusLabel?: string
      durationMs: number
      volume: number
      playbackRate: number
      mode: PlaybackMode
      quality: MediaQuality
      qualities: readonly MediaQuality[]
      canSeek: boolean
      canDownload: boolean
    },
    {
      play: () => UiThemeAction
      pause: () => void
      previous: () => UiThemeAction
      next: () => UiThemeAction
      seek: (positionMs: number) => void
      setVolume: (volume: number) => void
      setPlaybackRate: (rate: number) => void
      setMode: (mode: PlaybackMode) => void
      setQuality: (quality: MediaQuality) => UiThemeAction
      download: () => UiThemeAction
      retry: () => UiThemeAction
    }
  >
  catalog: UiThemeFeature<
    UiThemeTrackListState & {
      sources: readonly (MusicSourceDescriptor & { enabled: boolean })[]
      sourceId: string
      requestKind: CatalogRequestKind
      accountMissing?: boolean
      searchQuery: string
      importUrl: string
      drawers: readonly CatalogDrawerView[]
      activeDrawerId: string | null
      currentTrackId?: string | null
      playlists: readonly MusicPlaylist[]
      downloadBusy?: boolean
    },
    UiThemeTrackListActions & {
      selectSource: (id: string) => void
      notifyMissingAccount?: () => void
      setSearchQuery: (query: string) => void
      setImportUrl: (url: string) => void
      setRequestKind: (kind: CatalogRequestKind) => void
      submit: () => UiThemeAction
      clear: () => void
      openDrawer: (id: string) => void
      closeDrawer: () => void
      favoriteDrawer: (id: string) => UiThemeAction
      moveDrawer: (id: string, targetId: string, visibleIds: readonly string[]) => void
      restoreDrawerNames: (ids: readonly string[]) => void
      restoreTrackNames: (ids: readonly string[]) => void
      verify: (id: string) => UiThemeAction
      cancelVerification: (id: string) => void
      openSourceSettings: () => void
      toggleQueue: (trackId: string) => void
      requestCreatePlaylist: () => void
      loadMore: (id: string) => UiThemeAction
      retry: (id: string) => UiThemeAction
      cancel: (id: string) => void
      removeDrawer: (id: string) => void
      renameDrawer: (id: string, title: string) => void
      pinDrawer: (id: string, pinned: boolean) => void
    }
  >
  queue: UiThemeFeature<
    UiThemeTrackListState & UiThemeCollectionState & { currentTrackId: string | null },
    UiThemeTrackListActions &
      UiThemeCollectionActions & {
        remove: (trackIds: readonly string[]) => void
        reorder: (trackIds: readonly string[]) => void
        clear: () => UiThemeAction
      }
  >
  favorites: UiThemeFeature<
    UiThemeTrackListState &
      UiThemeCollectionState & {
        favoriteFilters: FavoriteFilterState
        favoriteFilterDraft: FavoriteFilterState | null
        platformOrder: readonly string[]
      },
    UiThemeTrackListActions &
      UiThemeCollectionActions & {
        setFavoriteFilterDraft: (draft: FavoriteFilterState | null) => void
        applyFavoriteFilters: () => void
        cancelFavoriteFilters: () => void
        reorderPlatforms: (platformIds: readonly string[]) => void
      }
  >
  playlists: UiThemeFeature<
    UiThemeTrackListState &
      UiThemeCollectionState & {
        playlists: readonly MusicPlaylist[]
        activePlaylistId: string | null
        query: string
        nameDraft: string
        coverUrls: Readonly<Record<string, string>>
        /** Plays of current playlist members in retained local history, across playback contexts. */
        playCountByPlaylistId?: ReadonlyMap<string, number>
        transferBusy: boolean
        validation?: UiPlaylistValidation
        playlistTagsAvailable?: boolean
        customTagsByPlaylistId?: ReadonlyMap<string, readonly string[]>
      },
    UiThemeTrackListActions &
      UiThemeCollectionActions & {
        reorderPlaylists: (ids: readonly string[]) => void
        addPlaylistTag: (id: string, tag: string) => void
        removePlaylistTag: (id: string, tag: string) => void
        importFile: (file: Blob) => Promise<void>
        exportFile: (id: string) => Promise<void>
        favoritePlaylist: (id: string) => UiThemeAction
        downloadPlaylist: (id: string) => UiThemeAction
        open: (id: string | null) => void
        retryValidation?: () => void
        create: (name: string, description?: string, cover?: string) => UiThemeAction
        saveDetails: (
          id: string,
          name: string,
          description: string,
          cover?: string | null,
        ) => UiThemeAction
        updateDescription: (id: string, description: string) => void
        setQuery: (query: string) => void
        setNameDraft: (name: string) => void
        renamePlaylist: (id: string, name: string) => void
        remove: (ids: string | readonly string[]) => UiThemeAction
        removeTracks: (id: string, trackIds: readonly string[]) => void
        reorderTracks: (id: string, trackIds: readonly string[]) => void
      }
  >
  'custom-tracks': UiThemeFeature<
    UiThemeTrackListState & {
      records: readonly LibraryTrackRecord[]
      definitions: readonly CustomTrackDefinition[]
      materialCollections: readonly MaterialCollection[]
      query: string
      expandedTrackIds: readonly string[]
      exportFormat: AudioExportFormat
      exportBusy: boolean
    },
    UiThemeTrackListActions & {
      remove: (trackIds: readonly string[]) => UiThemeAction
      edit: (trackId: string) => void
      setQuery: (query: string) => void
      setExpanded: (trackId: string, expanded: boolean) => void
      setExportFormat: (format: AudioExportFormat) => void
    }
  >
  history: UiThemeFeature<
    Pick<
      UiThemeTrackListState,
      | 'currentTrackId'
      | 'favoriteTrackIds'
      | 'queuedTrackIds'
      | 'invalidTrackIds'
      | 'customTagsByTrackId'
      | 'downloadBusy'
      | 'playlists'
      | 'itemStyle'
    > & {
      mobileLayout: boolean
      entries: readonly PlaybackHistoryEntry[]
      tracks: readonly Track[]
      platformNames: ReadonlyMap<string, string>
      customNamesByTrackId: ReadonlyMap<string, string>
      query: string
      platformId: string
      startedAfterMs: number | null
    },
    Pick<
      UiThemeTrackListActions,
      | 'download'
      | 'toggleFavorite'
      | 'rename'
      | 'addToPlaylist'
      | 'useAsMaterial'
      | 'addTag'
      | 'removeTag'
      | 'setItemStyle'
    > & {
      setQuery: (query: string) => void
      setPlatform: (id: string) => void
      setStartedAfter: (timeMs: number | null) => void
      toggleQueue: (trackId: string) => void
      play: (trackId: string, collectionTrackIds?: readonly string[]) => UiThemeAction
      enqueue: (trackIds: readonly string[]) => void
      clear: () => UiThemeAction
    }
  >
  downloads: UiThemeFeature<
    Omit<UiThemeTrackListState, 'selectedTrackIds'> & {
      batches: readonly DownloadHistoryBatch[]
      itemOrder?: readonly string[]
      selectedItemIds: readonly string[]
      concurrency: number
      mobileLayout: boolean
      statusFilter: 'all' | 'downloading' | 'paused' | 'succeeded' | 'failed'
    },
    Omit<UiThemeTrackListActions, 'select' | 'download'> & {
      select: (itemIds: readonly string[]) => void
      moveItem: (id: string, targetId: string, visibleIds: readonly string[]) => void
      pause: (itemIds: readonly string[]) => void
      resume: (itemIds: readonly string[]) => UiThemeAction
      cancel: (itemIds: readonly string[]) => void
      remove: (itemIds: readonly string[]) => UiThemeAction
      retry: (itemIds: readonly string[]) => UiThemeAction
      setStatusFilter: (status: 'all' | 'downloading' | 'paused' | 'succeeded' | 'failed') => void
    }
  >
  plugins: UiThemeFeature<
    {
      items: readonly UiPluginCenterItem[]
      externalSupported: boolean
      defaultDisplay?: 'grid' | 'list'
      busy: boolean
      errorMessage?: string
    },
    {
      setEnabled: (id: string, enabled: boolean) => UiThemeAction
      retry: (id: string) => UiThemeAction
      importPlugin: () => void
      manageExternal: (id: string) => void
      refresh: () => UiThemeAction
    }
  >
  settings: UiThemeFeature<
    {
      section: SettingsSectionId | null
      open: boolean
      isMobileLayout: boolean
      suspended: boolean
      destinations: readonly ProductDestination[]
      sources: readonly MusicSourceDescriptor[]
      enabledSourceIds: readonly string[]
      availabilityBySourceId: Readonly<Record<string, MusicSourceAvailability>>
      externalSourcesEnabled: boolean
      profileId: string
      networkSummary?: string
      accountSummary?: string
      networkTitle?: string
      networkDescription?: string
      appearance: AppThemePreference
      themeId: string
      themeError?: string
      themes: readonly { id: string; title: string; unavailableReason?: string }[]
      preferences: AppShellPreferences
      playbackHistoryLimit: number
      downloadConcurrency: number
      creatorDisplayName: string
      filterHistory: CatalogFilterHistorySettings
      displayDefaults?: import('./track-display-preferences').CollectionDisplayDefaults
    },
    {
      close: () => void
      selectSection: (section: SettingsSectionId | null) => void
      setSourceEnabled: (id: string, enabled: boolean) => void
      checkSource: (id: string) => UiThemeAction
      setAppearance: (value: AppThemePreference) => void
      selectTheme: (id: string) => UiThemeAction
      setPreferences: (value: AppShellPreferences) => void
      setPlaybackHistoryLimit: (limit: number) => void
      setDownloadConcurrency: (count: number) => void
      setCreatorDisplayName: (name: string) => void
      setFilterHistory: (value: CatalogFilterHistorySettings) => AppErrorState | void
      setDisplayDefault?: import('./track-display-preferences').SetCollectionDisplayDefault
    }
  >
  overlays: UiThemeFeature<
    {
      active:
        | null
        | { kind: 'track-actions'; trackId: string }
        | { kind: 'filters'; viewId: ProductViewId }
        | {
            kind: 'confirmation'
            id: number
            title: string
            message: string
            confirmLabel: string
            cancelLabel?: string
            tone?: 'default' | 'danger'
            details?: readonly { label: string; text: string }[]
          }
      notice: { message: string; tone: 'success' | 'error' | 'info' | 'warning' | 'neutral' } | null
    },
    {
      close: (requestId?: number) => void
      confirm: (requestId: number) => UiThemeAction
      dismissNotice: () => void
      setNoticePaused: (isPaused: boolean) => void
    }
  >
  tags: UiThemeFeature<
    { Editor: SpecialistEditor<TagManagementPresentation> | null },
    { retry: () => UiThemeAction }
  >
  composer: UiThemeFeature<
    { Editor: SpecialistEditor<MusicCreationPresentation> | null },
    { retry: () => UiThemeAction }
  >
}
