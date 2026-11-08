import { editingStateKey } from '@any-music/ui'
import type {
  AppShellPreferenceKind,
  FilterHistorySettingsRegion,
  ProductViewId,
} from '@any-music/ui'
import type { ShallowRef } from 'vue'

/** In-memory navigation only; the host owns scope reset on an actual settings close. */
export const expandedGroupKey = editingStateKey<ShallowRef<ProductViewId | null>>(
  'settings:filter-history-expanded',
)
export const selectedRegionKey = editingStateKey<ShallowRef<FilterHistorySettingsRegion | null>>(
  'settings:filter-history-region',
)
export const regionOpenKey = editingStateKey<ShallowRef<boolean>>('settings:filter-history-open')
export const preferenceKey =
  editingStateKey<ShallowRef<AppShellPreferenceKind | null>>('settings:preference')
