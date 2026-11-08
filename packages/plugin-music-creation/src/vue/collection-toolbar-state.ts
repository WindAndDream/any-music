import { editingStateKey } from '@any-music/ui'
import type { ShallowRef } from 'vue'
export const collectionDraftKey = editingStateKey<ShallowRef<string>>(
  'MaterialCollectionToolbar.vue:collectionDraft',
)
export const deleteMaterialRecordsKey = editingStateKey<ShallowRef<boolean>>(
  'MaterialCollectionToolbar.vue:deleteMaterialRecords',
)
