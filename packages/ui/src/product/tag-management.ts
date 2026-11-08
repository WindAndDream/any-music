import type { LibraryTrackRecord, Track } from '@any-music/core'
import type { Component } from 'vue'

import type { EditingSession } from '../composables/use-editing-session'

/** Trusted built-in feature ports. No workbench repository or runtime is exposed. */
export interface TagManagementPorts {
  read(): unknown
  write(value: unknown): void
  rememberTracks(tracks: readonly Track[]): void
  changed(): void
  isCurrent(): boolean
}
export interface TagManagementSession {
  readonly editing: EditingSession
  /** Complete namespace directory, including playlist-only labels and unretained song associations. */
  tagDefinitions(): readonly { name: string; updatedAtMs: number }[]
  /** Current user labels in most recently added order, including unused standalone definitions. */
  tagNames(): readonly string[]
  createTag(name: string): void
  tagsByTrackId(): ReadonlyMap<string, readonly string[]>
  tagsByPlaylistId(): ReadonlyMap<string, readonly string[]>
  addPlaylistTag(playlistId: string, tag: string): void
  removePlaylistTag(playlistId: string, tag: string): void
  project(records: readonly LibraryTrackRecord[]): readonly LibraryTrackRecord[]
  addTag(track: Track, tag: string): void
  addTags(tracks: readonly Track[], tag: string): number
  removeTag(track: Track, tag: string): void
  /** Remove one label from selected entities in a single namespace commit. */
  removeTagAssociations(kind: 'tracks' | 'playlists', ids: readonly string[], tag: string): number
  renameTag(current: string, next: string): number
  deleteTag(tag: string): number
  deleteTags(tags: readonly string[]): number
  mergeTags(tags: readonly string[], target: string): number
  dispose(): void
}
export interface TagManagementImplementation {
  /** Renderless scoped-slot adapter exposing TagManagementPresentation; the theme owns page layout. */
  Panel: Component
  createSession(ports: TagManagementPorts): TagManagementSession
}
