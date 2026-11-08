/** Portable engine failures; applications map these into their own user-facing error catalog. */
export type AudioCompositionErrorCode =
  | 'invalid-range'
  | 'export-unavailable'
  | 'source-not-found'
  | 'media-format-unsupported'
  | 'media-decode-failed'
  | 'export-failed'
  | 'operation-cancelled'
export class AudioCompositionError extends Error {
  readonly code: AudioCompositionErrorCode

  constructor(code: AudioCompositionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = 'AudioCompositionError'
  }
}
