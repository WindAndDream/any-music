import { shallowRef } from 'vue'
import type { ShallowRef } from 'vue'

import { editingStateKey } from '../use-editing-session'

export function createTrackActionEditingState() {
  return {
    activeView: shallowRef<'actions' | 'tags' | 'name' | 'playlists'>('actions'),
    lastEditor: shallowRef<'tags' | 'name' | 'playlists'>('tags'),
    tagDraft: shallowRef(''),
  }
}
export const trackActionEditingKey =
  editingStateKey<ReturnType<typeof createTrackActionEditingState>>('track-actions')
export const trackNameDraftKey = editingStateKey<ShallowRef<string>>('track-name-draft')
export function createDrawerActionEditingState() {
  return { isRenaming: shallowRef(false), draftTitle: shallowRef('') }
}
export const drawerActionEditingKey =
  editingStateKey<ReturnType<typeof createDrawerActionEditingState>>('drawer-actions')
