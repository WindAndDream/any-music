/* Generated from schema/v1/protocol.schema.json. Do not edit. */

export type PluginProtocol =
  | LocalizedText
  | WireError
  | CapabilityRequirement
  | ExtensionRequirement
  | ContributionScope
  | ContributionDescriptor
  | CommandDescriptor
  | PluginManifest
  | HostCapabilities
  | CommandContext
  | PluginTask
  | HostEvent
  | UiNode
  | UiDocument
  | UiEvent
  | WireTrack
  | WireTrackPage
  | WireListing
  | WireMediaQuality
  | WireMedia
  | MusicSearchInput
  | MusicImportInput
  | MusicListingInput
  | MusicResolveInput
  | MusicReleaseInput
  | MusicCancelInput
  | EmptyResult
  | StateGetInput
  | StateSetInput
  | StateValue
  | NetworkInput
  | NetworkResult
  | ResponseReadInput
  | ResponseChunk
  | ResponseReleaseInput
  | DigestInput
  | DigestResult
  | HostRequest
  | HostResponse
  | MusicRequest
  | MusicResponse
  | PackageIntegrityEntry
  | PackageIntegrity
  | PackageSignature
  | PackageRevocations
  | GuestInvocation
  | GuestStep
  | SourceCredentialField
  | SourceAuthentication
export type PluginTask =
  | {
      taskId: string
      contextRef: string
      deadlineMs: number
      state: 'failed'
      completed: number
      total?: number
      error: WireError
    }
  | {
      taskId: string
      contextRef: string
      deadlineMs: number
      state: 'queued' | 'running' | 'succeeded' | 'cancelled'
      completed: number
      total?: number
    }
export type HostEvent =
  | {
      wireVersion: 1
      eventId: string
      eventVersion: 1
      contextRef: string
      event: 'player.track-changed'
      sequence: number
      trackRef: string | null
    }
  | {
      wireVersion: 1
      eventId: string
      eventVersion: 1
      contextRef: string
      event: 'player.ended'
      sequence: number
      trackRef: string
    }
  | {
      wireVersion: 1
      eventId: string
      eventVersion: 1
      contextRef: string
      event: 'task.changed'
      sequence: number
      task: PluginTask
    }
export type UiNode =
  | {
      id: string
      type: 'text'
      text: string
    }
  | {
      id: string
      type: 'button'
      label: LocalizedText
      commandId: string
    }
  | {
      id: string
      type: 'track-list'
      listingRef: string
    }
  | {
      id: string
      type: 'form'
      label: LocalizedText
      commandId: string
      /**
       * @minItems 1
       * @maxItems 16
       */
      fields:
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
        | [
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
            {
              id: string
              label: LocalizedText
              type: 'text' | 'number' | 'checkbox'
              maxLength?: number
            },
          ]
    }
export type MusicCancelInput =
  | {
      listingRef: string
    }
  | {
      taskId: string
    }
export type HostRequest =
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'state.get'
      input: StateGetInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'state.set'
      input: StateSetInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'network.request'
      input: NetworkInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'network.readResponse'
      input: ResponseReadInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'network.releaseResponse'
      input: ResponseReleaseInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'crypto.sha256'
      input: DigestInput
    }
export type HostResponse =
  | {
      wireVersion: 1
      requestId: string
      operation: 'state.get'
      ok: true
      result: StateValue
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'state.get'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'state.set'
      ok: true
      result: StateValue
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'state.set'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'network.request'
      ok: true
      result: NetworkResult
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'network.request'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'network.readResponse'
      ok: true
      result: ResponseChunk
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'network.readResponse'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'network.releaseResponse'
      ok: true
      result: EmptyResult
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'network.releaseResponse'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'crypto.sha256'
      ok: true
      result: DigestResult
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'crypto.sha256'
      ok: false
      error: WireError
    }
export type MusicRequest =
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'music.search'
      input: MusicSearchInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'music.importUrl'
      input: MusicImportInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'music.nextPage'
      input: MusicListingInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'music.close'
      input: MusicListingInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'music.cancel'
      input: MusicCancelInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'music.resolveMedia'
      input: MusicResolveInput
    }
  | {
      wireVersion: 1
      requestId: string
      contextRef: string
      deadlineMs: number
      operation: 'music.releaseMedia'
      input: MusicReleaseInput
    }
