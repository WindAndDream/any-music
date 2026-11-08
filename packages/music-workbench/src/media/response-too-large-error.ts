/** A bounded reader may retry the final CDN URL without retaining it in storage. */
export class ResponseTooLargeError extends Error {
  readonly finalUrl?: string
  constructor(maxResponseBytes: number, finalUrl?: string) {
    super(`Response exceeded ${maxResponseBytes} bytes`)
    this.name = 'ResponseTooLargeError'
    this.finalUrl = finalUrl
  }
}
