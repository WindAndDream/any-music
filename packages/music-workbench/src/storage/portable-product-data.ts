import { copyJson, isRecord, jsonText, validateNamespaces } from './product-data'
import type { PluginDataNamespace, ProductCore, ProductData } from './product-data'
import { createProductData } from './product-data-projection'
import type { ProductGenerationStorage } from './product-generation-store'

export interface PortableProductData {
  format: 'any-music-data'
  schemaVersion: 1
  backupId: string
  core: ProductCore
  namespaces: PluginDataNamespace[]
}
export interface ProductImportPreview {
  backupId: string
  alreadyImported: boolean
  conflicts: readonly { kind: string; id: string }[]
  revision: string
}
export function exportPortableProductData(
  storage: ProductGenerationStorage,
  backupId: string = crypto.randomUUID(),
): PortableProductData {
  const data = storage.snapshot()
  return copyJson({
    format: 'any-music-data',
    schemaVersion: 1,
    backupId,
    core: data.core,
    namespaces: data.namespaces,
  })
}

function parseBackup(input: unknown): PortableProductData {
  jsonText(input)
  if (
    !isRecord(input) ||
    input.format !== 'any-music-data' ||
    input.schemaVersion !== 1 ||
    typeof input.backupId !== 'string' ||
    !input.backupId ||
    input.backupId.length > 200 ||
    !isRecord(input.core) ||
    !isRecord(input.core.library)
  )
    throw new Error('Unsupported portable data schema')
  const library = input.core.library
  if (
    library.schemaVersion !== 6 ||
    !Array.isArray(library.tracks) ||
    !Array.isArray(library.playlists) ||
    !Array.isArray(library.customTracks)
  )
    throw new Error('Unsupported portable core schema')
  if (
    !isRecord(library.profile) ||
    typeof library.profile.id !== 'string' ||
    !library.profile.id.trim() ||
    typeof library.profile.displayName !== 'string'
  )
    throw new Error('Invalid portable creator identity')
  // Strict field ownership. Unknown namespaces are opaque; core fields are not.
  const allowed = new Set([
    'schemaVersion',
    'profile',
    'settings',
    'tracks',
    'playlists',
    'history',
    'customTracks',
  ])
  if (
    Object.keys(library).some((key) => !allowed.has(key)) ||
    Object.keys(input.core).some(
      (key) => !['library', 'queue', 'downloads', 'favorites'].includes(key),
    )
  )
    throw new Error('Portable core contains non-data fields')
  validateNamespaces(input.namespaces)
  const sanitized = createProductData(
    {
      'local-library:v1': {
        ...library,
        tracks: library.tracks,
        customTracks: library.customTracks,
      },
      'playback-queue:v1': input.core.queue,
      'download-history:v1': input.core.downloads,
      ...(input.core.favorites === undefined
        ? {}
        : { 'favorite-collection:v1': input.core.favorites }),
    },
    0,
  )
  // Never silently lose IDs, references or recipes from an import. Normalizers whitelist
  // metadata and remove extra URL/path fields; invalid assets reject the whole import.
  for (const [field, idField] of [
    ['tracks', 'track'],
    ['playlists', 'id'],
    ['customTracks', 'trackId'],
  ] as const) {
    const before = library[field] as Record<string, unknown>[]
    const after = sanitized.core.library[field]
    const ids = before.map((entry) =>
      idField === 'track' && isRecord(entry.track) ? entry.track.id : entry[idField],
    )
    const nextIds = after.map((entry) =>
      idField === 'track' && 'track' in entry
        ? entry.track.id
        : (entry as unknown as Record<string, unknown>)[idField],
    )
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string') ||
      JSON.stringify(ids) !== JSON.stringify(nextIds)
    )
      throw new Error('Invalid or duplicate core IDs/recipes')
  }
  if (
    library.playlists.some(
      (entry, index) =>
        !isRecord(entry) ||
        jsonText(entry.trackIds) !== jsonText(sanitized.core.library.playlists[index]?.trackIds),
    ) ||
    library.customTracks.some(
      (entry, index) =>
        !isRecord(entry) ||
        jsonText(entry.recipe) !== jsonText(sanitized.core.library.customTracks[index]?.recipe),
    )
  )
    throw new Error('Invalid core references or recipe')
  if (
    Array.isArray(library.history) &&
    jsonText(library.history.map((entry) => (isRecord(entry) ? entry.id : null))) !==
      jsonText(sanitized.core.library.history.map((entry) => entry.id))
  )
    throw new Error('History import would lose stable references or exceed its limit')
  return copyJson({
    format: 'any-music-data',
    schemaVersion: 1,
    backupId: input.backupId,
    core: sanitized.core,
    namespaces: input.namespaces,
  })
}

