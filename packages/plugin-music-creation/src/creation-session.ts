import { AppError, assertRecipeUsesMaterialCollection } from '@any-music/core'
import type { MaterialCollection, Track } from '@any-music/core'
import { createEditingSession } from '@any-music/ui'
import type { MusicCreationPorts, MusicCreationSession, MusicCreationState } from '@any-music/ui'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function name(input: string): string {
  const value = input.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!value) throw new AppError('invalid-input', '素材合集名称不能为空。')
  if (value.length > 80) throw new AppError('invalid-input', '素材合集名称不能超过 80 个字符。')
  return value
}
function isCreationState(input: unknown): input is MusicCreationState {
  if (
    !isRecord(input) ||
    !Array.isArray(input.materialCollections) ||
    !Array.isArray(input.pendingMaterialTrackIds) ||
    !isRecord(input.materialCollectionByTrackId)
  )
    return false
  if (
    !input.materialCollections.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        Array.isArray(item.trackIds) &&
        item.trackIds.every((id) => typeof id === 'string') &&
        typeof item.createdAtMs === 'number' &&
        typeof item.updatedAtMs === 'number',
    )
  )
    return false
  if (
    !input.pendingMaterialTrackIds.every((id) => typeof id === 'string') ||
    !Object.values(input.materialCollectionByTrackId).every((id) => typeof id === 'string')
  )
    return false
  if (input.draft !== undefined) {
    const draft = input.draft
    if (
      !isRecord(draft) ||
      typeof draft.activeCollectionId !== 'string' ||
      typeof draft.title !== 'string' ||
      !['mp3', 'wav'].includes(draft.exportFormat as string) ||
      !Array.isArray(draft.recipe) ||
      !draft.recipe.every(
        (segment) =>
          isRecord(segment) &&
          typeof segment.sourceTrackId === 'string' &&
          Number.isSafeInteger(segment.startMs) &&
          Number.isSafeInteger(segment.endMs),
      )
    )
      return false
  }
  return true
}

