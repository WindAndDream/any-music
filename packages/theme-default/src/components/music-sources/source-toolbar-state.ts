import { editingStateKey } from '@any-music/ui/catalog'
import type { ShallowRef } from 'vue'

export const discoveryModeKey = editingStateKey<ShallowRef<'search' | 'import'>>(
  'source-toolbar:discovery-mode',
)
