import type { WireError } from './generated/protocol.ts'

/** Local transport exception; only detail crosses the wire. No AM business numbers live here. */
export class PluginCallError extends Error {
  readonly detail: WireError
  constructor(detail: WireError) {
    super(detail.message)
    this.name = 'PluginCallError'
    this.detail = detail
  }
}