/** Namespace is the only editing state. Failed commits leave the prior draft/materials intact. */
export function createMusicCreationSession(ports: MusicCreationPorts): MusicCreationSession {
  const input = ports.read()
  if (input !== undefined && !isCreationState(input))
    throw new AppError('invalid-input', '创作数据格式不可用，原数据已保留。')
  let state: MusicCreationState = structuredClone(
    input ?? {
      materialCollections: [],
      pendingMaterialTrackIds: [],
      materialCollectionByTrackId: {},
    },
  )
  let disposed = false
  function assertCurrent(): void {
    if (disposed || !ports.isCurrent())
      throw new AppError('conflict', '创作功能已停用，请重新打开后操作。')
  }
  function commit(next: MusicCreationState): void {
    assertCurrent()
    const latest = ports.read()
    ports.write({ ...(isRecord(latest) ? latest : {}), ...next })
    state = structuredClone(next)
    ports.changed()
  }
  function collection(id: string): MaterialCollection {
    const found = state.materialCollections.find((item) => item.id === id)
    if (!found) throw new AppError('collection-not-found', '找不到素材合集。')
    return found
  }
  function updateCollection(
    next: MaterialCollection,
    extras: Partial<MusicCreationState> = {},
  ): void {
    commit({
      ...state,
      ...extras,
      materialCollections: state.materialCollections.map((item) =>
        item.id === next.id ? next : item,
      ),
    })
  }
  function remember(tracks: readonly Track[]): void {
    assertCurrent()
    ports.rememberTracks(tracks)
    assertCurrent()
  }
  const editing = createEditingSession()
  return {
    editing,
    snapshot: () => structuredClone(state),
    assertCurrent,
    createMaterialCollection: (collectionName) => {
      assertCurrent()
      const now = Date.now()
      const created = {
        id: `material-collection:${crypto.randomUUID()}`,
        name: name(collectionName),
        trackIds: [],
        createdAtMs: now,
        updatedAtMs: now,
      }
      commit({ ...state, materialCollections: [...state.materialCollections, created] })
      return created
    },
    deleteMaterialCollection: (id, cleanup = false) => {
      assertCurrent()
      const current = collection(id)
      const owned = Object.entries(state.materialCollectionByTrackId)
        .filter(([, collectionId]) => collectionId === id)
        .map(([trackId]) => trackId)
      if (owned.length && !cleanup)
        throw new AppError(
          'conflict',
          '该合集包含已创建的自定义歌曲；如需删除，请勾选级联清理选项。',
        )
      const remaining = state.materialCollections.filter((item) => item.id !== id)
      const deleted = cleanup
        ? new Set(
            ports.deleteCreationMaterials({
              publishedTrackIds: owned,
              candidateTrackIds: current.trackIds,
              retainedTrackIds: [
                ...remaining.flatMap((item) => item.trackIds),
                ...state.pendingMaterialTrackIds,
                ...(state.draft?.recipe.map((segment) => segment.sourceTrackId) ?? []),
              ],
            }),
          )
        : new Set<string>()
      const mappings = Object.fromEntries(
        Object.entries(state.materialCollectionByTrackId).filter(
          ([trackId, collectionId]) => collectionId !== id && !deleted.has(trackId),
        ),
      )
      commit({
        ...state,
        materialCollections: remaining.map((item) =>
          Object.assign({}, item, {
            trackIds: item.trackIds.filter((trackId) => !deleted.has(trackId)),
          }),
        ),
        pendingMaterialTrackIds: state.pendingMaterialTrackIds.filter(
          (trackId) => !deleted.has(trackId),
        ),
        materialCollectionByTrackId: mappings,
        draft: state.draft?.activeCollectionId === id ? undefined : state.draft,
      })
    },
    stageMaterialTrack: (track) => {
      assertCurrent()
      if (state.pendingMaterialTrackIds.includes(track.id)) return false
      remember([track])
      commit({ ...state, pendingMaterialTrackIds: [...state.pendingMaterialTrackIds, track.id] })
      return true
    },
    removePendingMaterialTrack: (id) => {
      assertCurrent()
      commit({
        ...state,
        pendingMaterialTrackIds: state.pendingMaterialTrackIds.filter((trackId) => trackId !== id),
      })
    },
    addTracksToMaterialCollection: (id, tracks) => {
      assertCurrent()
      const current = collection(id)
      remember(tracks)
      const ids = new Set(current.trackIds)
      const originalCount = ids.size
      for (const track of tracks) ids.add(track.id)
      const added = new Set(tracks.map((track) => track.id))
      updateCollection(
        { ...current, trackIds: [...ids], updatedAtMs: Date.now() },
        {
          pendingMaterialTrackIds: state.pendingMaterialTrackIds.filter(
            (trackId) => !added.has(trackId),
          ),
        },
      )
      return ids.size - originalCount
    },
    removeTrackFromMaterialCollection: (id, trackId) => {
      assertCurrent()
      const current = collection(id)
      if (
        Object.entries(state.materialCollectionByTrackId).some(
          ([assetId, collectionId]) =>
            collectionId === id &&
            (assetId === trackId ||
              ports
                .readPublishedRecipe(assetId)
                ?.some((segment) => segment.sourceTrackId === trackId)),
        )
      )
        throw new AppError('conflict', '该素材仍用于此合集创建的自定义歌曲，不能移出合集。')
      updateCollection({
        ...current,
        trackIds: current.trackIds.filter((value) => value !== trackId),
        updatedAtMs: Date.now(),
      })
    },
    saveDraft: (draft) => {
      assertCurrent()
      assertRecipeUsesMaterialCollection(collection(draft.activeCollectionId), draft.recipe)
      commit({ ...state, draft: structuredClone(draft) })
    },
    publish: (title, id, recipe) => {
      assertCurrent()
      const current = collection(id)
      assertRecipeUsesMaterialCollection(current, recipe)
      const track = ports.publishCustomTrack(title, recipe)
      assertCurrent()
      updateCollection(
        {
          ...current,
          trackIds: [...new Set([...current.trackIds, track.id])],
          updatedAtMs: Date.now(),
        },
        {
          materialCollectionByTrackId: { ...state.materialCollectionByTrackId, [track.id]: id },
          draft: undefined,
        },
      )
      editing.reset()
      return track
    },
    clearData: () => {
      assertCurrent()
      commit({
        materialCollections: [],
        pendingMaterialTrackIds: [],
        materialCollectionByTrackId: {},
        draft: undefined,
      })
      editing.reset()
    },
    dispose: () => {
      editing.dispose()
      disposed = true
    },
  }
}
