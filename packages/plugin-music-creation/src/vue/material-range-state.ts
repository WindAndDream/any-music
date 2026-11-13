import { editingStateKey } from '@any-music/ui'
import type { ShallowRef } from 'vue'
export const startSecondsKey = editingStateKey<ShallowRef<number | ''>>(
  'MaterialTrackRow.vue:startSeconds',
)
export const endSecondsKey = editingStateKey<ShallowRef<number | ''>>(
  'MaterialTrackRow.vue:endSeconds',
)
