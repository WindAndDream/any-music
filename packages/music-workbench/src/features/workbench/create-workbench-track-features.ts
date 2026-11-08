import { AppError, createAppErrorState, validatePlaylistName } from '@any-music/core'
import type { Track } from '@any-music/core'
import {
  cloneCatalogTrackFilterState,
  createCatalogTrackFilterState,
  filterCatalogTracks,
} from '@any-music/ui/catalog'
import type { CatalogTrackFilterState, CatalogRequestKind } from '@any-music/ui/catalog'
import { useFavoriteFilters } from '@any-music/ui/library'
import { COLLECTION_DISPLAY_GROUPS } from '@any-music/ui/library'
import type { SetCollectionDisplayDefault } from '@any-music/ui/library'
import type { FavoriteFilterState } from '@any-music/ui/library'
import type {
  UiThemeFeatureMap,
  UiThemeTrackListState,
  UiThemeTrackListActions,
} from '@any-music/ui/theme'
import { computed, shallowRef, watch } from 'vue'

import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'
import { useDownloadCollectionOrder } from '../downloads/use-download-collection-order'
import { useCollectionDisplayPreferences } from '../library/use-collection-display-preferences'
import { usePlaylistArtwork } from '../library/use-playlist-artwork'
import { usePlaylistFileTransfer } from '../library/use-playlist-file-transfer'
import { usePlaylistValidation } from '../library/use-playlist-validation'
import { reorderQueueIds } from '../player/playback-queue-state'
import type { WorkbenchController } from './use-workbench-controller'

type CollectionId = 'catalog' | 'queue' | 'favorites' | 'playlists' | 'custom-tracks' | 'downloads'
function createCollection() {
  return {
    selected: shallowRef<readonly string[]>([]),
    filters: shallowRef(createCatalogTrackFilterState()),
    draft: shallowRef<CatalogTrackFilterState | null>(null),
  }
}

