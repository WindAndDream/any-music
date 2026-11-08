import { shallowRef } from 'vue'

import { editingStateKey } from '../use-editing-session'
import type { CatalogTrackFilterState } from './use-catalog-track-filters'

/** Presentation choices live in the host's editing session, never in a repository or theme snapshot. */
export const catalogRootEditingKey =
  editingStateKey<ReturnType<typeof createCatalogRootEditing>>('catalog-root')
export function createCatalogRootEditing() {
  return {
    discoveryOpen: shallowRef(false),
    sourcePickerOpen: shallowRef(false),
    listFilterOpen: shallowRef(false),
    operatorOpen: shallowRef(false),
    displayOpen: shallowRef(false),
    contextOpen: shallowRef(false),
    actionDrawerId: shallowRef<string>(),
    errorDrawerId: shallowRef<string>(),
    actionTrackId: shallowRef<string>(),
    filterPreview: shallowRef<CatalogTrackFilterState | null>(null),
    filterDetailOpen: shallowRef(false),
  }
}
