import type { ShallowRef } from 'vue'

import { editingStateKey } from '../use-editing-session'
import type { PlaylistFilterState } from './use-playlist-filters'

export const filterOpenKey = editingStateKey<ShallowRef<boolean>>('playlist-filter-open')
export const filterDraftKey =
  editingStateKey<ShallowRef<PlaylistFilterState>>('playlist-filter-draft')
