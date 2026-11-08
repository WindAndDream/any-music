import { shallowRef } from 'vue'

import type { CatalogTrackFilterDimension } from '../../components/music-sources/catalog-track-filter-presentation'
import { editingStateKey } from '../use-editing-session'
import { createCatalogTrackFilterState } from './use-catalog-track-filters'
import type { CatalogTrackFilterState } from './use-catalog-track-filters'

function createFilterPanelState() {
  return {
    initialIndex: shallowRef<number>(),
    activeDimension: shallowRef<CatalogTrackFilterDimension>(),
    dimensionDraft: shallowRef<CatalogTrackFilterState>(createCatalogTrackFilterState()),
    dimensionPreview: shallowRef<CatalogTrackFilterState>(),
  }
}

export const filterPanelKey =
  editingStateKey<ReturnType<typeof createFilterPanelState>>('filter-panel')
export { createFilterPanelState }
