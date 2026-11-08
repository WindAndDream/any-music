import type { Track } from '@any-music/core'
import type { UiThemeTrackListActions, UiThemeTrackListState } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import StudioTrackRow from '../../../src/components/catalog/StudioTrackRow.vue'
import StudioTrackTable from '../../../src/components/library/StudioTrackTable.vue'
import { findStudioNode, invokeStudio, mountStudio } from '../../helpers/test-renderer'

const track: Track = {
  id: 'source:track:one',
  title: '歌曲',
  artists: [],
  source: { pluginId: 'source', mediaKind: 'audio', resourceId: 'one' },
}
function list(queued: boolean): UiThemeTrackListState {
  return {
    tracks: [track],
    selectedTrackIds: [],
    invalidTrackIds: [],
    favoriteTrackIds: [],
    queuedTrackIds: queued ? [track.id] : [],
    downloadedTrackIds: [],
    platformNames: new Map(),
    customNamesByTrackId: new Map(),
    customTagsByTrackId: new Map(),
    addedAtMsByTrackId: new Map(),
    displayMode: 'standard',
    mobileColumns: 1,
    filters: { searchFilters: [], tags: [], publishedRanges: [], durationRanges: [] },
    filterDraft: null,
  }
}
function actions(): UiThemeTrackListActions {
  return {
    play: vi.fn(),
    download: vi.fn(),
    toggleFavorite: vi.fn(),
    select: vi.fn(),
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
}

describe('Studio library queue actions', () => {
  it('uses the full list for playback and keeps native detail rows attached to their logical tracks', () => {
    const state = list(false)
    state.tracks = Array.from({ length: 80 }, (_, index) => ({
      ...track,
      id: `source:track:${index}`,
      title: `歌曲 ${index}`,
      source: { ...track.source, resourceId: String(index) },
    }))
    const intents = actions()
    const reorder = vi.fn()
    const view = mountStudio(
      defineComponent({
        setup: () => () =>
          h(
            StudioTrackTable,
            { state, actions: intents, reorder },
            {
              details: ({ trackId }: { trackId: string }) =>
                h('p', { 'data-details-for': trackId }, '详情'),
            },
          ),
      }),
      {},
    )
    try {
      const table = findStudioNode(view.root, (node) => node.tag === 'table')
      const tbody = findStudioNode(table, (node) => node.tag === 'tbody')
      const rows = tbody.children.filter((node) => node.tag !== '#text' && node.tag !== '#comment')
      expect(rows).toHaveLength(160)
      expect(rows.every((node) => node.tag === 'tr')).toBe(true)
      expect(
        findStudioNode(
          rows[159]!,
          (node) => node.props['data-details-for'] === state.tracks[79]!.id,
        ).textContent,
      ).toBe('详情')
      expect(findStudioNode(table, (node) => node.tag === 'caption').textContent).toContain('80')
      const play = findStudioNode(view.root, (node) => node.props['aria-label'] === '播放 歌曲 79')
      invokeStudio(play, 'onClick')
      expect(intents.play).toHaveBeenCalledExactlyOnceWith(
        state.tracks[79]!.id,
        state.tracks.map(({ id }) => id),
      )
      invokeStudio(
        findStudioNode(view.root, (node) => node.props['aria-label'] === '上移《歌曲 79》'),
        'onClick',
      )
      const ids = state.tracks.map(({ id }) => id)
      ;[ids[78], ids[79]] = [ids[79]!, ids[78]!]
      expect(reorder).toHaveBeenCalledExactlyOnceWith(ids)
    } finally {
      view.unmount()
    }
  })

  it.each([false, true])('labels the enqueue-only contract honestly when queued=%s', (queued) => {
    const intents = actions()
    const view = mountStudio(StudioTrackTable, { state: list(queued), actions: intents })
    try {
      const button = findStudioNode(
        view.root,
        (node) => node.props['aria-label'] === `${queued ? '已在待听' : '加入待听'} 歌曲`,
      )
      expect(Boolean(button.props.disabled)).toBe(queued)
      invokeStudio(button, 'onClick')
      if (queued) expect(intents.enqueue).not.toHaveBeenCalled()
      else expect(intents.enqueue).toHaveBeenCalledExactlyOnceWith([track.id])
    } finally {
      view.unmount()
    }
  })

  it('retains the catalog membership toggle for an already queued unavailable track', () => {
    const onQueue = vi.fn()
    const view = mountStudio(StudioTrackRow, {
      track,
      index: 0,
      title: track.title,
      selected: false,
      favorite: false,
      queued: true,
      invalid: true,
      current: false,
      downloadBusy: false,
      onQueue,
    })
    try {
      const button = findStudioNode(
        view.root,
        (node) => node.props['aria-label'] === '移出待听 歌曲',
      )
      expect(button.props.disabled).toBe(false)
      invokeStudio(button, 'onClick')
      expect(onQueue).toHaveBeenCalledOnce()
    } finally {
      view.unmount()
    }
  })
})
