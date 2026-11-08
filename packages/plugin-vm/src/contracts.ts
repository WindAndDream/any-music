export type StandardOperation =
  | 'url'
  | 'query'
  | 'queryString'
  | 'encode'
  | 'decode'
  | 'atob'
  | 'btoa'
  | 'random'
  | 'log'
  | 'now'

/** Trusted ports only. No network, product objects, credentials or persistent state. */
export interface VmPorts {
  now(): number
  wait(ms: number, signal: AbortSignal): Promise<void>
  standard(operation: StandardOperation, inputJson: string): string
  sha256(input: string): Promise<string>
  hmacSha256(key: string, input: string): Promise<string>
}

export interface VmResources {
  wasmBinary: ArrayBuffer
  sha256(bytes: ArrayBuffer): Promise<string>
}

export class VmError extends Error {
  readonly code: 'profile' | 'budget' | 'cancelled' | 'guest' | 'disposed' | 'busy'
  constructor(code: VmError['code']) {
    super(`Plugin VM: ${code}`)
    this.name = 'VmError'
    this.code = code
  }
}
