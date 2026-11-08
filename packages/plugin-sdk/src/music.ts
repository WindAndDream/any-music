/** Music wire values carry stable identities and scoped references, never core objects. */
import type {
  MusicSearchInput,
  MusicImportInput,
  MusicListingInput,
  MusicCancelInput,
  MusicResolveInput,
  MusicReleaseInput,
  WireListing,
  WireTrackPage,
  WireMedia,
} from './generated/protocol.ts'
export type {
  MusicRequest,
  MusicResponse,
  MusicSearchInput,
  MusicImportInput,
  MusicListingInput,
  MusicCancelInput,
  MusicResolveInput,
  MusicReleaseInput,
  WireTrack,
  WireListing,
  WireTrackPage,
  WireMedia,
  WireMediaQuality,
} from './generated/protocol.ts'

/** A transport implements each operation explicitly; these functions are never serialized. */
export interface MusicSourceProvider {
  search(input: MusicSearchInput): Promise<WireListing>
  importUrl(input: MusicImportInput): Promise<WireListing>
  nextPage(input: MusicListingInput): Promise<WireTrackPage>
  close(input: MusicListingInput): Promise<void>
  cancel(input: MusicCancelInput): Promise<void>
  resolveMedia(input: MusicResolveInput): Promise<WireMedia>
  releaseMedia(input: MusicReleaseInput): Promise<void>
}
