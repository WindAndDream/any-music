import type { MaterialCollection, SegmentRecipe, Track } from '@any-music/core'
import type { Component } from 'vue'

import type { EditingSession } from '../composables/use-editing-session'
import type { AudioExportFormat } from './audio-export-format'

/** Stable editing data belongs to the feature namespace, separate from published assets. */
export interface MusicCreationDraft {
  activeCollectionId: string
  title: string
  recipe: readonly SegmentRecipe[]
  exportFormat: AudioExportFormat
}
export interface MusicCreationState {
  materialCollections: readonly MaterialCollection[]
  pendingMaterialTrackIds: readonly string[]
  materialCollectionByTrackId: Readonly<Record<string, string>>
  draft?: MusicCreationDraft
}
/** Trusted named actions; neither a player nor a library/playlist repository is exposed. */
export interface MusicCreationHostPorts {
  rememberTracks(tracks: readonly Track[]): void
  readPublishedRecipe(trackId: string): readonly SegmentRecipe[] | undefined
  publishCustomTrack(title: string, recipe: readonly SegmentRecipe[]): Track
  deleteCreationMaterials(input: {
    publishedTrackIds: readonly string[]
    candidateTrackIds: readonly string[]
    retainedTrackIds: readonly string[]
  }): readonly string[]
}
export interface MusicCreationPorts extends MusicCreationHostPorts {
  read(): unknown
  write(value: unknown): void
  changed(): void
  isCurrent(): boolean
}
export interface MusicCreationSession {
  readonly editing: EditingSession
  snapshot(): MusicCreationState
  assertCurrent(): void
  createMaterialCollection(name: string): MaterialCollection
  deleteMaterialCollection(id: string, deleteMaterialRecords?: boolean): void
  stageMaterialTrack(track: Track): boolean
  removePendingMaterialTrack(id: string): void
  addTracksToMaterialCollection(id: string, tracks: readonly Track[]): number
  removeTrackFromMaterialCollection(id: string, trackId: string): void
  saveDraft(draft: MusicCreationDraft): void
  publish(title: string, collectionId: string, recipe: readonly SegmentRecipe[]): Track
  /** Clearing editing data preserves all host-published works. Disabling never calls this. */
  clearData(): void
  dispose(): void
}
export interface MusicCreationImplementation {
  /** Renderless scoped-slot adapter exposing MusicCreationPresentation; no fixed whole-page layout. */
  Composer: Component
  createSession(ports: MusicCreationPorts): MusicCreationSession
}
