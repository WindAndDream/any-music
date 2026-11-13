import { toAppErrorState, validatePlaylistName, type MusicPlaylist } from '@any-music/core'
import { shallowRef } from 'vue'
import type { ShallowRef } from 'vue'

import { editingStateKey, useEditingSession } from '../use-editing-session'

export { playlistNameKey } from '@any-music/core'

export const playlistEditorErrorMessage = (cause: unknown): string => toAppErrorState(cause).message

type PlaylistEditorDraft = {
  id: ShallowRef<string | null>
  description: ShallowRef<string>
  cover: ShallowRef<string | null | undefined>
  field: ShallowRef<'name' | 'description' | 'cover' | 'tags' | null>
  tag: ShallowRef<string>
}
const draftKey = editingStateKey<PlaylistEditorDraft>('playlist-editor-draft')
/** Unfinished input survives presentation replacement; opening another editor resets it explicitly. */
export function usePlaylistEditorDraft(): PlaylistEditorDraft {
  return useEditingSession('playlist-overview').state(draftKey, () => ({
    id: shallowRef(null),
    description: shallowRef(''),
    cover: shallowRef(),
    field: shallowRef(null),
    tag: shallowRef(''),
  }))
}

/** Controlled form feedback shares the same normalization and uniqueness rule as host writes. */
export function playlistNameError(
  name: string,
  playlists: readonly MusicPlaylist[],
  id?: string,
): string {
  if (!name.trim()) return ''
  try {
    validatePlaylistName(name, playlists, id)
    return ''
  } catch (cause) {
    return playlistEditorErrorMessage(cause)
  }
}
