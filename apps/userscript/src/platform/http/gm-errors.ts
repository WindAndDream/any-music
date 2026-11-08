import { ResponseTooLargeError } from '@any-music/music-workbench/media/response-too-large-error'

/** Preserve the GM transport's public error name while sharing bounded-reader recovery. */
export class GmResponseTooLargeError extends ResponseTooLargeError {
  constructor(maxResponseBytes: number, finalUrl?: string) {
    super(maxResponseBytes, finalUrl)
    this.name = 'GmResponseTooLargeError'
  }
}
