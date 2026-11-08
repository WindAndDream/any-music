import { sanitizeAppErrorState, sanitizeTrackMetadataUrl } from '@any-music/core'
import type { AppErrorState, Track, TrackListingContinuation } from '@any-music/core'

import { sanitizeStoredTrack } from '../../storage/local-music-library-repository'

/** Cached metadata is independent of account leases and short-lived playback descriptors. */
export interface CatalogResultSnapshot {
  tracks: readonly Track[]
  account?: { id?: string; name?: string; customName?: string }
  loadedPageCount: number
  total?: number
  sourceUrl?: string
  hasMore: boolean
  continuation?: TrackListingContinuation
  error?: AppErrorState
}

const MAX_CACHED_TRACKS = 10_000

export function sanitizeCatalogResultSnapshot(
  input: unknown,
  pluginId: string,
): CatalogResultSnapshot | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (
    !Array.isArray(value.tracks) ||
    !isPosition(value.loadedPageCount) ||
    typeof value.hasMore !== 'boolean'
  )
    return undefined
  const tracks: Track[] = []
  const ids = new Set<string>()
  let complete = value.tracks.length <= MAX_CACHED_TRACKS
  for (const candidate of value.tracks.slice(0, MAX_CACHED_TRACKS)) {
    const track = sanitizeStoredTrack(candidate)
    if (!track || track.source.pluginId !== pluginId) {
      complete = false
      continue
    }
    if (!ids.has(track.id)) {
      tracks.push(track)
      ids.add(track.id)
    }
  }
  const continuation = sanitizeContinuation(value.continuation, value.loadedPageCount)
  return {
    tracks,
    account: sanitizeAccount(value.account),
    loadedPageCount: value.loadedPageCount,
    total: isPosition(value.total) ? value.total : undefined,
    sourceUrl: sanitizeTrackMetadataUrl(value.sourceUrl),
    // A damaged/truncated cache cannot skip unseen rows using its original checkpoint.
    hasMore: value.hasMore || !complete,
    continuation: complete && value.hasMore ? continuation : undefined,
    error: sanitizeAppErrorState(value.error),
  }
}

function sanitizeContinuation(
  input: unknown,
  loadedPageCount: number,
): TrackListingContinuation | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (!isPosition(value.nextPage) || value.nextPage !== loadedPageCount + 1) return undefined
  if (value.kind === 'page') return { kind: 'page', nextPage: value.nextPage }
  if (value.kind === 'cursor' && isPosition(value.cursor))
    return { kind: 'cursor', nextPage: value.nextPage, cursor: value.cursor }
  return undefined
}

function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function sanitizeAccount(input: unknown): CatalogResultSnapshot['account'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  const id =
    typeof value.id === 'string' && value.id.length <= 256 ? value.id || undefined : undefined
  const name = typeof value.name === 'string' ? value.name.slice(0, 256) : undefined
  const customName =
    typeof value.customName === 'string' ? value.customName.slice(0, 256) : undefined
  if (!id && !name?.trim() && !customName?.trim()) return undefined
  return { id, name, customName }
}
