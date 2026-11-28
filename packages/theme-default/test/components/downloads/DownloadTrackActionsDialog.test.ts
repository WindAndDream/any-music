import {
  createAppErrorState,
  type DownloadHistoryBatch,
  type DownloadHistoryItem,
} from '@any-music/core'
import { getDownloadListState } from '@any-music/ui/library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import DownloadTrackActionsDialog from '../../../src/components/downloads/DownloadTrackActionsDialog.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    Transition: vue.defineComponent({
      inheritAttrs: false,
      setup:
        (_props, { slots }) =>
        () =>
          slots.default?.(),
    }),
  }
})
beforeEach(() => vi.stubGlobal('Document', CatalogTestElement))
afterEach(() => vi.unstubAllGlobals())

const item: DownloadHistoryItem = {
  id: 'download-task',
  status: 'paused',
  requestedAtMs: 1,
  maxRetryCount: 3,
  attempts: [],
  track: {
    id: 'song',
    title: '歌曲',
    artists: [],
    source: { pluginId: 'test', mediaKind: 'audio', resourceId: 'one' },
  },
}
const batch: DownloadHistoryBatch = {
  id: 'batch',
  status: 'completed',
  startedAtMs: 1,
  concurrency: 2,
  origin: { kind: 'queue', label: '待听' },
  items: [item],
}

describe('download task song actions', () => {
  it('omits the repeated header name and status, and opens the full name next to retry actions', async () => {
    const name = '一首在下载记录里需要查看完整名称的歌'.repeat(12)
    const view = mountCatalogComponent(DownloadTrackActionsDialog, {
      entry: {
        item: {
          ...item,
          track: { ...item.track, title: name },
          status: 'failed',
          error: createAppErrorState(
            'access-denied',
            '该歌曲不可完整播放，请检查版权、会员或购买权限。',
          ),
        },
        batch,
        state: 'failed',
        saving: false,
      },
      customTags: [],
      favorite: false,
      queued: false,
      invalid: false,
      cancelling: false,
      suspended: false,
    })
    try {
      const dialog = findCatalogElement(view.root, (node) => node.props.role === 'dialog')
      const header = findCatalogElement(dialog, (node) => node.tag === 'header')
      expect(findCatalogElement(header, (node) => node.tag === 'h2').textContent).toBe('歌曲操作')
      expect(header.textContent).not.toContain(name)
      expect(dialog.props['aria-describedby']).toBeUndefined()
      expect(view.root.querySelector('[role="status"]')).toBeNull()
      expect(view.root.textContent).not.toContain('AM-2002')
      expect(view.root.textContent).toContain('重新下载')
      const title = dialog.querySelector('[aria-haspopup="dialog"]')!
      expect(title.textContent).toBe(name)
      dispatchCatalogEvent(title, 'onClick')
      await nextTick()
      const [, preview] = view.root.querySelectorAll('[role="dialog"]')
      expect(findCatalogElement(preview!, (node) => node.tag === 'p').textContent).toBe(name)
    } finally {
      view.unmount()
    }
  })

  it.each([
    ['downloading', false, '下载中', 'pause'],
    ['queued', false, '排队中', 'pause'],
    ['paused', false, '继续下载', 'resume'],
    ['failed', false, '重新下载', 'resume'],
    ['succeeded', false, '重新下载', 'resume'],
    ['succeeded', true, '保存中', undefined],
  ] as const)('exposes the current %s action (saving=%s)', (status, saving, label, event) => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    const onClose = vi.fn()
    const task = { ...item, status }
    const view = mountCatalogComponent(DownloadTrackActionsDialog, {
      entry: { item: task, batch, state: getDownloadListState(task, batch), saving },
      customTags: [],
      favorite: false,
      queued: false,
      invalid: false,
      cancelling: false,
      suspended: false,
      onPause,
      onResume,
      onClose,
    })
    try {
      const control = findCatalogElement(
        view.root,
        (node) => node.tag === 'button' && node.textContent === label,
      )
      expect(Boolean(control.props.disabled)).toBe(!event)
      // A direct event must also respect the saving/saved guard, beyond native disabled behavior.
      dispatchCatalogEvent(control, 'onClick', false)
      if (event) {
        expect(event === 'pause' ? onPause : onResume).toHaveBeenCalledExactlyOnceWith(item.id)
        expect(onClose).toHaveBeenCalledOnce()
      } else {
        expect(onPause).not.toHaveBeenCalled()
        expect(onResume).not.toHaveBeenCalled()
        expect(onClose).not.toHaveBeenCalled()
      }
      expect(() =>
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent === '下载',
        ),
      ).toThrow()
    } finally {
      view.unmount()
    }
  })

  it('retains song actions and removes a task by its task identity', () => {
    const onQueue = vi.fn()
    const onRemove = vi.fn()
    const onCancel = vi.fn()
    const view = mountCatalogComponent(DownloadTrackActionsDialog, {
      entry: { item, batch, state: 'paused', saving: false },
      customTags: [],
      favorite: false,
      queued: false,
      invalid: false,
      cancelling: false,
      suspended: false,
      onQueue,
      onRemove,
      onCancel,
    })
    try {
      const button = (label: string) =>
        findCatalogElement(view.root, (node) => node.tag === 'button' && node.textContent === label)
      dispatchCatalogEvent(button('待听'), 'onClick', false)
      expect(onQueue).toHaveBeenCalledWith(item.track)
      expect(view.root.textContent).toContain('自定义名称')
      dispatchCatalogEvent(button('取消下载'), 'onClick', false)
      expect(onCancel).toHaveBeenCalledExactlyOnceWith(item.id)
      dispatchCatalogEvent(button('移除下载记录'), 'onClick', false)
      expect(onRemove).toHaveBeenCalledWith(item.id)
    } finally {
      view.unmount()
    }
  })

  it.each([
    { suspended: true, cancelling: false, invalid: false },
    { suspended: false, cancelling: true, invalid: false },
    { suspended: false, cancelling: false, invalid: true },
  ])('blocks resume when unavailable: %j', (guards) => {
    const onResume = vi.fn()
    const view = mountCatalogComponent(DownloadTrackActionsDialog, {
      entry: { item, batch, state: 'paused', saving: false },
      customTags: [],
      favorite: false,
      queued: false,
      onResume,
      ...guards,
    })
    try {
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent === '继续下载',
        ),
        'onClick',
        false,
      )
      expect(onResume).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
})
