import type { Track } from '@any-music/core'
import type { CatalogDrawerView } from '@any-music/ui'
import type { TrackGridViewport } from '@any-music/ui/catalog'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'

type Catalog = UiThemeFeatureMap['catalog']
type Display = Pick<
  Catalog['state'],
  'displayMode' | 'mobileColumns' | 'itemStyle' | 'downloadBusy'
>
type Result = Pick<
  CatalogDrawerView,
  | 'id'
  | 'isLoading'
  | 'status'
  | 'isSourceEnabled'
  | 'hasMore'
  | 'paginationLocked'
  | 'loadedPageCount'
  | 'errorMessage'
>

export interface CatalogSnapshot extends Display {
  theme: 'classic' | 'studio'
  colorScheme: 'light' | 'dark'
  density: string
  drawer: Result
  selectable: boolean
  tracks: readonly Track[]
  loadedTrackCount: number
  currentTrackId?: string
  selected: readonly string[]
  favorite: readonly string[]
  invalid: readonly string[]
  queued: readonly string[]
  names: readonly [string, string][]
  tags: readonly [string, readonly string[]][]
}

export type TrackAction = 'play' | 'select' | 'favorite' | 'queue' | 'download' | 'actions'
export type CatalogAction = { type: TrackAction; id: string } | { type: 'more' }

export interface CatalogLayout {
  padding: string
  viewportSize: TrackGridViewport
}

export type CatalogUpdate = Omit<CatalogSnapshot, 'tracks'> &
  Pick<Partial<CatalogSnapshot>, 'tracks'> & { layout: CatalogLayout; scrollTop?: number }