function imports(data: ProductData): Record<string, unknown> {
  return isRecord(data.host.imports) ? data.host.imports : {}
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  return isRecord(value)
    ? Object.fromEntries(
        Object.keys(value)
          .toSorted()
          .map((key) => [key, canonical(value[key])]),
      )
    : value
}
function importIdentity(backup: PortableProductData): string {
  // Retain exact input identity, not a collision-prone checksum used as an authority.
  return jsonText(canonical(backup))
}
function keyed<T>(
  current: readonly T[],
  incoming: readonly T[],
  key: (value: T) => string,
  useBackup: boolean,
): T[] {
  const map = new Map(current.map((item) => [key(item), item]))
  for (const item of incoming) if (useBackup || !map.has(key(item))) map.set(key(item), item)
  return [...map.values()]
}

/** Preview holds a private validated candidate; callers cannot mutate it to add capabilities. */
export function previewPortableProductImport(
  storage: ProductGenerationStorage,
  input: unknown,
): {
  preview: ProductImportPreview
  apply(resolution: 'keep-current' | 'use-backup'): void
} {
  const backup = parseBackup(input)
  const current = storage.snapshot()
  validateNamespaces(keyed(current.namespaces, backup.namespaces, (item) => item.pluginId, true))
  validateNamespaces(keyed(current.namespaces, backup.namespaces, (item) => item.pluginId, false))
  const identity = importIdentity(backup)
  const previous = imports(current)[backup.backupId]
  if (previous !== undefined && previous !== identity)
    throw new Error('Backup ID was reused with different content')
  const conflicts: { kind: string; id: string }[] = []
  function collisions<T>(
    kind: string,
    left: readonly T[],
    right: readonly T[],
    key: (item: T) => string,
  ): void {
    const byId = new Map(left.map((item) => [key(item), item]))
    for (const item of right)
      if (byId.has(key(item)) && jsonText(byId.get(key(item))) !== jsonText(item))
        conflicts.push({ kind, id: key(item) })
  }
  collisions(
    'track',
    current.core.library.tracks,
    backup.core.library.tracks,
    (entry) => entry.track.id,
  )
  collisions(
    'playlist',
    current.core.library.playlists,
    backup.core.library.playlists,
    (entry) => entry.id,
  )
  collisions(
    'published-recipe',
    current.core.library.customTracks,
    backup.core.library.customTracks,
    (entry) => entry.trackId,
  )
  collisions('namespace', current.namespaces, backup.namespaces, (entry) => entry.pluginId)
  if (jsonText(current.core.library.profile) !== jsonText(backup.core.library.profile))
    conflicts.push({ kind: 'profile', id: backup.core.library.profile.id })
  for (const key of ['queue', 'downloads', 'favorites'] as const)
    if (
      backup.core[key] !== undefined &&
      current.core[key] !== undefined &&
      jsonText(current.core[key]) !== jsonText(backup.core[key])
    )
      conflicts.push({ kind: key, id: key })
  const revision = storage.revision()
  const alreadyImported = previous !== undefined
  const preview: ProductImportPreview = {
    backupId: backup.backupId,
    alreadyImported,
    conflicts,
    revision,
  }
  return {
    preview: copyJson(preview),
    apply(resolution) {
      if (!['keep-current', 'use-backup'].includes(resolution))
        throw new Error('Import conflict resolution is required')
      if (storage.revision() !== revision) throw new Error('Import preview is stale')
      if (alreadyImported) return
      const useBackup = resolution === 'use-backup'
      const next = copyJson(current)
      const left = current.core.library
      const right = backup.core.library
      next.core.library = {
        ...(useBackup ? right : left),
        tracks: keyed(left.tracks, right.tracks, (item) => item.track.id, useBackup),
        playlists: keyed(left.playlists, right.playlists, (item) => item.id, useBackup),
        customTracks: keyed(
          left.customTracks,
          right.customTracks,
          (item) => item.trackId,
          useBackup,
        ),
        history: keyed(left.history, right.history, (item) => item.id, useBackup),
      }
      for (const key of ['queue', 'downloads', 'favorites'] as const)
        if (backup.core[key] !== undefined && (useBackup || current.core[key] === undefined))
          next.core[key] = backup.core[key]
      next.namespaces = keyed(
        current.namespaces,
        backup.namespaces,
        (item) => item.pluginId,
        useBackup,
      )
      // Revalidate the merged graph: conflicting leaves must not make a recipe disappear.
      const checked = parseBackup({ ...backup, core: next.core, namespaces: next.namespaces })
      next.core = checked.core
      if (Object.keys(imports(current)).length >= 100)
        throw new Error('Import provenance budget exceeded')
      next.host.imports = { ...imports(current), [backup.backupId]: identity }
      storage.replace(next, revision)
    },
  }
}
