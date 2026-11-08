import { editingStateKey } from '@any-music/ui'
import type { ShallowRef } from 'vue'

export const selectedSegmentKey = editingStateKey<ShallowRef<number>>('timeline-selected-segment')
