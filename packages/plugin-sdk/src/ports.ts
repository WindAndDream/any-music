import type {
  PluginManifest,
  HostCapabilities,
  HostRequest,
  HostResponse,
  HostEvent,
  StateGetInput,
  StateSetInput,
  StateValue,
  NetworkInput,
  NetworkResult,
  ResponseReadInput,
  ResponseChunk,
  ResponseReleaseInput,
  DigestInput,
  DigestResult,
} from './generated/protocol.ts'
import type { MusicSourceProvider } from './music.ts'

export interface PluginStateStore {
  get(input: StateGetInput): Promise<StateValue>
  set(input: StateSetInput): Promise<StateValue>
}

/** Session/identity/epoch and authorization belong to the trusted channel, never to input. */
export interface HostPort {
  state: PluginStateStore
  network: {
    request(input: NetworkInput): Promise<NetworkResult>
    readResponse(input: ResponseReadInput): Promise<ResponseChunk>
    releaseResponse(input: ResponseReleaseInput): Promise<void>
  }
  crypto: { sha256(input: DigestInput): Promise<DigestResult> }
}

export interface ExecutorSession {
  music: MusicSourceProvider
  deliverEvent(event: HostEvent): Promise<void>
  terminate(): Promise<void>
}

/** Implementations inject transport and VM; the SDK creates no Worker or engine. */
export interface ExecutorPort {
  start(
    input: { manifest: PluginManifest; capabilities: HostCapabilities },
    host: HostPort,
  ): Promise<ExecutorSession>
}

// These aliases keep request/response pairing visible without adding an arbitrary invoke API.
export type StateGetRequest = Extract<HostRequest, { operation: 'state.get' }>
export type StateGetResponse = Extract<HostResponse, { operation: 'state.get' }>
