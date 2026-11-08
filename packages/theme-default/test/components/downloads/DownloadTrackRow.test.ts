import type { DownloadHistoryBatch, DownloadHistoryItem } from '@any-music/core'
import { getDownloadListState } from '@any-music/ui/library'
import { describe, expect, it, vi } from 'vitest'

import DownloadTrackRow from '../../../src/components/downloads/DownloadTrackRow.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const task: DownloadHistoryItem = {
  id: 'task',
  status: 'downloading',
  requestedAtMs: 1,
  maxRetryCount: 3,
  attempts: [],
  track: {
    id: 'track',
    title: '歌曲',
    artists: [],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: '1' },
  },
}
const batch: DownloadHistoryBatch = {
  id: 'batch',
  status: 'completed',
  startedAtMs: 1,
  concurrency: 2,
  origin: { kind: 'queue', label: '待听' },
  items: [task],
}

describe('download song actions', () => {
  it.each([false, true])(
    'keeps download reordering independent of selection mode (%s)',
    (selectable) => {
      const onDragStart = vi.fn(),
        onShift = vi.fn(),
        onSelect = vi.fn(),
        onDragCancel = vi.fn()
      const view = mountCatalogComponent(DownloadTrackRow, {
        entry: { item: task, batch, state: 'downloading', saving: false },
        contextLabel: '来源',
        displayMode: 'standard',
        active: false,
        invalid: false,
        favorite: false,
        selected: false,
        reorderable: true,
        selectable,
        onDragStart,
        onShift,
        onSelect,
        onDragCancel,
      })
      try {
        const handle = findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.props['data-queue-handle'] !== undefined,
        )
        dispatchCatalogEvent(handle, 'onPointerdown')
        expect(onDragStart.mock.lastCall?.[1]).toBe(task.id)
        dispatchCatalogEvent(handle, 'onClick')
        if (selectable) expect(onSelect).toHaveBeenCalledExactlyOnceWith(task.id)
        else expect(onSelect).not.toHaveBeenCalled()
        if (!selectable)
          expect(() => findCatalogElement(view.root, (node) => node.tag === 'input')).toThrow()
        const dispatchKey = (key: string) => {
          const handlers = handle.props.onKeydown
          for (const handler of (Array.isArray(handlers) ? handlers : [handlers]) as ((
            event: unknown,
          ) => void)[])
            handler({ key, preventDefault() {}, stopPropagation() {} })
        }
        dispatchKey('ArrowDown')
        expect(onShift).toHaveBeenCalledExactlyOnceWith(task.id, 1)
        dispatchKey('Escape')
        expect(onDragCancel).toHaveBeenCalledOnce()
      } finally {
        view.unmount()
      }
    },
  )

  it.each([
    ['downloading', '下载中', false, 'pause'],
    ['queued', '排队中', false, 'pause'],
    ['paused', '继续下载', false, 'resume'],
    ['failed', '重新下载', false, 'resume'],
    ['succeeded', '重新下载', false, 'resume'],
  ] as const)('renders %s tasks through the music row', (status, label, disabled, action) => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const onShowActions = vi.fn()
    const item = { ...task, status }
    const view = mountCatalogComponent(DownloadTrackRow, {
      entry: { item, batch, state: getDownloadListState(item, batch), saving: false },
      contextLabel: '来源',
      displayMode: 'standard',
      active: false,
      invalid: false,
      favorite: false,
      selected: false,
      onPause,
      onResume,
      onShowActions,
    })
    try {
      const button = findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent === label,
      )
      expect(Boolean(button.props.disabled)).toBe(disabled)
      const actions = findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent === '操作',
      )
      dispatchCatalogEvent(actions, 'onClick', false)
      expect(onShowActions).toHaveBeenCalledWith(task.id)
      const row = findCatalogElement(view.root, (node) =>
        String(node.props.class).split(' ').includes('download-track'),
      )
      expect(row.children.filter((node) => node.tag === 'p')).toHaveLength(0)
      if (action) {
        dispatchCatalogEvent(button, 'onClick', false)
        expect(action === 'pause' ? onPause : onResume).toHaveBeenCalledWith(task.id)
      }
    } finally {
      view.unmount()
    }
  })
})