/** One stable adapter per controller. Theme roots receive data/intents, never business owners. */
export function createWorkbenchTrackFeatures(controller: WorkbenchController) {
  const c = controller
  const cells = new Map<string, ReturnType<typeof createCollection>>()
  const requestKind = shallowRef<CatalogRequestKind>('search')
  const playlistId = shallowRef<string | null>(null)
  const playlistQuery = shallowRef('')
  const playlistName = shallowRef('')
  const validation = usePlaylistValidation({
    playlist: () =>
      c.activeTab.value === 'playlists'
        ? c.library.playlists.value.find(({ id }) => id === playlistId.value)
        : undefined,
    getTrack: c.library.getTrack,
    leafIds: (track) =>
      track.source.mediaKind === 'custom'
        ? [
            ...new Set(
              c.library
                .getCustomTrack(track.id)
                ?.compiledSegments.map(({ sourceTrackId }) => sourceTrackId) ?? [track.id],
            ),
          ]
        : [track.id],
    check: async (track, cancellation) => {
      if (!c.registry.getPlugin(track.source.pluginId))
        throw new AppError('media-unavailable', `歌曲所需音乐源未安装：${track.source.pluginId}`)
      const availability = c.registry.getAvailability(track.source.pluginId)
      if (availability.status === 'invalid' || availability.status === 'unavailable')
        throw new AppError(availability.error.code, availability.error.message)
      if (!c.registry.canPrefetchMedia(track))
        throw new AppError(
          'media-unavailable',
          '音乐源未就绪、已停用或不支持歌曲可用性检查，请启用音乐源后重试。',
        )
      // Resolve descriptors only; do not assign audio, read media bytes or retain URLs/grants.
      const media = await c.registry.resolveMedia(track, { cancellation })
      media.release?.()
    },
  })
  const playCountByPlaylistId = computed(() => {
    const counts = new Map<string, number>()
    for (const entry of c.library.history.value)
      counts.set(entry.trackId, (counts.get(entry.trackId) ?? 0) + 1)
    return new Map(
      c.library.playlists.value.map((playlist) => [
        playlist.id,
        [...new Set(playlist.trackIds)].reduce((total, id) => total + (counts.get(id) ?? 0), 0),
      ]),
    )
  })
  const artwork = usePlaylistArtwork(
    c.library.playlists,
    getWorkbenchRuntime().playlistCovers,
    () => !c.library.persistenceErrorState.value,
  )
  const transfer = usePlaylistFileTransfer({
    library: c.library,
    assertActive: artwork.assertActive,
  })
  const playlistArrangement = shallowRef<'flat' | 'platform'>('flat')
  const customQuery = shallowRef('')
  const expanded = shallowRef<readonly string[]>([])
  const exportFormat = shallowRef<'mp3' | 'wav'>('mp3')
  const downloadStatus = shallowRef<UiThemeFeatureMap['downloads']['state']['statusFilter']>('all')
  const display = {
    catalog: useCollectionDisplayPreferences('catalog'),
    history: useCollectionDisplayPreferences('history'),
    'custom-tracks': useCollectionDisplayPreferences('custom-tracks'),
    queue: useCollectionDisplayPreferences('queue'),
    favorites: useCollectionDisplayPreferences('favorites'),
    downloads: useCollectionDisplayPreferences('downloads'),
    playlists: useCollectionDisplayPreferences('playlists'),
    tags: useCollectionDisplayPreferences('tags'),
    plugins: useCollectionDisplayPreferences('plugins'),
  }
  const downloadOrder = useDownloadCollectionOrder(c.downloads.batches)
  const displayScope = (id: CollectionId) =>
    id === 'queue'
      ? c.queue.arrangementMode.value
      : id === 'favorites'
        ? c.favoriteCollection.arrangementMode.value
        : id === 'playlists'
          ? playlistId.value
            ? `${playlistId.value}:${playlistArrangement.value}`
            : 'overview:flat'
          : id === 'downloads'
            ? downloadStatus.value
            : 'flat'
  const favoriteFilters = useFavoriteFilters(
    c.library.records,
    c.favoritePlatforms,
    c.library.customTracks,
  )
  const favoriteDraft = shallowRef<FavoriteFilterState | null>(null)
  const visibleFavoriteIds = computed(
    () => new Set(favoriteFilters.visibleRecords.value.map(({ track }) => track.id)),
  )
  const historyAfter = shallowRef<number | null>(null)
  const actionTrack = shallowRef<string>()
  const cell = (id: CollectionId) => {
    const key =
      id === 'catalog'
        ? `catalog:${c.activeCatalogDrawerId.value ?? 'root'}`
        : id === 'playlists'
          ? `playlists:${playlistId.value ?? 'root'}`
          : id
    let value = cells.get(key)
    if (!value) {
      value = createCollection()
      cells.set(key, value)
    }
    return value
  }
  watch(
    () => c.tagManagement.available.value,
    (available) => {
      if (available) return
      for (const value of cells.values()) {
        if (value.filters.value.tags.length)
          value.filters.value = { ...value.filters.value, tagsDormant: true }
        if (value.draft.value?.tags.length)
          value.draft.value = { ...value.draft.value, tagsDormant: true }
      }
    },
    { flush: 'sync' },
  )
  const allTracks = computed(
    () =>
      new Map([
        ...c.library.records.value.map(({ track }) => [track.id, track] as const),
        ...c.queue.items.value.map((track) => [track.id, track] as const),
        ...c.workspace.drawers.value.flatMap(({ tracks }) =>
          tracks.map((track) => [track.id, track] as const),
        ),
        ...c.downloads.batches.value.flatMap(({ items }) =>
          items.map(({ track }) => [track.id, track] as const),
        ),
      ]),
  )
  const tracksFor = (ids: readonly string[]) =>
    [...new Set(ids)].flatMap((id) => allTracks.value.get(id) ?? [])
  const collectionState = (tracks: readonly Track[], arrangementMode: 'flat' | 'platform') => {
    const platformTrackCounts = new Map<string, number>()
    for (const track of tracks)
      platformTrackCounts.set(
        track.source.pluginId,
        (platformTrackCounts.get(track.source.pluginId) ?? 0) + 1,
      )
    return {
      arrangementMode,
      mobileLayout: c.isMobileViewport.value,
      totalCount: tracks.length,
      platformTrackCounts,
      platformOrder: [...platformTrackCounts.keys()],
    }
  }
  const sourceTracks = (id: CollectionId): readonly Track[] => {
    switch (id) {
      case 'catalog':
        return c.activeCatalogDrawer.value?.tracks ?? []
      case 'queue':
        return c.queue.items.value
      case 'favorites':
        return c.favoriteCollection.records.value
          .filter(({ track }) => visibleFavoriteIds.value.has(track.id))
          .map(({ track }) => track)
      case 'playlists':
        return tracksFor(
          c.library.playlists.value.find((entry) => entry.id === playlistId.value)?.trackIds ?? [],
        )
      case 'custom-tracks':
        return c.library.records.value
          .filter(({ track }) => track.source.mediaKind === 'custom')
          .map(({ track }) => track)
      case 'downloads':
        return c.downloads.batches.value.flatMap(({ items }) => items.map(({ track }) => track))
    }
  }
  const collectionKinds: readonly CollectionId[] = [
    'catalog',
    'queue',
    'favorites',
    'playlists',
    'custom-tracks',
    'downloads',
  ]
  const sourceLists = new Map(
    collectionKinds.map((id) => [id, computed(() => sourceTracks(id))] as const),
  )
  const filteredLists = new Map(
    collectionKinds.map(
      (id) =>
        [
          id,
          computed(() =>
            filterCatalogTracks(
              sourceLists.get(id)!.value,
              c.library.customTagsByTrackId.value,
              cell(id).filters.value,
              c.library.customNamesByTrackId.value,
              c.tagManagement.available.value,
            ),
          ),
        ] as const,
    ),
  )
  const invalidTrackIds = computed(() => [...c.workspace.invalidTrackIds.value])
  const favoriteTrackIds = computed(() => [...c.library.favoriteTrackIds.value])
  const queuedTrackIds = computed(() => [...c.queue.trackIds.value])
  const downloadedTrackIds = computed(() => [...c.downloadedTrackIds.value])
  const addedTimes = computed(
    () => new Map(c.library.records.value.map(({ track, addedAtMs }) => [track.id, addedAtMs])),
  )
  const favoriteTimes = computed(
    () =>
      new Map(
        c.library.records.value.map(({ track, addedAtMs, favoritedAtMs }) => [
          track.id,
          favoritedAtMs ?? addedAtMs,
        ]),
      ),
  )
  const state = (id: CollectionId): UiThemeTrackListState => ({
    tracks: filteredLists.get(id)!.value,
    playlists: c.library.playlists.value,
    currentTrackId: c.playerTrack.value?.id,
    downloadBusy: c.downloadBusy.value,
    selectedTrackIds: cell(id).selected.value,
    invalidTrackIds: invalidTrackIds.value,
    favoriteTrackIds: favoriteTrackIds.value,
    queuedTrackIds: queuedTrackIds.value,
    downloadedTrackIds: downloadedTrackIds.value,
    platformNames: c.platformNameById.value,
    customNamesByTrackId: c.library.customNamesByTrackId.value,
    customTagsByTrackId: c.library.customTagsByTrackId.value,
    addedAtMsByTrackId:
      id === 'queue'
        ? c.queue.addedAtMsByTrackId.value
        : id === 'favorites'
          ? favoriteTimes.value
          : addedTimes.value,
    displayMode: display[id].get(displayScope(id)).displayMode,
    mobileColumns: display[id].get(displayScope(id)).mobileColumns,
    itemStyle: display[id].get('items').itemStyle ?? 'minimal',
    defaultDisplayPreferences: display[id].getDefault('tracks'),
    displayPreferences:
      id === 'playlists'
        ? Object.fromEntries(
            Object.entries(display.playlists.preferences.value)
              .filter(([scope]) => scope.startsWith(`${playlistId.value ?? 'overview'}:`))
              .map(([scope, value]) => [
                scope.slice((playlistId.value ?? 'overview').length + 1),
                value,
              ]),
          )
        : display[id].preferences.value,
    filters: cell(id).filters.value,
    filterDraft: cell(id).draft.value,
  })
  const actions = (id: CollectionId): UiThemeTrackListActions => {
    const owner = cell(id)
    const drawerId = c.activeCatalogDrawerId.value
    const currentPlaylist = playlistId.value
    const current = () =>
      cell(id) === owner && (id !== 'playlists' || playlistId.value === currentPlaylist)
    return {
      setItemStyle: (itemStyle) => {
        if (current()) display[id].set('items', { itemStyle })
      },
      play: (trackId, collectionIds) => {
        const track = allTracks.value.get(trackId)
        if (!current() || !track || c.workspace.invalidTrackIds.value.has(trackId)) return
        const collection = collectionIds?.length ? tracksFor(collectionIds) : [track]
        c.library.rememberTracks(collection)
        if (collectionIds?.length) c.playFavoriteTrack(track, collection)
        else c.playTrack(track)
      },
      download: (ids, format) => {
        if (!current()) return
        const tracks = tracksFor(ids).filter(
          (track) => !c.workspace.invalidTrackIds.value.has(track.id),
        )
        if (id === 'catalog' && drawerId) c.downloadCatalogTracks(tracks, drawerId)
        else if (id === 'playlists') {
          const playlist = c.library.playlists.value.find((entry) => entry.id === currentPlaylist)
          if (playlist) c.downloadPlaylistTracks(tracks, playlist)
        } else if (id === 'custom-tracks') {
          for (const track of tracks) c.downloadCustomTrack(track.id, format ?? exportFormat.value)
        } else if (id === 'queue') c.downloadQueueTracks(tracks)
        else c.downloadFavoriteTracks(tracks)
      },
      select: (ids) => {
        if (current()) owner.selected.value = [...new Set(ids)]
      },
      toggleFavorite: (trackId) => {
        const track = allTracks.value.get(trackId)
        if (current() && track) c.toggleTrackFavorite(track)
      },
      setFilterDraft: (draft) => {
        if (current()) owner.draft.value = draft ? cloneCatalogTrackFilterState(draft) : null
      },
      applyFilters: () => {
        if (current() && owner.draft.value) {
          owner.filters.value = cloneCatalogTrackFilterState(owner.draft.value)
          owner.draft.value = null
        }
      },
      cancelFilters: () => {
        if (current()) owner.draft.value = null
      },
      showTrackActions: (trackId) => {
        if (current()) actionTrack.value = trackId
      },
      enqueue: (ids) => {
        if (current()) c.queueTracks(tracksFor(ids))
      },
      toggleQueue: (trackId) => {
        const track = allTracks.value.get(trackId)
        if (current() && track) c.toggleTrackQueue(track)
      },
      rename: (trackId, name) => {
        const track = allTracks.value.get(trackId)
        if (current() && track) c.renameTrack(track, name)
      },
      addToPlaylist: (targetPlaylistId, ids) => {
        if (current()) c.addTracksToPlaylist(targetPlaylistId, tracksFor(ids))
      },
      useAsMaterial: (ids) => {
        if (current()) for (const track of tracksFor(ids)) c.openCatalogComposer(track)
      },
      addTag: (ids, tag) => {
        if (current()) for (const track of tracksFor(ids)) c.addTag(track, tag)
      },
      removeTag: (trackId, tag) => {
        const track = allTracks.value.get(trackId)
        if (current() && track) c.removeTag(track, tag)
      },
      setDisplayMode: (value, scope) => {
        if (!current()) return
        display[id].set(
          id === 'playlists'
            ? scope
              ? `${playlistId.value ?? 'overview'}:${scope}`
              : displayScope(id)
            : (scope ?? displayScope(id)),
          { displayMode: value },
        )
      },
      setMobileColumns: (value, scope) => {
        if (!current()) return
        display[id].set(
          id === 'playlists'
            ? scope
              ? `${playlistId.value ?? 'overview'}:${scope}`
              : displayScope(id)
            : (scope ?? displayScope(id)),
          { mobileColumns: value },
        )
      },
    }
  }
  const ready = { status: 'ready' as const }
  const available = { status: 'available' as const }
  const feature = (id: CollectionId) => ({
    state: state(id),
    actions: actions(id),
    status: sourceLists.get(id)!.value.length ? ready : { status: 'empty' as const },
    availability: available,
  })
  // Cache each collection independently so a display preference does not invalidate every list.
  const catalog = computed<UiThemeFeatureMap['catalog']>(() => ({
    ...feature('catalog'),
    status: c.activeCatalogDrawer.value?.errorCode
      ? {
          status: 'error',
          error: createAppErrorState(
            c.activeCatalogDrawer.value.errorCode,
            c.activeCatalogDrawer.value.errorMessage,
          ),
        }
      : c.activeCatalogDrawer.value?.isLoading
        ? { status: 'loading' }
        : feature('catalog').status,
    state: {
      ...state('catalog'),
      sources: c.registry.plugins.value.map(({ descriptor }) => ({
        ...descriptor,
        enabled: c.workspace.isPluginEnabled(descriptor.id),
      })),
      sourceId: c.registry.activePluginId.value,
      requestKind: requestKind.value,
      searchQuery: c.workspace.searchQuery.value,
      importUrl: c.workspace.importUrl.value,
      drawers: c.workspace.drawers.value,
      activeDrawerId: c.activeCatalogDrawerId.value ?? null,
      playlists: c.library.playlists.value,
    },
    actions: {
      ...actions('catalog'),
      selectSource: c.handleActivatePlugin,
      setSearchQuery: (value) => {
        c.workspace.searchQuery.value = value
      },
      setImportUrl: (value) => {
        c.workspace.importUrl.value = value
      },
      setRequestKind: (kind) => {
        requestKind.value = kind
      },
      submit: async () => {
        if (requestKind.value === 'search') await c.workspace.search(c.workspace.searchQuery.value)
        else await c.workspace.importFromUrl(c.workspace.importUrl.value)
      },
      clear: () => {
        c.workspace.searchQuery.value = ''
        c.workspace.importUrl.value = ''
      },
      openDrawer: c.openCatalogDrawer,
      closeDrawer: c.closeCatalogDrawer,
      favoriteDrawer: c.favoriteDrawer,
      moveDrawer: c.moveDrawer,
      restoreDrawerNames: c.restoreDrawerNames,
      restoreTrackNames: c.restoreTrackNames,
      verify: c.verifyCatalogDrawer,
      cancelVerification: c.workspace.cancelVerification,
      openSourceSettings: () => c.openGlobalSettings('sources'),
      toggleQueue: (id) => {
        const track = allTracks.value.get(id)
        if (track) c.toggleTrackQueue(track)
      },
      requestCreatePlaylist: c.openPlaylistCreation,
      loadMore: c.workspace.loadNext,
      retry: c.retryCatalogDrawer,
      cancel: c.workspace.cancel,
      removeDrawer: (id) => c.removeDrawers([id]),
      renameDrawer: c.renameDrawer,
      pinDrawer: (id, pinned) => {
        if (
          Boolean(c.workspace.drawers.value.find((drawer) => drawer.id === id)?.isPinned) !== pinned
        )
          c.toggleDrawerPinned(id)
      },
    },
  }))
  const queue = computed<UiThemeFeatureMap['queue']>(() => ({
    ...feature('queue'),
    state: {
      ...state('queue'),
      currentTrackId: c.queue.currentTrackId.value ?? null,
      ...collectionState(c.queue.items.value, c.queue.arrangementMode.value),
    },
    actions: {
      ...actions('queue'),
      setArrangementMode: c.queue.setArrangementMode,
      moveTrack: c.queue.move,
      movePlatform: c.queue.movePlatform,
      remove: c.removeQueueTracks,
      reorder: (ids) => {
        for (let i = ids.length - 2; i >= 0; i--) c.queue.move(ids[i]!, ids[i + 1]!, ids)
      },
      clear: () => c.removeQueueTracks(c.queue.items.value.map(({ id }) => id)),
    },
  }))
  const favorites = computed<UiThemeFeatureMap['favorites']>(() => ({
    ...feature('favorites'),
    state: {
      ...state('favorites'),
      favoriteFilters: favoriteFilters.filters.value,
      favoriteFilterDraft: favoriteDraft.value,
      ...collectionState(
        c.favoriteCollection.records.value.map(({ track }) => track),
        c.favoriteCollection.arrangementMode.value,
      ),
      platformOrder: [
        ...new Set([
          ...c.favoriteCollection.records.value.map(({ track }) => track.source.pluginId),
          ...c.favoritePlatforms.value.map(({ id }) => id),
        ]),
      ],
    },
    actions: {
      ...actions('favorites'),
      setArrangementMode: c.favoriteCollection.setArrangementMode,
      moveTrack: c.favoriteCollection.move,
      movePlatform: c.favoriteCollection.movePlatform,
      setFavoriteFilterDraft: (draft) => {
        favoriteDraft.value = draft ? { ...draft } : null
      },
      applyFavoriteFilters: () => {
        if (favoriteDraft.value) favoriteFilters.filters.value = { ...favoriteDraft.value }
        favoriteDraft.value = null
      },
      cancelFavoriteFilters: () => {
        favoriteDraft.value = null
      },
      reorderPlatforms: (ids) => {
        c.favoriteCollection.setArrangementMode('platform')
        for (let i = ids.length - 2; i >= 0; i--)
          c.favoriteCollection.movePlatform(ids[i]!, ids[i + 1]!, ids)
      },
    },
  }))
  const playlists = computed<UiThemeFeatureMap['playlists']>(() => {
    // Bind tag actions to this plugin session so old UI events cannot write after re-enable.
    const session = c.tagManagement.actions.value
    function requirePlaylist(id: string) {
      if (!c.library.playlists.value.some((playlist) => playlist.id === id))
        throw new AppError('not-found', '找不到歌单。')
      if (!session) throw new AppError('conflict', '标签功能未启用或尚未就绪。')
      return session
    }
    return {
      ...feature('playlists'),
      state: {
        ...state('playlists'),
        playlistTagsAvailable: c.tagManagement.available.value,
        customTagsByPlaylistId: c.tagManagement.tagsByPlaylistId.value,
        ...collectionState(sourceTracks('playlists'), playlistArrangement.value),
        playlists: c.library.playlists.value,
        activePlaylistId: playlistId.value,
        query: playlistQuery.value,
        nameDraft: playlistName.value,
        coverUrls: artwork.urls.value,
        playCountByPlaylistId: playCountByPlaylistId.value,
        transferBusy: transfer.busy.value,
        validation: validation.state.value,
      },
      actions: {
        ...actions('playlists'),
        addPlaylistTag: (id, tag) => requirePlaylist(id).addPlaylistTag(id, tag),
        removePlaylistTag: (id, tag) => requirePlaylist(id).removePlaylistTag(id, tag),
        importFile: transfer.importFile,
        exportFile: transfer.exportFile,
        retryValidation: validation.retry,
        favoritePlaylist: (id) => {
          const playlist = c.library.playlists.value.find((entry) => entry.id === id)
          if (playlist)
            c.favoriteTracks(
              tracksFor(playlist.trackIds).filter(
                (track) =>
                  !c.library.favoriteTrackIds.value.has(track.id) &&
                  !c.workspace.invalidTrackIds.value.has(track.id),
              ),
            )
        },
        downloadPlaylist: (id) => {
          const playlist = c.library.playlists.value.find((entry) => entry.id === id)
          if (playlist)
            c.downloadPlaylistTracks(
              tracksFor(playlist.trackIds).filter(
                (track) => !c.workspace.invalidTrackIds.value.has(track.id),
              ),
              playlist,
            )
        },
        reorderPlaylists: c.library.reorderPlaylists,
        updateDescription: c.library.updatePlaylistDescription,
        setArrangementMode: (mode) => {
          if (mode === 'platform' && playlistArrangement.value !== mode) {
            const playlist = c.library.playlists.value.find(
              (entry) => entry.id === playlistId.value,
            )
            if (playlist) {
              const groups = new Map<string, string[]>()
              for (const track of sourceTracks('playlists')) {
                const group = groups.get(track.source.pluginId) ?? []
                group.push(track.id)
                groups.set(track.source.pluginId, group)
              }
              c.reorderPlaylistTracks(playlist.id, [...groups.values()].flat())
            }
          }
          playlistArrangement.value = mode
        },
        moveTrack: (id, target, visibleIds) => {
          const playlist = c.library.playlists.value.find((entry) => entry.id === playlistId.value)
          if (playlist)
            c.reorderPlaylistTracks(
              playlist.id,
              reorderQueueIds(playlist.trackIds, id, target, visibleIds),
            )
        },
        movePlatform: (id, target, visibleIds) => {
          const playlist = c.library.playlists.value.find((entry) => entry.id === playlistId.value)
          if (!playlist) return
          const tracks = sourceTracks('playlists')
          const groups = new Map<string, string[]>()
          for (const track of tracks) {
            const group = groups.get(track.source.pluginId) ?? []
            group.push(track.id)
            groups.set(track.source.pluginId, group)
          }
          const order = reorderQueueIds([...groups.keys()], id, target, visibleIds)
          c.reorderPlaylistTracks(
            playlist.id,
            order.flatMap((key) => groups.get(key) ?? []),
          )
        },
        open: (id) => {
          playlistId.value = id
        },
        create: (name, description = '', cover) => {
          validatePlaylistName(name, c.library.playlists.value)
          if (description.normalize('NFKC').trim().length > 500)
            throw new AppError('invalid-input', '简介不能超过 500 个字符。')
          const commit = (coverId?: string) => {
            artwork.assertActive()
            validatePlaylistName(name, c.library.playlists.value)
            c.createPlaylist(name, description, coverId)
            if (c.library.persistenceErrorState.value)
              throw new AppError(
                'storage-write-failed',
                c.library.persistenceErrorState.value.message,
              )
          }
          return cover ? artwork.store(cover).then(commit) : commit()
        },
        saveDetails: async (id, name, description, cover) => {
          validatePlaylistName(name, c.library.playlists.value, id)
          if (description.normalize('NFKC').trim().length > 500)
            throw new AppError('invalid-input', '简介不能超过 500 个字符。')
          const playlist = c.library.playlists.value.find((item) => item.id === id)
          if (!playlist) throw new AppError('not-found', '找不到歌单。')
          const coverId = cover === undefined ? playlist.coverId : await artwork.store(cover)
          artwork.assertActive()
          c.library.updatePlaylistDetails(id, name, description, coverId)
          if (c.library.persistenceErrorState.value)
            throw new AppError(
              'storage-write-failed',
              c.library.persistenceErrorState.value.message,
            )
        },
        setQuery: (query) => {
          playlistQuery.value = query
        },
        setNameDraft: (name) => {
          playlistName.value = name
        },
        renamePlaylist: c.renamePlaylist,
        remove: c.deletePlaylist,
        removeTracks: (id, ids) => {
          for (const trackId of ids) c.removeTrackFromPlaylist(id, trackId)
        },
        reorderTracks: c.reorderPlaylistTracks,
      },
    }
  })
  const customTracks = computed<UiThemeFeatureMap['custom-tracks']>(() => ({
    ...feature('custom-tracks'),
    state: {
      ...state('custom-tracks'),
      records: c.library.records.value.filter(({ track }) => track.source.mediaKind === 'custom'),
      definitions: c.publishedTrackViews.value,
      materialCollections: c.musicCreation.state.value.materialCollections,
      query: customQuery.value,
      expandedTrackIds: expanded.value,
      exportFormat: exportFormat.value,
      exportBusy: c.downloadBusy.value,
    },
    actions: {
      ...actions('custom-tracks'),
      remove: (ids) => {
        for (const id of ids) c.removeLibraryTrack(id)
      },
      edit: c.openLibraryComposer,
      setQuery: (query) => {
        customQuery.value = query
      },
      setExpanded: (id, value) => {
        expanded.value = value
          ? [...new Set([...expanded.value, id])]
          : expanded.value.filter((entry) => entry !== id)
      },
      setExportFormat: (format) => {
        exportFormat.value = format
      },
    },
  }))
  const downloads = computed<UiThemeFeatureMap['downloads']>(() => ({
    ...feature('downloads'),
    state: {
      ...state('downloads'),
      batches: c.downloads.batches.value,
      itemOrder: downloadOrder.itemOrder.value,
      selectedItemIds: cell('downloads').selected.value,
      concurrency: c.workspace.downloadConcurrency.value,
      mobileLayout: c.isMobileViewport.value,
      statusFilter: downloadStatus.value,
    },
    actions: {
      ...actions('downloads'),
      select: (ids) => {
        cell('downloads').selected.value = [...new Set(ids)]
      },
      pause: c.downloads.pauseDownloadItems,
      moveItem: downloadOrder.move,
      resume: c.downloads.resumeDownloadItems,
      cancel: c.downloads.cancelDownloadItems,
      remove: c.downloads.removeDownloadItems,
      retry: c.downloads.resumeDownloadItems,
      setStatusFilter: (value) => {
        downloadStatus.value = value
      },
    },
  }))
  const history = computed<UiThemeFeatureMap['history']>(() => ({
    availability: available,
    status: ready,
    state: {
      itemStyle: display.history.get('items').itemStyle ?? 'minimal',
      entries: c.library.history.value,
      mobileLayout: c.isMobileViewport.value,
      currentTrackId: c.playerTrack.value?.id,
      favoriteTrackIds: favoriteTrackIds.value,
      queuedTrackIds: queuedTrackIds.value,
      invalidTrackIds: invalidTrackIds.value,
      customTagsByTrackId: c.library.customTagsByTrackId.value,
      downloadBusy: c.downloadBusy.value,
      playlists: c.library.playlists.value,
      tracks: c.library.records.value.map(({ track }) => track),
      platformNames: c.platformNameById.value,
      customNamesByTrackId: c.library.customNamesByTrackId.value,
      query: c.historyQuery.value,
      platformId: c.historyPlatformId.value,
      startedAfterMs: historyAfter.value,
    },
    actions: {
      setItemStyle: (itemStyle) => display.history.set('items', { itemStyle }),
      setQuery: (value) => {
        c.historyQuery.value = value
      },
      setPlatform: (value) => {
        c.historyPlatformId.value = value
      },
      setStartedAfter: (value) => {
        historyAfter.value = value
      },
      play: (trackId, collectionIds) => {
        const track = allTracks.value.get(trackId)
        if (!track || c.workspace.invalidTrackIds.value.has(trackId)) return
        const collection = collectionIds?.length ? tracksFor(collectionIds) : [track]
        if (collectionIds?.length) c.playFavoriteTrack(track, collection)
        else c.playTrack(track)
      },
      enqueue: (ids) => c.queueTracks(tracksFor(ids)),
      toggleQueue: (id) => {
        const track = allTracks.value.get(id)
        if (track) c.toggleTrackQueue(track)
      },
      download: (ids) =>
        c.downloadFavoriteTracks(
          tracksFor(ids).filter((track) => !c.workspace.invalidTrackIds.value.has(track.id)),
        ),
      toggleFavorite: (id) => {
        const track = allTracks.value.get(id)
        if (track) c.toggleTrackFavorite(track)
      },
      rename: (id, name) => {
        const track = allTracks.value.get(id)
        if (track) c.renameTrack(track, name)
      },
      addToPlaylist: (id, ids) => c.addTracksToPlaylist(id, tracksFor(ids)),
      useAsMaterial: (ids) => {
        for (const track of tracksFor(ids)) c.openCatalogComposer(track)
      },
      addTag: (ids, tag) => {
        for (const track of tracksFor(ids)) c.addTag(track, tag)
      },
      removeTag: (id, tag) => {
        const track = allTracks.value.get(id)
        if (track) c.removeTag(track, tag)
      },
      clear: c.clearPlaybackHistory,
    },
  }))
  const features = computed<Pick<UiThemeFeatureMap, CollectionId | 'history'>>(() => ({
    catalog: catalog.value,
    queue: queue.value,
    favorites: favorites.value,
    playlists: playlists.value,
    'custom-tracks': customTracks.value,
    downloads: downloads.value,
    history: history.value,
  }))
  const displayDefaults = computed(() =>
    Object.fromEntries(
      COLLECTION_DISPLAY_GROUPS.map((group) => [
        group.id,
        Object.fromEntries(
          group.regions.map((region) => [region.id, display[group.id].getDefault(region.id)]),
        ),
      ]),
    ),
  )
  const setDisplayDefault: SetCollectionDisplayDefault = (collection, region, patch) => {
    if (
      COLLECTION_DISPLAY_GROUPS.find((group) => group.id === collection)?.regions.some(
        (entry) => entry.id === region,
      )
    )
      return display[collection].setDefault(region, patch)
  }
  return { features, actionTrack, displayDefaults, setDisplayDefault }
}
