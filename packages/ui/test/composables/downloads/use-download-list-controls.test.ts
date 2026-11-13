import type { DownloadHistoryBatch, DownloadHistoryItem } from '@any-music/core'
import { describe, expect, it } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import {
  getDownloadListState,
  useDownloadListControls,
} from '../../../src/composables/downloads/use-download-list-controls'

const item = (id: string, status: DownloadHistoryItem['status']): DownloadHistoryItem => ({
  id,
  status,
  requestedAtMs: 1,
  maxRetryCount: 3,
  attempts: [],
  track: {
    id: `track:${id}`,
    title: id,
    artists: [{ name: '作者' }],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: '1' },
  },
})
const batch: DownloadHistoryBatch = {
  id: 'batch',
  status: 'running',
  startedAtMs: 1,
  concurrency: 2,
  origin: { kind: 'queue', label: '待听' },
  items: [
    item('active', 'downloading'),
    item('paused', 'paused'),
    item('failed', 'failed'),
    { ...item('saved', 'succeeded'), savedAtMs: 2 },
  ],
}

describe('download task collection', () => {
  it('uses song tags for task filtering and scopes tag choices to the selected task state', () => {
    const scope = effectScope()
    const controls = scope.run(() =>
      useDownloadListControls({
        batches: [batch],
        filterOpen: false,
        platformNames: new Map(),
        customTags: new Map([
          ['track:active', ['通勤']],
          ['track:saved', ['通勤', '收藏']],
          ['track:paused', ['放松']],
          ['unrelated', ['其他']],
        ]),
      }),
    )!
    try {
      controls.filters.value = { ...controls.filters.value, tags: ['通勤'] }
      expect(controls.visibleEntries.value.map(({ item: task }) => task.id)).toEqual([
        'active',
        'saved',
      ])
      expect(controls.tagStats.value).toContainEqual({ name: '通勤', count: 2 })
      expect(controls.tagStats.value.some(({ name }) => name === '其他')).toBe(false)
      controls.status.value = 'paused'
      expect(controls.tagStats.value).toEqual([{ name: '放松', count: 1 }])
      expect(controls.visibleEntries.value).toEqual([])
    } finally {
      scope.stop()
    }
  })
  it('counts a repeated song once across batches before filtering and selection', () => {
    const scope = effectScope()
    const controls = scope.run(() =>
      useDownloadListControls({
        batches: [
          batch,
          { ...batch, id: 'older', items: [{ ...batch.items[0]!, id: 'older-task' }] },
        ],
        filterOpen: false,
        platformNames: new Map(),
      }),
    )!
    try {
      expect(controls.entries.value).toHaveLength(4)
      controls.selection.toggleAllVisible()
      expect(controls.selection.selectedCount.value).toBe(4)
      expect(controls.selection.selectedIds.value.has('older-task')).toBe(false)
      controls.status.value = 'succeeded'
      expect(controls.actionLabel.value).toBe('重新下载')
    } finally {
      scope.stop()
    }
  })
  it('selects task identities, scopes selections to visible states and derives mixed actions', () => {
    const scope = effectScope()
    const controls = scope.run(() =>
      useDownloadListControls({ batches: [batch], filterOpen: false, platformNames: new Map() }),
    )!
    try {
      controls.selection.toggleAllVisible()
      expect(controls.selection.selectedCount.value).toBe(4)
      expect(controls.resumableIds.value).toEqual(['paused', 'failed', 'saved'])
      expect(controls.cancellableIds.value).toEqual(['active', 'paused'])
      expect(controls.pausableIds.value).toEqual(['active'])
      expect(controls.actionLabel.value).toBe('下载')
      controls.status.value = 'paused'
      expect(controls.selection.selectedCount.value).toBe(1)
      expect(controls.actionLabel.value).toBe('继续下载')
      controls.status.value = 'failed'
      controls.selection.toggleAllVisible()
      expect(controls.actionLabel.value).toBe('重新下载')
      controls.status.value = 'all'
      controls.selection.clearSelection()
      controls.selection.toggleItem('active')
      controls.selection.toggleItem('saved')
      expect(controls.resumableIds.value).toEqual(['saved'])
      expect(controls.counts.value).toEqual({
        all: 4,
        downloading: 1,
        paused: 1,
        failed: 1,
        succeeded: 1,
      })
    } finally {
      scope.stop()
    }
  })

  it('keeps saved songs successful during partial retry and rejects generated but unsaved output', () => {
    expect(getDownloadListState(item('generated', 'succeeded'), batch)).toBe('downloading')
    expect(
      getDownloadListState(item('generated', 'succeeded'), { ...batch, status: 'cancelled' }),
    ).toBe('failed')
    expect(getDownloadListState({ ...item('saved', 'succeeded'), savedAtMs: 2 }, batch)).toBe(
      'succeeded',
    )
  })

  it('applies filter drafts only after confirmation and prunes hidden selections', () => {
    const scope = effectScope()
    const open = shallowRef(false)
    const controls = scope.run(() =>
      useDownloadListControls({ batches: [batch], filterOpen: open, platformNames: new Map() }),
    )!
    try {
      controls.selection.toggleAllVisible()
      controls.draft.draft.value = {
        ...controls.filters.value,
        searchFilters: [{ query: 'paused' }],
      }
      expect(controls.visibleEntries.value).toHaveLength(4)
      controls.draft.applyDraft()
      expect(controls.visibleEntries.value.map((entry) => entry.item.id)).toEqual(['paused'])
      expect(controls.selection.selectedCount.value).toBe(1)
    } finally {
      scope.stop()
    }
  })
})
