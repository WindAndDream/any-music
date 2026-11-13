import { AppError } from '@any-music/core'
import type { Track } from '@any-music/core'
import { createEditingSession } from '@any-music/ui'
import type { TagManagementPorts, TagManagementSession } from '@any-music/ui'

import { addCustomTag, normalizeCustomTag, removeCustomTag } from './tags'

interface Association {
  trackId: string
  tags: readonly string[]
  updatedAtMs?: number
}

/** One feature-owned state, committed synchronously through its namespace port. */
export function createTagManagementSession(ports: TagManagementPorts): TagManagementSession {
  const input = ports.read()
  if (input !== undefined && (!isRecord(input) || !Array.isArray(input.associations)))
    throw new AppError('invalid-input', '标签数据格式不可用，原数据已保留。')
  const original = isRecord(input) ? input : {}
  if (original.definitions !== undefined && !Array.isArray(original.definitions))
    throw new AppError('invalid-input', '标签定义数据格式不可用，原数据已保留。')
  if (original.playlistAssociations !== undefined && !Array.isArray(original.playlistAssociations))
    throw new AppError('invalid-input', '歌单标签数据格式不可用，原数据已保留。')
  if (original.recentTags !== undefined && !Array.isArray(original.recentTags))
    throw new AppError('invalid-input', '最近标签数据格式不可用，原数据已保留。')
  let recentTags = (Array.isArray(original.recentTags) ? original.recentTags : []).filter(
    (name): name is string => typeof name === 'string',
  )
  let definitions = new Map<string, { name: string; updatedAtMs: number }>()
  for (const item of Array.isArray(original.definitions) ? original.definitions : []) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.updatedAtMs !== 'number')
      continue
    definitions.set(tagKey(item.name), { name: item.name, updatedAtMs: item.updatedAtMs })
  }
  let associations = new Map<string, Association>()
  for (const item of Array.isArray(original.associations) ? original.associations : []) {
    if (!isRecord(item) || typeof item.trackId !== 'string' || !Array.isArray(item.tags)) continue
    // Keep old labels byte-for-byte on read. New edits alone apply current normalization.
    associations.set(item.trackId, {
      trackId: item.trackId,
      tags: item.tags.filter((tag): tag is string => typeof tag === 'string'),
      ...(typeof item.updatedAtMs === 'number' ? { updatedAtMs: item.updatedAtMs } : {}),
    })
  }
  let disposed = false
  // Playlist labels share normalization and lifecycle, but never become song associations.
  let playlistAssociations = new Map<string, readonly string[]>()
  for (const item of Array.isArray(original.playlistAssociations)
    ? original.playlistAssociations
    : []) {
    if (!isRecord(item) || typeof item.playlistId !== 'string' || !Array.isArray(item.tags))
      continue
    playlistAssociations.set(
      item.playlistId,
      item.tags.filter((tag): tag is string => typeof tag === 'string'),
    )
  }
  function assertCurrent(): void {
    if (disposed || !ports.isCurrent())
      throw new AppError('conflict', '标签功能已停用，请重新打开后操作。')
  }
  function collectTagDefinitions(
    songTags = associations,
    standaloneTags = definitions,
    playlistTags = playlistAssociations,
  ): Map<string, { name: string; updatedAtMs: number }> {
    const labels = new Map<string, { name: string; updatedAtMs: number }>()
    function include(name: string, updatedAtMs: number): void {
      const key = tagKey(name)
      const previous = labels.get(key)
      labels.set(key, {
        name: previous?.name ?? name,
        updatedAtMs: Math.max(previous?.updatedAtMs ?? 0, updatedAtMs),
      })
    }
    for (const item of standaloneTags.values()) include(item.name, item.updatedAtMs)
    // The directory must not depend on whether the host still retains an associated song.
    for (const item of songTags.values())
      for (const name of item.tags.toReversed()) include(name, item.updatedAtMs ?? 0)
    // Playlist associations carry no timestamp; reading them must not invent a maintenance time.
    for (const tags of playlistTags.values()) for (const name of tags.toReversed()) include(name, 0)
    return labels
  }
  function orderedTagNames(
    songTags = associations,
    standaloneTags = definitions,
    playlistTags = playlistAssociations,
    recent = recentTags,
  ): string[] {
    const labels = collectTagDefinitions(songTags, standaloneTags, playlistTags)
    const ordered = new Map<string, string>()
    for (const name of [...recent, ...[...labels.values()].map((item) => item.name)]) {
      const key = tagKey(name)
      const label = labels.get(key)
      if (label) ordered.set(key, label.name)
    }
    return [...ordered.values()]
  }
  function commit(
    next: Map<string, Association>,
    nextDefinitions = definitions,
    recent = recentTags,
    nextPlaylistAssociations?: Map<string, readonly string[]>,
  ): void {
    assertCurrent()
    const latest = ports.read()
    const nextRecent = orderedTagNames(
      next,
      nextDefinitions,
      nextPlaylistAssociations ?? playlistAssociations,
      recent,
    )
    ports.write({
      ...(isRecord(latest) ? latest : original),
      associations: [...next.values()],
      definitions: [...nextDefinitions.values()],
      ...(nextPlaylistAssociations
        ? {
            playlistAssociations: [...nextPlaylistAssociations].map(([playlistId, tags]) => ({
              playlistId,
              tags,
            })),
          }
        : {}),
      recentTags: nextRecent,
    })
    associations = next
    definitions = nextDefinitions
    if (nextPlaylistAssociations) playlistAssociations = nextPlaylistAssociations
    recentTags = nextRecent
    ports.changed()
  }
  function addTags(tracks: readonly Track[], tag: string): number {
    assertCurrent()
    addCustomTag([], tag)
    const next = new Map(associations)
    const changed: Track[] = []
    for (const track of new Map(tracks.map((item) => [item.id, item])).values()) {
      const previous = next.get(track.id)?.tags ?? []
      const tags = addCustomTag(previous, tag)
      if (tags === previous) continue
      next.set(track.id, { trackId: track.id, tags, updatedAtMs: Date.now() })
      changed.push(track)
    }
    if (changed.length) {
      ports.rememberTracks(changed)
      commit(next, definitions, [normalizeCustomTag(tag), ...recentTags])
    }
    return changed.length
  }
  function updatePlaylistTag(playlistId: string, tag: string, add: boolean): void {
    assertCurrent()
    const previous = playlistAssociations.get(playlistId) ?? []
    const tags = add ? addCustomTag(previous, tag) : removeCustomTag(previous, tag)
    if (tags === previous || (tags.length === previous.length && !add)) return
    const next = new Map(playlistAssociations)
    if (tags.length) next.set(playlistId, tags)
    else next.delete(playlistId)
    commit(
      associations,
      definitions,
      add ? [normalizeCustomTag(tag), ...recentTags] : recentTags,
      next,
    )
  }
  function transform(update: (tags: readonly string[]) => readonly string[]): number {
    assertCurrent()
    const next = new Map(associations)
    let count = 0
    for (const [id, item] of associations) {
      const tags = update(item.tags)
      if (tags.length === item.tags.length && tags.every((tag, index) => tag === item.tags[index]))
        continue
      next.set(id, { ...item, tags, updatedAtMs: Date.now() })
      count++
    }
    // Explicitly created labels survive with zero songs and take part in global maintenance.
    const nextDefinitions = new Map<string, { name: string; updatedAtMs: number }>()
    for (const item of definitions.values()) {
      for (const name of update([item.name])) {
        const key = tagKey(name)
        if (!nextDefinitions.has(key))
          nextDefinitions.set(key, {
            name,
            updatedAtMs: name === item.name ? item.updatedAtMs : Date.now(),
          })
      }
    }
    const definitionsChanged =
      nextDefinitions.size !== definitions.size ||
      [...nextDefinitions].some(([key, item]) => definitions.get(key)?.name !== item.name)
    const nextPlaylists = new Map(playlistAssociations)
    let playlistsChanged = false
    for (const [id, previous] of playlistAssociations) {
      const tags = update(previous)
      if (tags.length === previous.length && tags.every((tag, index) => tag === previous[index]))
        continue
      if (tags.length) nextPlaylists.set(id, tags)
      else nextPlaylists.delete(id)
      playlistsChanged = true
    }
    if (count || definitionsChanged || playlistsChanged)
      commit(
        next,
        nextDefinitions,
        recentTags.flatMap((name) => update([name])),
        playlistsChanged ? nextPlaylists : undefined,
      )
    return count
  }
  const editing = createEditingSession()
  return {
    editing,
    tagDefinitions: () => [...collectTagDefinitions().values()],
    tagNames: () => orderedTagNames(),
    createTag: (nameInput) => {
      assertCurrent()
      const name = normalizeCustomTag(nameInput)
      const key = tagKey(name)
      if (
        definitions.has(key) ||
        [...associations.values()].some(({ tags }) => tags.some((tag) => tagKey(tag) === key)) ||
        [...playlistAssociations.values()].some((tags) => tags.some((tag) => tagKey(tag) === key))
      )
        throw new AppError('conflict', '已存在重复标签。')
      const next = new Map(definitions)
      next.set(key, { name, updatedAtMs: Date.now() })
      commit(associations, next, [name, ...recentTags])
    },
    tagsByTrackId: () => new Map([...associations].map(([id, item]) => [id, item.tags])),
    tagsByPlaylistId: () => new Map(playlistAssociations),
    addPlaylistTag: (id, tag) => updatePlaylistTag(id, tag, true),
    removePlaylistTag: (id, tag) => updatePlaylistTag(id, tag, false),
    project: (records) =>
      records.map((record) => {
        const item = associations.get(record.track.id)
        return {
          ...record,
          customTags: item?.tags ?? [],
          updatedAtMs: item?.updatedAtMs ?? record.updatedAtMs,
        }
      }),
    addTags,
    addTag: (track, tag) => {
      addTags([track], tag)
    },
    removeTag: (track, tag) => {
      assertCurrent()
      const item = associations.get(track.id)
      if (!item) return
      const tags = removeCustomTag(item.tags, tag)
      if (tags.length === item.tags.length) return
      const next = new Map(associations)
      next.set(track.id, { ...item, tags, updatedAtMs: Date.now() })
      commit(next)
    },
    removeTagAssociations: (kind, ids, tag) => {
      assertCurrent()
      const next = new Map(associations)
      const nextPlaylists = new Map(playlistAssociations)
      let count = 0
      for (const id of new Set(ids)) {
        const previous =
          kind === 'tracks' ? associations.get(id)?.tags : playlistAssociations.get(id)
        if (!previous) continue
        const tags = removeCustomTag(previous, tag)
        if (tags.length === previous.length) continue
        if (kind === 'tracks')
          next.set(id, { ...associations.get(id)!, tags, updatedAtMs: Date.now() })
        else if (tags.length) nextPlaylists.set(id, tags)
        else nextPlaylists.delete(id)
        count++
      }
      if (count)
        commit(next, definitions, recentTags, kind === 'playlists' ? nextPlaylists : undefined)
      return count
    },
    renameTag: (current, next) => {
      assertCurrent()
      const normalized = addCustomTag([], next)[0]!
      return transform((tags) => {
        const remaining = removeCustomTag(tags, current)
        return remaining.length === tags.length ? tags : addCustomTag(remaining, normalized)
      })
    },
    deleteTag: (tag) => transform((tags) => removeCustomTag(tags, tag)),
    deleteTags: (selected) => {
      const keys = new Set(selected.map(tagKey))
      return transform((tags) => tags.filter((tag) => !keys.has(tagKey(tag))))
    },
    mergeTags: (selected, target) => {
      assertCurrent()
      const normalized = normalizeCustomTag(target)
      const keys = new Set(selected.map(tagKey))
      return transform((tags) => {
        if (!tags.some((tag) => keys.has(tagKey(tag)))) return tags
        return addCustomTag(
          tags.filter((tag) => !keys.has(tagKey(tag))),
          normalized,
        )
      })
    },
    dispose: () => {
      editing.dispose()
      disposed = true
    },
  }
}
function tagKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}
function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input)
}