export type MusicResponse =
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.search'
      ok: true
      result: WireListing
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.search'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.importUrl'
      ok: true
      result: WireListing
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.importUrl'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.nextPage'
      ok: true
      result: WireTrackPage
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.nextPage'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.close'
      ok: true
      result: EmptyResult
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.close'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.cancel'
      ok: true
      result: EmptyResult
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.cancel'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.resolveMedia'
      ok: true
      result: WireMedia
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.resolveMedia'
      ok: false
      error: WireError
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.releaseMedia'
      ok: true
      result: EmptyResult
    }
  | {
      wireVersion: 1
      requestId: string
      operation: 'music.releaseMedia'
      ok: false
      error: WireError
    }
export type GuestStep =
  | {
      kind: 'complete'
      outputJson: string
    }
  | {
      kind: 'host'
      request: HostRequest
      checkpointJson: string
    }

export interface LocalizedText {
  'zh-CN': string
  en: string
}
export interface WireError {
  code:
    | 'invalid-input'
    | 'unsupported-version'
    | 'capability-unavailable'
    | 'operation-cancelled'
    | 'timeout'
    | 'limit-exceeded'
    | 'invalid-response'
    | 'upstream-error'
    | 'access-denied'
    | 'not-found'
    | 'rate-limited'
    | 'conflict'
    | 'not-authenticated'
    | 'account-unavailable'
    | 'unsupported-url'
    | 'verification-required'
    | 'pagination-unavailable'
    | 'network-error'
  message: string
  isRetryable: boolean
}
export interface CapabilityRequirement {
  id: string
  version: number
  required: boolean
  reason: LocalizedText
}
export interface ExtensionRequirement {
  id:
    | 'navigation.sidebar'
    | 'workspace.views'
    | 'track.actions.secondary'
    | 'track.details'
    | 'trackList.operator.actions'
    | 'trackList.filters'
    | 'settings.sections'
    | 'music.sources'
  version: number
  required: boolean
}
export interface ContributionScope {
  /**
   * @minItems 0
   * @maxItems 5
   */
  sections:
    | []
    | ['catalog' | 'queue' | 'favorites' | 'playlists' | 'history']
    | [
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
      ]
    | [
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
      ]
    | [
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
      ]
    | [
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
        'catalog' | 'queue' | 'favorites' | 'playlists' | 'history',
      ]
  /**
   * @minItems 1
   * @maxItems 2
   */
  forms: ['desktop' | 'mobile'] | ['desktop' | 'mobile', 'desktop' | 'mobile']
}
export interface ContributionDescriptor {
  contributionId: string
  pointId:
    | 'navigation.sidebar'
    | 'workspace.views'
    | 'track.actions.secondary'
    | 'track.details'
    | 'trackList.operator.actions'
    | 'trackList.filters'
    | 'settings.sections'
    | 'music.sources'
  contractVersion: 1
  required: boolean
  title: LocalizedText
  scope: ContributionScope
  commandId?: string
  viewId?: string
  providerId?: string
  inputSchemaId: 'urn:any-music:plugin:command-context:1'
  eventSchemaId: 'urn:any-music:plugin:ui-event:1'
  cardinality: 'many'
  fallback: 'hidden'
  budgetProfileVersion: 1
}
export interface CommandDescriptor {
  id: string
  title: LocalizedText
}
export interface PluginManifest {
  $schema?: string
  manifestVersion: 1
  packageFormatVersion: 1
  id: string
  version: string
  name: LocalizedText
  description: LocalizedText
  sdk: {
    minimum: string
    maximumExclusive: string
  }
  /**
   * @minItems 1
   * @maxItems 8
   */
  wireVersions:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
  runtimeProfileVersion: number
  contributionVersion: number
  dataSchemaVersion: number
  execution: 'declarative' | 'sandbox-code'
  entry?: 'dist/main.js'
  integrity: 'integrity.json'
  /**
   * @minItems 1
   * @maxItems 2
   */
  forms: ['desktop' | 'mobile'] | ['desktop' | 'mobile', 'desktop' | 'mobile']
  /**
   * @minItems 0
   * @maxItems 32
   */
  capabilities: CapabilityRequirement[]
  /**
   * @minItems 0
   * @maxItems 100
   */
  commands: CommandDescriptor[]
  /**
   * @minItems 0
   * @maxItems 100
   */
  contributions: ContributionDescriptor[]
  /**
   * @minItems 0
   * @maxItems 3
   */
  activationEvents:
    | []
    | ['on-command' | 'on-view' | 'on-source']
    | ['on-command' | 'on-view' | 'on-source', 'on-command' | 'on-view' | 'on-source']
    | [
        'on-command' | 'on-view' | 'on-source',
        'on-command' | 'on-view' | 'on-source',
        'on-command' | 'on-view' | 'on-source',
      ]
  memoryClass: 'minimum' | 'increased'
  sourceAuthentication?: SourceAuthentication
}
export interface SourceAuthentication {
  protocolVersion: 1
  apiBaseUrl: string
  allowUnauthenticated: boolean
  /**
   * @minItems 0
   * @maxItems 3
   */
  methods:
    | []
    | ['qr' | 'credentials' | 'phone']
    | ['qr' | 'credentials' | 'phone', 'qr' | 'credentials' | 'phone']
    | [
        'qr' | 'credentials' | 'phone',
        'qr' | 'credentials' | 'phone',
        'qr' | 'credentials' | 'phone',
      ]
  /**
   * @minItems 0
   * @maxItems 8
   */
  credentialFields:
    | []
    | [SourceCredentialField]
    | [SourceCredentialField, SourceCredentialField]
    | [SourceCredentialField, SourceCredentialField, SourceCredentialField]
    | [SourceCredentialField, SourceCredentialField, SourceCredentialField, SourceCredentialField]
    | [
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
      ]
    | [
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
      ]
    | [
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
      ]
    | [
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
        SourceCredentialField,
      ]
}
export interface SourceCredentialField {
  id: string
  label: LocalizedText
  secret: boolean
}
export interface HostCapabilities {
  sdkVersion: string
  /**
   * @minItems 1
   * @maxItems 8
   */
  manifestVersions:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
  /**
   * @minItems 1
   * @maxItems 8
   */
  wireVersions:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
  /**
   * @minItems 1
   * @maxItems 8
   */
  runtimeProfileVersions:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
  /**
   * @minItems 1
   * @maxItems 8
   */
  contributionVersions:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
  /**
   * @minItems 1
   * @maxItems 8
   */
  packageFormatVersions:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
  /**
   * @minItems 1
   * @maxItems 8
   */
  dataSchemaVersions:
    | [number]
    | [number, number]
    | [number, number, number]
    | [number, number, number, number]
    | [number, number, number, number, number]
    | [number, number, number, number, number, number]
    | [number, number, number, number, number, number, number]
    | [number, number, number, number, number, number, number, number]
  form: 'desktop' | 'mobile'
  externalPlugins: 'none' | 'declarative' | 'sandbox-code'
  sandboxAvailable: boolean
  /**
   * @minItems 0
   * @maxItems 64
   */
  capabilities: {
    id: string
    /**
     * @minItems 1
     * @maxItems 8
     */
    versions:
      | [number]
      | [number, number]
      | [number, number, number]
      | [number, number, number, number]
      | [number, number, number, number, number]
      | [number, number, number, number, number, number]
      | [number, number, number, number, number, number, number]
      | [number, number, number, number, number, number, number, number]
  }[]
  /**
   * @minItems 0
   * @maxItems 64
   */
  extensionPoints: {
    id: string
    /**
     * @minItems 1
     * @maxItems 8
     */
    versions:
      | [number]
      | [number, number]
      | [number, number, number]
      | [number, number, number, number]
      | [number, number, number, number, number]
      | [number, number, number, number, number, number]
      | [number, number, number, number, number, number, number]
      | [number, number, number, number, number, number, number, number]
  }[]
}
export interface CommandContext {
  contextRef: string
  scope: ContributionScope
  /**
   * @minItems 0
   * @maxItems 100
   */
  objectRefs: {
    id: string
    version: number
  }[]
  expiresAtMs: number
}
export interface UiDocument {
  schemaVersion: 1
  viewId: string
  viewRevision: number
  /**
   * @minItems 0
   * @maxItems 1000
   */
  nodes: UiNode[]
}
export interface UiEvent {
  schemaVersion: 1
  viewId: string
  viewRevision: number
  nodeId: string
  commandId: string
  contextRef: string
  /**
   * @minItems 0
   * @maxItems 16
   */
  values?:
    | []
    | [
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
    | [
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
        {
          fieldId: string
          value: string
        },
      ]
}
export interface WireTrack {
  id: string
  title: string
  /**
   * @minItems 0
   * @maxItems 100
   */
  artists: {
    id?: string
    name: string
  }[]
  artworkUrl?: string
  durationMs?: number
  publishedAtMs?: number
  description?: string
  /**
   * @minItems 0
   * @maxItems 100
   */
  sourceTags?: string[]
  statistics?: {
    playCount?: number
    danmakuCount?: number
    favoriteCount?: number
    commentCount?: number
    likeCount?: number
  }
  source: {
    pluginId: string
    mediaKind: 'audio' | 'video' | 'custom'
    resourceId: string
    partId?: string
    pageUrl?: string
  }
}
export interface WireTrackPage {
  /**
   * @minItems 0
   * @maxItems 100
   */
  items: WireTrack[]
  pageNumber: number
  pageSize: number
  total?: number
  hasMore: boolean
}
export interface WireListing {
  listingRef: string
  id: string
  title: string
  sourceUrl?: string
  estimatedTotal?: number
  expiresAtMs: number
}
export interface WireMediaQuality {
  id: string
  label: string
  rank: number
  bitrate?: number
}
export interface WireMedia {
  mediaRef: string
  quality: WireMediaQuality
  /**
   * @minItems 1
   * @maxItems 32
   */
  availableQualities: [WireMediaQuality, ...WireMediaQuality[]]
  mimeType?: string
  codecs?: string
  durationMs?: number
  loadingStrategy: 'range' | 'eager'
  expiresAtMs: number
}
export interface MusicSearchInput {
  providerId: string
  query: string
  pageSize?: number
}
export interface MusicImportInput {
  providerId: string
  url: string
  pageSize?: number
}
export interface MusicListingInput {
  listingRef: string
}
export interface MusicResolveInput {
  providerId: string
  track: WireTrack
  qualityId?: string
  taskId: string
}
export interface MusicReleaseInput {
  mediaRef: string
}
export interface EmptyResult {}
export interface StateGetInput {
  key: string
}
export interface StateSetInput {
  key: string
  schemaVersion: number
  value: string
  expectedVersion: number
  operationId: string
}
export interface StateValue {
  value: string | null
  version: number
}
export interface NetworkInput {
  url: string
  method: 'GET' | 'HEAD' | 'POST'
  body?: string
}
export interface NetworkResult {
  responseRef: string
  status: number
  sizeBytes: number
  expiresAtMs: number
}
export interface ResponseReadInput {
  responseRef: string
  offset: number
  length: number
}
export interface ResponseChunk {
  text: string
  nextOffset: number
  done: boolean
}
export interface ResponseReleaseInput {
  responseRef: string
}
export interface DigestInput {
  text: string
}
export interface DigestResult {
  hex: string
}
export interface PackageIntegrityEntry {
  path: string
  size: number
  sha256: string
}
export interface PackageIntegrity {
  version: 1
  /**
   * @maxItems 1024
   */
  files: PackageIntegrityEntry[]
}
export interface PackageSignature {
  version: 1
  algorithm: 'Ed25519'
  keyId: string
  publicKey: string
  fingerprint: string
  signature: string
}
export interface PackageRevocations {
  version: 1
  sequence: number
  issuedAtMs: number
  expiresAtMs: number
  /**
   * @maxItems 1024
   */
  pluginIds: string[]
  /**
   * @maxItems 1024
   */
  packageHashes: string[]
  /**
   * @maxItems 1024
   */
  publisherKeys: string[]
}
export interface GuestInvocation {
  commandId?: string
  operation:
    | 'command.run'
    | 'music.search'
    | 'music.importUrl'
    | 'music.nextPage'
    | 'music.close'
    | 'music.cancel'
    | 'music.resolveMedia'
    | 'music.releaseMedia'
    | 'migrate'
  inputJson: string
  contextRef: string
  sequence: number
  deadlineMs: number
  checkpointJson?: string
  response?: HostResponse
}
