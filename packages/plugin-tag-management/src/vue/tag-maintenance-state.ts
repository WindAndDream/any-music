import { editingStateKey } from '@any-music/ui'
import type { ShallowRef } from 'vue'
export const selectedTagKey = editingStateKey<ShallowRef<string>>(
  'TagMaintenanceToolbar.vue:selectedTag',
)
export const tagDraftKey = editingStateKey<ShallowRef<string>>('TagMaintenanceToolbar.vue:tagDraft')
export const tagSearchKey = editingStateKey<ShallowRef<string>>('tags:maintenance-search')
