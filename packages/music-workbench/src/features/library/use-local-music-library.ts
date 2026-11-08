import {
  AppError,
  createAppErrorState,
  compileSegmentRecipe,
  formatAppErrorMessage,
  getCompiledDurationMs,
  LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
  MAX_PLAYBACK_HISTORY_LIMIT,
  MIN_PLAYBACK_HISTORY_LIMIT,
  normalizeTrackCustomName,
  playlistNameKey,
  validatePlaylistName,
  toAppErrorState,
} from '@any-music/core'
import type {
  AppErrorState,
  CustomTrackSourceCredit,
  CustomTrackDefinition,
  LibraryUserProfile,
  LibraryTrackRecord,
  LocalMusicLibrarySnapshot,
  MusicPlaylist,
  PlaybackHistoryEntry,
  SegmentRecipe,
  Track,
} from '@any-music/core'
import { computed, onScopeDispose, readonly, shallowRef } from 'vue'

import { localMusicLibraryRepository } from '../../storage/local-music-library-repository'

const PERSIST_THROTTLE_MS = 1_000

/** 本地音乐状态是喜欢、歌单、历史、自定义歌曲与插件的唯一可变状态源。 */
export function useLocalMusicLibrary() {
  const initial = localMusicLibraryRepository.load()
  const profile = shallowRef<LibraryUserProfile>(initial.profile)
  const historyLimit = shallowRef(initial.settings.historyLimit)
  const records = shallowRef<readonly LibraryTrackRecord[]>(
    initial.tracks.map((record) => ({ ...record, customTags: [] })),
  )
  const playlists = shallowRef<readonly MusicPlaylist[]>(initial.playlists)
  const history = shallowRef<readonly PlaybackHistoryEntry[]>(initial.history)
  const customTracks = shallowRef<readonly CustomTrackDefinition[]>(initial.customTracks)
  const persistenceErrorState = shallowRef<AppErrorState>()
  const persistenceError = computed(() =>
    persistenceErrorState.value ? formatAppErrorMessage(persistenceErrorState.value) : '',
  )

  const trackById = new Map(records.value.map((record) => [record.track.id, record]))
  const customTrackById = new Map(
    customTracks.value.map((definition) => [definition.trackId, definition]),
  )
  let persistTimer: number | undefined

  const favoriteRecords = computed(() =>
    records.value.filter((record) => record.favoritedAtMs !== undefined),
  )
  const favoriteTrackIds = computed<ReadonlySet<string>>(
    () => new Set(favoriteRecords.value.map((record) => record.track.id)),
  )
  const customNamesByTrackId = computed<ReadonlyMap<string, string>>(
    () =>
      new Map(
        records.value.flatMap((record) =>
          record.customName ? [[record.track.id, record.customName] as const] : [],
        ),
      ),
  )

  /**
   * 用户明确播放或加入待听时立即保存规范曲目，使随后写入的队列 ID 在刷新后一定可恢复。
   */
  function rememberTracks(tracks: readonly Track[]): void {
    if (tracks.length === 0) return
    const now = Date.now()
    let changed = false
    for (const track of tracks) {
      const existing = trackById.get(track.id)
      const next: LibraryTrackRecord = existing
        ? { ...existing, track, updatedAtMs: now }
        : { track, customTags: [], addedAtMs: now, updatedAtMs: now }
      trackById.set(track.id, next)
      changed = true
    }
    if (!changed) return
    records.value = [...trackById.values()]
    persistNow()
  }

  /** Playback confirms the selected media duration; preserve library membership and user metadata. */
  function updateTrackDuration(trackId: string, durationMs: number | undefined): void {
    const record = trackById.get(trackId)
    if (
      !record ||
      record.track.source.mediaKind === 'custom' ||
      durationMs === undefined ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      record.track.durationMs === durationMs
    ) {
      return
    }
    trackById.set(trackId, {
      ...record,
      track: { ...record.track, durationMs },
      updatedAtMs: Date.now(),
    })
    records.value = [...trackById.values()]
    schedulePersist()
  }

  /** 主动喜欢会立即落盘；即使用户随后立刻刷新，也不会丢失刚刚的选择。 */
  function favoriteTracks(tracks: readonly Track[]): number {
    if (tracks.length === 0) return 0
    const now = Date.now()
    let addedCount = 0
    for (const track of tracks) {
      const existing = trackById.get(track.id)
      if (existing?.favoritedAtMs === undefined) addedCount += 1
      trackById.set(track.id, {
        ...existing,
        track,
        customTags: existing?.customTags ?? [],
        favoritedAtMs: existing?.favoritedAtMs ?? now,
        addedAtMs: existing?.addedAtMs ?? now,
        updatedAtMs: now,
      })
    }
    records.value = [...trackById.values()]
    persistNow()
    return addedCount
  }

  function favoriteTrack(track: Track): boolean {
    return favoriteTracks([track]) === 1
  }

  /** 批量取消喜欢只移除成员关系，并通过一次快照写入保证整批操作原子落盘。 */
  function unfavoriteTracks(trackIds: readonly string[]): number {
    const now = Date.now()
    let removedCount = 0
    for (const trackId of new Set(trackIds)) {
      const record = trackById.get(trackId)
      if (!record || record.favoritedAtMs === undefined) continue
      const next = { ...record }
      delete next.favoritedAtMs
      trackById.set(trackId, { ...next, updatedAtMs: now })
      removedCount += 1
    }
    if (removedCount === 0) return 0
    records.value = [...trackById.values()]
    persistNow()
    return removedCount
  }

  function unfavoriteTrack(trackId: string): void {
    unfavoriteTracks([trackId])
  }

  function createPlaylist(name: string, description = '', coverId?: string): MusicPlaylist {
    const normalizedName = validatePlaylistName(name, playlists.value)
    const now = Date.now()
    const playlist: MusicPlaylist = {
      id: `playlist:${crypto.randomUUID()}`,
      name: normalizedName,
      description: normalizePlaylistDescription(description),
      coverId,
      trackIds: [],
      createdAtMs: now,
      updatedAtMs: now,
    }
    playlists.value = [...playlists.value, playlist]
    schedulePersist()
    return playlist
  }

  function deletePlaylist(playlistIds: string | readonly string[]): void {
    const removedIds = new Set(typeof playlistIds === 'string' ? [playlistIds] : playlistIds)
    if (!playlists.value.some(({ id }) => removedIds.has(id))) return
    playlists.value = playlists.value.filter(({ id }) => !removedIds.has(id))
    schedulePersist()
  }

  /** 从任意音乐列表批量加入歌单时，同时保存规范 Track，刷新后歌单仍可完整恢复。 */
  function addTracksToPlaylist(playlistId: string, tracks: readonly Track[]): number {
    if (tracks.length === 0) return 0
    if (!playlists.value.some((playlist) => playlist.id === playlistId)) {
      throw new AppError('not-found', '找不到歌单。')
    }
    const now = Date.now()
    for (const track of tracks) {
      const existing = trackById.get(track.id)
      trackById.set(track.id, {
        ...existing,
        track,
        customTags: existing?.customTags ?? [],
        addedAtMs: existing?.addedAtMs ?? now,
        updatedAtMs: now,
      })
    }
    records.value = [...trackById.values()]

    let addedCount = 0
    updatePlaylist(playlistId, (playlist) => {
      const trackIds = [...playlist.trackIds]
      const existingIds = new Set(trackIds)
      for (const track of tracks) {
        if (existingIds.has(track.id)) continue
        existingIds.add(track.id)
        trackIds.push(track.id)
        addedCount += 1
      }
      return { ...playlist, trackIds, updatedAtMs: now }
    })
    persistNow()
    return addedCount
  }

  function removeFromPlaylist(playlistId: string, trackId: string): void {
    updatePlaylist(playlistId, (playlist) => ({
      ...playlist,
      trackIds: playlist.trackIds.filter((id) => id !== trackId),
      updatedAtMs: Date.now(),
    }))
  }

  function publishCustomTrack(title: string, recipe: readonly SegmentRecipe[]): Track {
    const normalizedTitle = normalizeName(title, '自定义歌曲名称')
    const resourceId = crypto.randomUUID()
    const trackId = `local:custom:${resourceId}`
    const compiledSegments = compileSegmentRecipe(recipe, {
      customTrackId: trackId,
      resolveTrack: (id) => trackById.get(id)?.track,
      resolveCustomTrack: (id) => customTrackById.get(id),
    })
    const now = Date.now()
    const firstSource = trackById.get(compiledSegments[0]?.sourceTrackId ?? '')?.track
    const creator = { ...profile.value }
    const sourceCredits = collectSourceCredits(compiledSegments)
    const track: Track = {
      id: trackId,
      title: normalizedTitle,
      artists: [{ id: creator.id, name: creator.displayName }],
      artworkUrl: firstSource?.artworkUrl,
      durationMs: getCompiledDurationMs(compiledSegments),
      // 对拼接歌曲而言该字段表达作品创建时间，导入后仍可按原始拼接时间筛选。
      publishedAtMs: now,
      description: `由 ${recipe.length} 个片段实时拼接`,
      source: { pluginId: 'local-custom', mediaKind: 'custom', resourceId },
    }
    const definition: CustomTrackDefinition = {
      trackId,
      version: 1,
      materialCollectionId: '',
      recipe: recipe.map((segment) => ({ ...segment })),
      compiledSegments,
      creator,
      sourceCredits,
      createdAtMs: now,
    }
    customTrackById.set(trackId, definition)
    customTracks.value = [...customTrackById.values()]
    const record: LibraryTrackRecord = {
      track,
      customTags: [],
      // 用户创建的拼接歌曲属于自己的音乐成果，保存成功后直接进入“我的喜欢”。
      favoritedAtMs: now,
      addedAtMs: now,
      updatedAtMs: now,
    }
    trackById.set(trackId, record)
    records.value = [...trackById.values()]
    persistNow()
    if (persistenceErrorState.value)
      throw new AppError('storage-write-failed', '作品保存失败，草稿已保留。')
    return track
  }

  /** Explicit cleanup remains a host operation; the plugin never receives repository access. */
  function deleteCreationMaterials(input: {
    publishedTrackIds: readonly string[]
    candidateTrackIds: readonly string[]
    retainedTrackIds: readonly string[]
  }): readonly string[] {
    const owned = new Set(input.publishedTrackIds.filter((id) => customTrackById.has(id)))
    const retained = customTracks.value.filter((asset) => !owned.has(asset.trackId))
    if (
      retained.some((asset) =>
        [...asset.recipe, ...asset.compiledSegments].some((segment) =>
          owned.has(segment.sourceTrackId),
        ),
      )
    )
      throw new AppError('conflict', '该合集创建的歌曲仍被其他自定义歌曲使用，请先处理下游作品。')
    const protectedIds = new Set(input.retainedTrackIds)
    for (const playlist of playlists.value) for (const id of playlist.trackIds) protectedIds.add(id)
    for (const record of records.value)
      if (record.favoritedAtMs !== undefined || record.customName) protectedIds.add(record.track.id)
    for (const asset of retained) {
      protectedIds.add(asset.trackId)
      for (const segment of [...asset.recipe, ...asset.compiledSegments])
        protectedIds.add(segment.sourceTrackId)
    }
    const deleted = new Set(
      [...input.candidateTrackIds, ...owned].filter((id) => owned.has(id) || !protectedIds.has(id)),
    )
    for (const id of deleted) {
      trackById.delete(id)
      customTrackById.delete(id)
    }
    records.value = [...trackById.values()]
    customTracks.value = [...customTrackById.values()]
    playlists.value = playlists.value.map((playlist) => ({
      ...playlist,
      trackIds: playlist.trackIds.filter((id) => !deleted.has(id)),
    }))
    history.value = history.value.filter((entry) => !deleted.has(entry.trackId))
    persistNow()
    if (persistenceErrorState.value)
      throw new AppError('storage-write-failed', '素材清理保存失败。')
    return [...deleted]
  }

  function removeTrack(trackId: string): boolean {
    const referenced = customTracks.value.some(
      (definition) =>
        definition.trackId !== trackId &&
        [...definition.recipe, ...definition.compiledSegments].some(
          (segment) => segment.sourceTrackId === trackId,
        ),
    )
    if (referenced) {
      persistenceErrorState.value = createAppErrorState(
        'conflict',
        '该曲目仍被自定义歌曲引用，不能删除。',
      )
      return false
    }

    trackById.delete(trackId)
    records.value = [...trackById.values()]
    customTrackById.delete(trackId)
    customTracks.value = [...customTrackById.values()]
    playlists.value = playlists.value.map((playlist) => ({
      ...playlist,
      trackIds: playlist.trackIds.filter((id) => id !== trackId),
    }))
    history.value = history.value.filter((entry) => entry.trackId !== trackId)
    persistenceErrorState.value = undefined
    schedulePersist()
    return true
  }

  function beginHistory(track: Track): string {
    const now = Date.now()
    const definition = customTrackById.get(track.id)
    const entry: PlaybackHistoryEntry = {
      id: `history:${crypto.randomUUID()}`,
      trackId: track.id,
      startedAtMs: now,
      updatedAtMs: now,
      positionMs: 0,
      durationMs: track.durationMs,
      completed: false,
      customTrackVersion: definition?.version,
    }
    history.value = [entry, ...history.value].slice(0, historyLimit.value)
    schedulePersist()
    return entry.id
  }

  function updateHistory(
    historyId: string,
    positionMs: number,
    durationMs: number | undefined,
    completed = false,
  ): void {
    const now = Date.now()
    history.value = history.value.map((entry) =>
      entry.id === historyId
        ? {
            ...entry,
            positionMs: Math.max(0, Math.round(positionMs)),
            durationMs: durationMs === undefined ? entry.durationMs : Math.max(0, durationMs),
            updatedAtMs: now,
            completed: entry.completed || completed,
            completedAtMs: completed ? now : entry.completedAtMs,
          }
        : entry,
    )
    schedulePersist()
  }

  function clearHistory(): void {
    history.value = []
    schedulePersist()
  }

  /** 调小上限时同步裁剪最旧记录，保证内存状态与下一次持久化快照立即一致。 */
  function setHistoryLimit(limit: number): void {
    if (
      !Number.isSafeInteger(limit) ||
      limit < MIN_PLAYBACK_HISTORY_LIMIT ||
      limit > MAX_PLAYBACK_HISTORY_LIMIT
    ) {
      throw new AppError(
        'invalid-input',
        `历史记录数量必须是 ${MIN_PLAYBACK_HISTORY_LIMIT} 到 ${MAX_PLAYBACK_HISTORY_LIMIT} 之间的整数。`,
      )
    }
    if (limit === historyLimit.value) {
      persistNow()
      return
    }
    historyLimit.value = limit
    history.value = history.value.slice(0, limit)
    persistNow()
  }

  /** 显示名可修改，但稳定用户 ID 永不重写，避免既有导出或作者引用失效。 */
  function updateLocalUserDisplayName(displayName: string): void {
    const normalizedDisplayName = normalizeName(displayName, '用户名称')
    if (normalizedDisplayName === profile.value.displayName) {
      persistNow()
      return
    }
    profile.value = { ...profile.value, displayName: normalizedDisplayName }

    const ownedTrackIds = new Set<string>()
    customTracks.value = customTracks.value.map((definition) => {
      if (definition.creator.id !== profile.value.id) return definition
      ownedTrackIds.add(definition.trackId)
      const next = { ...definition, creator: { ...profile.value } }
      customTrackById.set(next.trackId, next)
      return next
    })
    const now = Date.now()
    for (const trackId of ownedTrackIds) {
      const record = trackById.get(trackId)
      if (!record) continue
      trackById.set(trackId, {
        ...record,
        track: {
          ...record.track,
          artists: [{ id: profile.value.id, name: normalizedDisplayName }],
        },
        updatedAtMs: now,
      })
    }
    records.value = [...trackById.values()]
    persistNow()
  }

  function getTrack(trackId: string): Track | undefined {
    return trackById.get(trackId)?.track
  }

  /** 以稳定歌曲 ID 更新唯一记录；编辑未收藏的搜索结果也立即落盘。 */
  function renameTrack(track: Track, input: string): number {
    const customName = normalizeTrackCustomName(input)
    const current = trackById.get(track.id)
    if (current?.customName === customName) return 0
    const now = Date.now()
    trackById.set(track.id, {
      ...current,
      track: current?.track ?? track,
      customName,
      customTags: current?.customTags ?? [],
      addedAtMs: current?.addedAtMs ?? now,
      updatedAtMs: now,
    })
    records.value = [...trackById.values()]
    persistNow()
    return 1
  }

  function getCustomTrack(trackId: string): CustomTrackDefinition | undefined {
    return customTrackById.get(trackId)
  }

  /** O(k) 查找选项，仅变化时 O(n) 发布记录快照并保存一次；重复 ID 和原名项均跳过。 */
  function restoreTrackNames(trackIds: readonly string[]): number {
    let restoredCount = 0
    const now = Date.now()
    for (const trackId of trackIds) {
      const record = trackById.get(trackId)
      if (!record?.customName) continue
      const { customName: _customName, ...original } = record
      trackById.set(trackId, { ...original, updatedAtMs: now })
      restoredCount += 1
    }
    if (restoredCount > 0) {
      records.value = [...trackById.values()]
      persistNow()
    }
    return restoredCount
  }

  function updatePlaylist(
    playlistId: string,
    updater: (playlist: MusicPlaylist) => MusicPlaylist,
  ): void {
    let found = false
    playlists.value = playlists.value.map((playlist) => {
      if (playlist.id !== playlistId) return playlist
      found = true
      return updater(playlist)
    })
    if (!found) throw new AppError('not-found', '找不到歌单。')
    schedulePersist()
  }

  function schedulePersist(): void {
    if (persistTimer !== undefined) return
    persistTimer = window.setTimeout(persistNow, PERSIST_THROTTLE_MS)
  }

  function persistNow(): void {
    if (persistTimer !== undefined) window.clearTimeout(persistTimer)
    persistTimer = undefined
    const snapshot: LocalMusicLibrarySnapshot = {
      schemaVersion: LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
      profile: profile.value,
      settings: { historyLimit: historyLimit.value },
      tracks: records.value,
      playlists: playlists.value,
      history: history.value,
      customTracks: customTracks.value,
    }
    try {
      localMusicLibraryRepository.save(snapshot)
      persistenceErrorState.value = undefined
    } catch (error) {
      persistenceErrorState.value = toAppErrorState(
        error,
        'storage-write-failed',
        '本地音乐数据保存失败。',
      )
    }
  }

  onScopeDispose(persistNow)

  return {
    /** Stage one additive import and persist it before publishing reactive state. */
    importPlaylist(candidate: LocalMusicLibrarySnapshot): void {
      const source = candidate.playlists[0]
      if (!source) throw new AppError('invalid-input', '歌单内容为空。')
      const names = new Set(playlists.value.map(({ name }) => playlistNameKey(name)))
      const baseName = validatePlaylistName(source.name, [])
      let name = baseName
      for (let index = 2; names.has(playlistNameKey(name)); index++) {
        const suffix = ` (${index})`
        name = `${baseName.slice(0, 80 - suffix.length)}${suffix}`
      }
      name = validatePlaylistName(name, playlists.value)
      const nextTracks = new Map(trackById)
      const nextCustom = new Map(customTrackById)
      for (const definition of candidate.customTracks) {
        const existing = nextCustom.get(definition.trackId)
        if (
          existing &&
          (existing.version !== definition.version ||
            existing.recipe.length !== definition.recipe.length ||
            existing.recipe.some((segment, index) => {
              const incoming = definition.recipe[index]!
              return (
                segment.sourceTrackId !== incoming.sourceTrackId ||
                segment.startMs !== incoming.startMs ||
                segment.endMs !== incoming.endMs
              )
            }) ||
            existing.creator.id !== definition.creator.id)
        )
          throw new AppError('conflict', '文件中的自定义歌曲与本机版本冲突，请先确认作品版本。')
        if (!existing) nextCustom.set(definition.trackId, definition)
      }
      const now = Date.now()
      for (const entry of candidate.tracks) {
        const existing = nextTracks.get(entry.track.id)
        if (
          existing &&
          (['pluginId', 'mediaKind', 'resourceId', 'partId'] as const).some(
            (key) => existing.track.source[key] !== entry.track.source[key],
          )
        )
          throw new AppError('conflict', '文件中的歌曲标识与本机来源冲突。')
        if (!existing)
          nextTracks.set(entry.track.id, {
            ...entry,
            customTags: [],
            favoritedAtMs: undefined,
            addedAtMs: now,
            updatedAtMs: now,
          })
      }
      for (const definition of candidate.customTracks) {
        if (customTrackById.has(definition.trackId)) continue
        const compiledSegments = compileSegmentRecipe(definition.recipe, {
          customTrackId: definition.trackId,
          resolveTrack: (id) => nextTracks.get(id)?.track,
          resolveCustomTrack: (id) => nextCustom.get(id),
        })
        nextCustom.set(definition.trackId, { ...definition, compiledSegments })
      }
      const nextPlaylists = [
        ...playlists.value,
        {
          ...source,
          id: `playlist:${crypto.randomUUID()}`,
          name,
          coverId: undefined,
        },
      ]
      const nextRecords = [...nextTracks.values()]
      const nextDefinitions = [...nextCustom.values()]
      try {
        localMusicLibraryRepository.save({
          schemaVersion: LOCAL_MUSIC_LIBRARY_SCHEMA_VERSION,
          profile: profile.value,
          settings: { historyLimit: historyLimit.value },
          tracks: nextRecords,
          customTracks: nextDefinitions,
          playlists: nextPlaylists,
          history: history.value,
        })
      } catch (cause) {
        throw new AppError('storage-write-failed', '歌单导入保存失败，请重试。', { cause })
      }
      for (const [id, entry] of nextTracks) trackById.set(id, entry)
      for (const [id, entry] of nextCustom) customTrackById.set(id, entry)
      records.value = nextRecords
      customTracks.value = nextDefinitions
      playlists.value = nextPlaylists
      persistenceErrorState.value = undefined
    },
    updatePlaylistDetails(
      playlistId: string,
      name: string,
      description: string,
      coverId?: string,
    ): void {
      const normalized = validatePlaylistName(name, playlists.value, playlistId)
      const normalizedDescription = normalizePlaylistDescription(description)
      updatePlaylist(playlistId, (playlist) => ({
        ...playlist,
        name: normalized,
        description: normalizedDescription,
        coverId,
        updatedAtMs: Date.now(),
      }))
      persistNow()
    },
    updatePlaylistDescription(playlistId: string, description: string): void {
      const normalized = normalizePlaylistDescription(description)
      updatePlaylist(playlistId, (playlist) => ({
        ...playlist,
        description: normalized,
        updatedAtMs: Date.now(),
      }))
    },
    reorderPlaylists(ids: readonly string[]): void {
      const byId = new Map(playlists.value.map((playlist) => [playlist.id, playlist]))
      const requested = [...new Set(ids)].flatMap((id) => byId.get(id) ?? [])
      const requestedIds = new Set(requested.map((playlist) => playlist.id))
      playlists.value = [
        ...requested,
        ...playlists.value.filter((playlist) => !requestedIds.has(playlist.id)),
      ]
      schedulePersist()
    },
    renamePlaylist(playlistId: string, name: string): void {
      const normalized = validatePlaylistName(name, playlists.value, playlistId)
      updatePlaylist(playlistId, (playlist) => ({
        ...playlist,
        name: normalized,
        updatedAtMs: Date.now(),
      }))
    },
    reorderPlaylistTracks(playlistId: string, ids: readonly string[]): void {
      updatePlaylist(playlistId, (playlist) => {
        const known = new Set(playlist.trackIds)
        const requested = [...new Set(ids)].filter((id) => known.has(id))
        const requestedIds = new Set(requested)
        return {
          ...playlist,
          trackIds: [...requested, ...playlist.trackIds.filter((id) => !requestedIds.has(id))],
          updatedAtMs: Date.now(),
        }
      })
    },
    profile: readonly(profile),
    historyLimit: readonly(historyLimit),
    records: readonly(records),
    playlists: readonly(playlists),
    history: readonly(history),
    customTracks: readonly(customTracks),
    favoriteRecords,
    favoriteTrackIds,
    customNamesByTrackId,
    persistenceError: readonly(persistenceError),
    persistenceErrorState: readonly(persistenceErrorState),
    rememberTracks,
    updateTrackDuration,
    renameTrack,
    restoreTrackNames,
    favoriteTrack,
    favoriteTracks,
    unfavoriteTrack,
    unfavoriteTracks,
    createPlaylist,
    deletePlaylist,
    addTracksToPlaylist,
    removeFromPlaylist,
    publishCustomTrack,
    deleteCreationMaterials,
    removeTrack,
    beginHistory,
    updateHistory,
    clearHistory,
    setHistoryLimit,
    updateLocalUserDisplayName,
    getTrack,
    getCustomTrack,
    persistNow,
  }

  function collectSourceCredits(
    segments: readonly SegmentRecipe[],
  ): readonly CustomTrackSourceCredit[] {
    const credits = new Map<string, CustomTrackSourceCredit>()
    for (const segment of segments) {
      const track = trackById.get(segment.sourceTrackId)?.track
      if (!track || track.source.mediaKind === 'custom') continue
      for (const artist of track.artists) {
        const identity = artist.id ?? artist.name.normalize('NFKC').trim().toLocaleLowerCase()
        credits.set(`${track.source.pluginId}\u0000${identity}`, {
          pluginId: track.source.pluginId,
          artistId: artist.id,
          artistName: artist.name,
        })
      }
    }
    return [...credits.values()]
  }
}

function normalizeName(input: string, label: string): string {
  const name = input.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!name) throw new AppError('invalid-input', `${label}不能为空。`)
  if (name.length > 80) throw new AppError('invalid-input', `${label}不能超过 80 个字符。`)
  return name
}

function normalizePlaylistDescription(input: string): string | undefined {
  const value = input.normalize('NFKC').trim()
  if (value.length > 500) throw new AppError('invalid-input', '歌单简介不能超过 500 字。')
  return value || undefined
}
