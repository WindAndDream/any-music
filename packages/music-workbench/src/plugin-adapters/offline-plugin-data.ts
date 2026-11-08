import { AppError } from '@any-music/core'
import type { Track } from '@any-music/core'

export type PluginDataLevel = 'L0' | 'L1' | 'L2' | 'Secret'
export interface PluginDataProvenance {
  level: PluginDataLevel
  sourceInstall: string
  sourceContext: string
  generation: number
  dataGeneration: number
}
export interface OfflineHostProjection {
  id: string
  accountScope: string
  version: number
  fields: Partial<
    Record<'Title' | 'Artist' | 'Note', { text: string; provenance: PluginDataProvenance }>
  >
}
export interface OfflinePluginDataPort {
  /** Trusted host-only entry, separate from the executor's bound channel. */
  select(projection: OfflineHostProjection): Promise<{ contextRef: string }>
  read(
    contextRef: string,
    objectId: string,
  ): Promise<Partial<Record<'Title' | 'Artist' | 'Note', string>>>
  prepareAnnotation(input: {
    contextRef: string
    objectId: string
    expectedVersion: number
    operationId: string
    text: string
  }): Promise<string>
  commit(ticket: string): Promise<number>
}

function unknownProvenance(): PluginDataProvenance {
  return {
    level: 'L2',
    sourceInstall: 'unknown',
    sourceContext: 'unknown',
    generation: 0,
    dataGeneration: 0,
  }
}

/** Offline host proxy, assembled only with a native-bound channel. There is no S12 production relay.
 * Source records/recipes remain in the product repository; annotation values and provenance commit
 * together in the native projection. No renderer apply callback can race a confirmed revocation.
 */
export function createOfflinePluginDataProxy(port: OfflinePluginDataPort) {
  return {
    select(input: {
      track: Track
      accountScope: string
      version: number
      titleProvenance?: PluginDataProvenance
      artistProvenance?: PluginDataProvenance
      note?: { text: string; provenance?: PluginDataProvenance }
    }) {
      // No object spread: nested credentials, signed URLs, raw source DTOs and playlist metadata
      // are deliberately absent. Existing native labels must survive re-projection.
      const projection: OfflineHostProjection = {
        id: input.track.id,
        accountScope: input.accountScope,
        version: input.version,
        fields: {
          Title: {
            text: input.track.title,
            provenance: structuredClone(input.titleProvenance ?? unknownProvenance()),
          },
          Artist: {
            text: input.track.artists.map((artist) => artist.name).join(' / '),
            provenance: structuredClone(input.artistProvenance ?? unknownProvenance()),
          },
        },
      }
      if (input.note)
        projection.fields.Note = {
          text: input.note.text,
          provenance: {
            ...structuredClone(input.note.provenance ?? unknownProvenance()),
            level: input.note.provenance?.level === 'Secret' ? 'Secret' : 'L2',
          },
        }
      return port.select(projection)
    },
    read: (contextRef: string, objectId: string) => port.read(contextRef, objectId),
    async annotate(input: Parameters<OfflinePluginDataPort['prepareAnnotation']>[0]) {
      if (
        !Number.isSafeInteger(input.expectedVersion) ||
        input.expectedVersion < 1 ||
        !input.operationId ||
        !input.text ||
        input.text.length > 500 ||
        Array.from(input.text).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new AppError('invalid-input', '歌曲注解或对象版本无效。')
      const ticket = await port.prepareAnnotation({
        contextRef: input.contextRef,
        objectId: input.objectId,
        expectedVersion: input.expectedVersion,
        operationId: input.operationId,
        text: input.text,
      })
      return port.commit(ticket)
    },
  }
}
