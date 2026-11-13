import type { Track } from '@any-music/core'
import { provideConfirmationDialog } from '@any-music/ui/library'
import type { UiThemeTrackListActions, UiThemeTrackListState } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive, shallowRef } from 'vue'

import { useClassicTrackCollection } from '../../src/composables/use-classic-track-collection'
import { mountCatalogComponent } from '../helpers/test-renderer'

function setupCollection() {
  const tracks: Track[] = Array.from({ length: 1_000 }, (_, index) => ({
    id: `fixture:audio:${index}`,
    title: `歌曲 ${index}`,
    artists: [],
    source: { pluginId: 'fixture', resourceId: String(index), mediaKind: 'audio' },
  }))
  const state = shallowReactive<UiThemeTrackListState>({
    tracks,
    selectedTrackIds: [],
    invalidTrackIds: [],
    favoriteTrackIds: [],
    queuedTrackIds: [],
    downloadedTrackIds: [],
    platformNames: new Map(),
    customNamesByTrackId: new Map(),
    customTagsByTrackId: new Map(),
    addedAtMsByTrackId: new Map(),
    displayMode: 'standard',
    mobileColumns: 1,
    filters: { searchFilters: [], tags: [], publishedRanges: [], durationRanges: [] },
    filterDraft: null,
  })
  const actions: UiThemeTrackListActions = {
    select: vi.fn((ids) => {
      state.selectedTrackIds = ids
    }),
    play: vi.fn(),
    download: vi.fn(),
    toggleFavorite: vi.fn(),
    setFilterDraft: vi.fn(),
    applyFilters: vi.fn(),
    cancelFilters: vi.fn(),
    showTrackActions: vi.fn(),
    enqueue: vi.fn(),
    rename: vi.fn(),
    addToPlaylist: vi.fn(),
    useAsMaterial: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
    setDisplayMode: vi.fn(),
    setMobileColumns: vi.fn(),
  }
  const displayed = shallowRef<readonly Track[]>(tracks.filter((_, index) => index % 2 === 0))
  const reorder = vi.fn(),
    remove = vi.fn()
  let collection!: ReturnType<typeof useClassicTrackCollection>
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  // A parent owns confirmation while the initiating row/page may disappear.
  const active = shallowRef(true)
  const page = defineComponent({
    setup() {
      collection = useClassicTrackCollection(
        {
          title: '我的喜欢',
          scope: 'favorites:tracks',
          state,
          actions,
          availability: { status: 'available' },
          status: { status: 'ready' },
          reorder,
          remove,
        },
        () => displayed.value,
      )
      return () => h('div')
    },
  })
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        confirmation = provideConfirmationDialog()
        return () => (active.value ? h(page) : null)
      },
    }),
    {},
  )
  return { ...view, state, actions, displayed, reorder, remove, collection, confirmation, active }
}

describe('classic collection contracts before virtual mounting', () => {
  it('selects, plays and reorders the entire filtered collection without consulting mounted cards', () => {
    const view = setupCollection()
    try {
      const ids = view.displayed.value.map(({ id }) => id)
      const outside = view.state.tracks[1]!.id
      view.state.selectedTrackIds = [outside]
      view.collection.operatorOpen.value = true
      view.collection.toggleAll()
      expect(view.state.selectedTrackIds).toEqual([outside, ...ids])
      expect(view.collection.selected.value).toEqual(ids)
      expect(view.collection.allSelected.value).toBe(true)
      view.collection.play(ids.at(-1)!)
      expect(view.actions.play).toHaveBeenCalledExactlyOnceWith(ids.at(-1), ids)
      view.collection.move(ids.at(-1)!, -1)
      const reordered = [...ids]
      ;[reordered[498], reordered[499]] = [reordered[499]!, reordered[498]!]
      expect(view.reorder).toHaveBeenCalledExactlyOnceWith(reordered)
      view.collection.toggleAll()
      expect(view.state.selectedTrackIds).toEqual([outside])
    } finally {
      view.unmount()
    }
  })

  it('binds a pending download to the originally selected IDs after the controlled snapshot changes', async () => {
    const view = setupCollection()
    try {
      const originalIds = view.displayed.value.slice(-2).map(({ id }) => id)
      view.state.selectedTrackIds = originalIds
      const pending = view.collection.download()
      view.state.selectedTrackIds = [view.state.tracks[0]!.id]
      view.displayed.value = [view.state.tracks[0]!]
      view.confirmation.accept()
      await pending
      expect(view.actions.download).toHaveBeenCalledExactlyOnceWith(originalIds)
    } finally {
      view.unmount()
    }
  })

  it('rejects a late confirmation after the initiating presentation is disposed', async () => {
    const view = setupCollection()
    try {
      view.state.selectedTrackIds = [view.displayed.value.at(-1)!.id]
      const pending = view.collection.removeSelected()
      view.active.value = false
      await nextTick()
      view.confirmation.accept()
      await pending
      expect(view.remove).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
})
