import type { DownloadHistoryBatch, Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, h, nextTick, onScopeDispose, shallowRef } from 'vue'

import { useDownloadListControls } from '../../src/composables/downloads/use-download-list-controls'
import { useFilterDraft } from '../../src/composables/filters/use-filter-draft'
import { usePlaylistPanel } from '../../src/composables/library/use-playlist-panel'
import { useCatalogListControls } from '../../src/composables/music-sources/use-catalog-list-controls'
import { useCatalogTrackFilterEditor } from '../../src/composables/music-sources/use-catalog-track-filter-editor'
import {
  useCatalogTrackFilters,
  cloneCatalogTrackFilterState,
} from '../../src/composables/music-sources/use-catalog-track-filters'
import { useQueueListControls } from '../../src/composables/music-sources/use-queue-list-controls'
import {
  createEditingSession,
  provideEditingSession,
  useEditingSession,
} from '../../src/composables/use-editing-session'
import { useGlobalSettings } from '../../src/composables/use-global-settings'

const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  patchProp() {},
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
})
function presentations<State>(setup: () => State) {
  const session = createEditingSession()
  const active = shallowRef('A')
  let state!: State
  const root = () =>
    defineComponent({
      setup() {
        state = setup()
        return () => h('div')
      },
    })
  const A = root(),
    B = root()
  const app = renderer.createApp(
    defineComponent({
      setup() {
        provideEditingSession(session)
        onScopeDispose(() => session.dispose())
        return () => h(active.value === 'A' ? A : B)
      },
    }),
  )
  app.mount({})
  return {
    state: () => state,
    session,
    unmount: () => app.unmount(),
    async switch() {
      active.value = active.value === 'A' ? 'B' : 'A'
      await nextTick()
    },
  }
}
const tracks: Track[] = ['one', 'two'].map((id) => ({
  id,
  title: id,
  artists: [],
  source: { pluginId: 'test', resourceId: id, mediaKind: 'audio' },
}))

