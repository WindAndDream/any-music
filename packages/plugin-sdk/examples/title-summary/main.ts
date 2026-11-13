import type { CommandContext, HostPort, UiDocument } from '@any-music/plugin-sdk'
import type { WireTrack } from '@any-music/plugin-sdk/music'

/** Author logic only. The host must project and authorize selected titles before calling this. */
export async function summarizeTitles(
  context: CommandContext,
  tracks: readonly WireTrack[],
  host: HostPort,
  save: boolean,
): Promise<UiDocument> {
  const text =
    tracks
      .map((track) => track.title)
      .join('、')
      .slice(0, 4096) || 'No tracks selected'
  if (save)
    await host.state.set({
      key: 'last-summary',
      schemaVersion: 1,
      value: text,
      expectedVersion: 0,
      operationId: context.contextRef,
    })
  return {
    schemaVersion: 1,
    viewId: 'summary',
    viewRevision: 1,
    nodes: [{ id: 'summary', type: 'text', text }],
  }
}
