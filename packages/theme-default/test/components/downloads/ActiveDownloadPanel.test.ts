import type { DownloadHistoryBatch, DownloadHistoryItem } from '@any-music/core'
import { provideConfirmationDialog } from '@any-music/ui/library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive, shallowRef } from 'vue'

import ActiveDownloadPanel from '../../../src/components/downloads/ActiveDownloadPanel.vue'
import {
  CatalogTestElement,
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  const passthrough = vue.defineComponent({
    inheritAttrs: false,
    setup:
      (_props, { slots }) =>
      () =>
        slots.default?.(),
  })
  return { ...vue, Transition: passthrough }
})
vi.mock('@any-music/ui/components/AppDialog.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open', 'title'],
      inheritAttrs: false,
      setup:
        (props, { slots }) =>
        () =>
          props.open ? vue.h('section', { 'aria-label': props.title }, slots.default?.()) : null,
    }),
  }
})
vi.mock('@any-music/ui/components/BottomSheet.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: ['open'],
      inheritAttrs: false,
      setup:
        (props, { slots }) =>
        () =>
          props.open ? slots.default?.() : null,
    }),
  }
})

beforeEach(() => vi.stubGlobal('Document', CatalogTestElement))
afterEach(() => vi.unstubAllGlobals())

function task(id: string, status: DownloadHistoryItem['status']): DownloadHistoryItem {
  return {
    id,
    status,
    requestedAtMs: 1,
    maxRetryCount: 3,
    attempts: [],
    savedAtMs: status === 'succeeded' ? 2 : undefined,
    track: {
      id: `song:${id}`,
      title: '同一首歌',
      artists: [],
      source: { pluginId: 'test', mediaKind: 'audio', resourceId: 'one' },
    },
  }
}

function mountPanel() {
  const items = [task('first', 'paused'), task('second', 'succeeded')]
  const batch: DownloadHistoryBatch = {
    id: 'batch',
    status: 'completed',
    startedAtMs: 1,
    concurrency: 2,
    origin: { kind: 'queue', label: '待听' },
    items,
  }
  const visible = shallowRef(true)
  const onResume = vi.fn()
  const onRemove = vi.fn()
  const overlay = new CatalogTestElement('overlays')
  const props = shallowReactive({
    batches: [batch],
    concurrency: 2,
    mobileLayout: false,
    platformNames: new Map(),
    statusMessage: '',
    errorMessage: '',
    cancelling: false,
    filterOpen: false,
    operatorOpen: false,
    panelsSuspended: false,
    overlayTarget: overlay as unknown as HTMLElement,
    operatorOverlayTarget: null,
    displayMode: 'standard' as const,
    mobileColumns: 1 as const,
    favoriteTrackIds: new Set<string>(),
    queuedTrackIds: new Set<string>(),
    invalidTrackIds: new Set<string>(),
    customTagsByTrackId: new Map(),
    onResume,
    onRemove,
  })
  let confirmation!: ReturnType<typeof provideConfirmationDialog>
  const view = mountCatalogComponent(
    defineComponent({
      setup() {
        confirmation = provideConfirmationDialog()
        return () => (visible.value ? h(ActiveDownloadPanel, { ...props }) : null)
      },
    }),
    {},
  )
  // The custom renderer also mounts real Teleports into this plain test element.
  view.root.children.push(overlay)
  const button = (text: string) =>
    findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent.trim() === text,
    )
  return { ...view, visible, props, items, batch, onResume, onRemove, confirmation, button }
}

describe('download collection', () => {
  it('keeps saved tasks accessible in Downloads and opens song actions for that task', async () => {
    const view = mountPanel()
    try {
      expect(findCatalogElement(view.root, (node) => node.tag === 'h2').textContent).toBe('下载')
      expect(
        findCatalogElement(
          view.root,
          (node) => node.props['aria-label'] === '下载并发 2',
        ).textContent.trim(),
      ).toBe('2 并发')
      dispatchCatalogEvent(view.button('已下载 1'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(view.button('操作'), 'onClick', false)
      await nextTick()
      expect(view.root.textContent).toContain('移除下载记录')
      expect(
        findCatalogElement(view.root, (node) => node.props['aria-label'] === '歌曲操作'),
      ).toBeDefined()
      expect(Boolean(view.button('重新下载').props.disabled)).toBe(false)
      expect(view.root.textContent).not.toContain('完整歌曲快照')
      dispatchCatalogEvent(view.button('移除下载记录'), 'onClick', false)
      expect(view.confirmation.activeRequest.value?.message).toContain('已保存的文件会保留')
      expect(view.onRemove).not.toHaveBeenCalled()
      view.confirmation.accept()
      await nextTick()
      expect(view.onRemove).toHaveBeenCalledExactlyOnceWith(['second'])
    } finally {
      view.unmount()
    }
  })

  it('uses the latest task state while its song actions remain open', async () => {
    const view = mountPanel()
    try {
      dispatchCatalogEvent(view.button('已暂停 1'), 'onClick', false)
      await nextTick()
      dispatchCatalogEvent(view.button('操作'), 'onClick', false)
      await nextTick()
      const completed = { ...view.items[0]!, status: 'succeeded' as const, savedAtMs: 3 }
      view.props.batches = [{ ...view.batch, items: [completed, view.items[1]!] }]
      await nextTick()
      expect(Boolean(view.button('重新下载').props.disabled)).toBe(false)
      expect(() => view.button('继续下载')).toThrow()
      expect(view.onResume).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
  it('shows saved and failed snapshots without sources when native saving is unavailable', async () => {
    const view = mountPanel()
    try {
      view.props.errorMessage = '当前运行端不支持原生保存。'
      view.props.batches = [
        {
          ...view.batch,
          status: 'completed',
          items: [{ ...view.items[0]!, status: 'failed' }, view.items[1]!],
        },
      ]
      await nextTick()
      expect(view.root.textContent).toContain('当前运行端不支持原生保存。')
      expect(view.root.textContent).toContain('下载失败 1')
      expect(view.root.textContent).toContain('已下载 1')
      expect(view.onResume).not.toHaveBeenCalled()
      expect(view.onRemove).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('rejects a download removal confirmed after the initiating view unmounts', async () => {
    const view = mountPanel()
    dispatchCatalogEvent(view.button('已下载 1'), 'onClick', false)
    await nextTick()
    dispatchCatalogEvent(view.button('操作'), 'onClick', false)
    await nextTick()
    dispatchCatalogEvent(view.button('移除下载记录'), 'onClick', false)
    expect(view.confirmation.activeRequest.value).toBeDefined()
    view.visible.value = false
    await nextTick()
    view.confirmation.accept()
    await nextTick()
    expect(view.onRemove).not.toHaveBeenCalled()
    view.unmount()
  })
})