describe('editing state above presentation lifetime', () => {
  it('keeps applied filters, unfinished filter drafts, incomplete ranges and ordered selection through A → B → A', async () => {
    const open = shallowRef(true)
    const p = presentations(() => {
      const editing = useEditingSession('catalog:one')
      const { filters, visibleTracks } = useCatalogTrackFilters(
        tracks,
        new Map(),
        new Map(),
        editing,
      )
      const draft = useFilterDraft({
        editing,
        applied: filters,
        open,
        clone: cloneCatalogTrackFilterState,
        apply: (value) => {
          filters.value = value
        },
      })
      const selection = useCatalogListControls({
        editing,
        items: visibleTracks,
        getId: (track) => track.id,
        getName: (track) => track.title,
      })
      provideEditingSession(editing.scope('filter-panel'))
      return { filters, draft, selection }
    })
    try {
      const initial = p.state()
      initial.selection.toggleItem('two')
      initial.selection.toggleItem('one')
      initial.draft.draft.value = {
        ...initial.draft.draft.value,
        searchFilters: [{ query: 'unfinished' }],
      }
      for (let index = 0; index < 2; index++) {
        // The next root can mount only after the previous one has left.
        // eslint-disable-next-line no-await-in-loop
        await p.switch()
        expect(p.state().draft.draft).toBe(initial.draft.draft)
        expect(p.state().draft.draft.value.searchFilters).toEqual([{ query: 'unfinished' }])
        expect(p.state().filters.value.searchFilters).toEqual([])
        expect([...p.state().selection.selectedIds.value]).toEqual(['two', 'one'])
      }
      open.value = false
      await nextTick()
      expect(p.state().draft.draft.value.searchFilters).toEqual([])
    } finally {
      p.unmount()
    }

    const q = presentations(() =>
      useCatalogTrackFilterEditor({
        filters: shallowRef(
          cloneCatalogTrackFilterState({
            searchFilters: [],
            tags: [],
            publishedRanges: [],
            durationRanges: [],
          }),
        ),
        dimension: 'duration',
      }),
    )
    try {
      q.state().minimumMinutes.value = '0.'
      q.state().maximumMinutes.value = 'unfinished'
      await q.switch()
      expect(q.state().minimumMinutes.value).toBe('0.')
      expect(q.state().maximumMinutes.value).toBe('unfinished')
      expect(q.state().durationError.value).toBeTruthy()
    } finally {
      q.unmount()
    }
  })

  it('keeps queue/favorites separate and download task IDs/status/selection unchanged', async () => {
    const batch: DownloadHistoryBatch = {
      id: 'batch',
      status: 'running',
      startedAtMs: 1,
      concurrency: 1,
      origin: { kind: 'queue', label: '待听' },
      items: [
        {
          id: 'task:one',
          track: tracks[0]!,
          status: 'paused',
          requestedAtMs: 1,
          maxRetryCount: 0,
          attempts: [],
        },
      ],
    }
    const p = presentations(() => {
      const queue = useQueueListControls({
        editing: useEditingSession('queue'),
        items: tracks,
        addedAtMsByTrackId: new Map(),
        platformNames: new Map(),
        filterOpen: true,
      })
      const favorites = useQueueListControls({
        editing: useEditingSession('favorites'),
        items: tracks,
        addedAtMsByTrackId: new Map(),
        platformNames: new Map(),
        filterOpen: true,
      })
      const downloads = useDownloadListControls({
        batches: [batch],
        platformNames: new Map(),
        filterOpen: true,
      })
      return { queue, favorites, downloads }
    })
    try {
      p.state().queue.selection.toggleItem('two')
      p.state().favorites.selection.toggleItem('one')
      p.state().downloads.status.value = 'paused'
      p.state().downloads.selection.toggleItem('task:one')
      p.state().queue.draft.draft.value = {
        ...p.state().queue.filters.value,
        searchFilters: [{ query: '未应用' }],
      }
      await p.switch()
      expect([...p.state().queue.selection.selectedIds.value]).toEqual(['two'])
      expect([...p.state().favorites.selection.selectedIds.value]).toEqual(['one'])
      expect(p.state().queue.draft.draft.value.searchFilters[0]?.query).toBe('未应用')
      expect(p.state().downloads.status.value).toBe('paused')
      expect([...p.state().downloads.selection.selectedIds.value]).toEqual(['task:one'])
    } finally {
      p.unmount()
    }
  })

  it('keeps playlist navigation/name and ordinary settings drafts without emitting save or confirmation', async () => {
    const emit = vi.fn()
    const p = presentations(() => ({
      playlists: usePlaylistPanel({
        props: {
          records: [],
          playlists: [],
          customTracks: [],
          platforms: [],
          favoriteTrackIds: new Set(),
          mode: 'sequence',
          errorMessage: '',
          downloadBusy: false,
        },
        emit,
      }),
      settings: useGlobalSettings({
        props: {
          plugins: [],
          availabilityByPluginId: {},
          enabledPluginIds: [],
          profile: { id: 'user', displayName: '用户' },
          historyLimit: 100,
          downloadConcurrency: 2,
        },
        emit,
      }),
    }))
    try {
      p.state().playlists.query.value = '检索'
      p.state().playlists.playlistDraft.value = '未创建的歌单'
      p.state().playlists.openPlaylist('playlist:one')
      p.state().settings.profileName.value = '未保存名称'
      p.state().settings.historyLimitInput.value = 'incomplete'
      p.state().settings.downloadConcurrencyInput.value = ''
      await p.switch()
      expect(p.state().playlists.query.value).toBe('检索')
      expect(p.state().playlists.playlistDraft.value).toBe('未创建的歌单')
      expect(p.state().playlists.activePlaylistId.value).toBe('playlist:one')
      expect(p.state().settings.profileName.value).toBe('未保存名称')
      expect(p.state().settings.historyLimitInput.value).toBe('incomplete')
      expect(p.state().settings.downloadConcurrencyInput.value).toBe('')
      expect(emit).not.toHaveBeenCalled()
    } finally {
      p.unmount()
    }
    expect(() => p.session.scope('settings')).toThrow('disposed')
  })
})
