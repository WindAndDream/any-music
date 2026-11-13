import type { LibraryTrackRecord, PlaybackHistoryEntry } from '@any-music/core'
import { provideConfirmationDialog, provideTrackNames } from '@any-music/ui/library'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowReactive, shallowRef } from 'vue'

import HistoryOperatorPanel from '../../../src/components/library/HistoryOperatorPanel.vue'
import HistoryPanel from '../../../src/components/library/HistoryPanel.vue'
import {
  dispatchCatalogEvent,
  findCatalogElement,
  mountCatalogComponent,
} from '../../helpers/test-renderer'

const records: LibraryTrackRecord[] = ['one', 'two'].map((id) => ({
  track: {
    id,
    title: `歌曲 ${id}`,
    artists: [],
    source: { pluginId: id, resourceId: id, mediaKind: 'audio' },
  },
  customTags: [],
  addedAtMs: 1,
  updatedAtMs: 1,
}))
const history: PlaybackHistoryEntry[] = [
  {
    id: 'old',
    trackId: 'one',
    startedAtMs: 10,
    updatedAtMs: 10,
    positionMs: 500,
    durationMs: 1000,
    completed: false,
  },
  {
    id: 'new',
    trackId: 'two',
    startedAtMs: 30,
    updatedAtMs: 30,
    positionMs: 1000,
    durationMs: 1000,
    completed: true,
  },
  {
    id: 'missing',
    trackId: 'missing',
    startedAtMs: 40,
    updatedAtMs: 40,
    positionMs: 0,
    completed: false,
  },
]

describe('classic playback history', () => {
  it('filters by custom name, platform and absolute start while preserving entry order', async () => {
    const onQueue = vi.fn()
    const props = shallowReactive({
      history,
      records,
      platformNames: new Map(),
      query: '',
      platformId: 'all',
      startedAfterMs: null as number | null,
      onQueue,
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup() {
          provideTrackNames(new Map([['two', '别名']]))
          return () => h(HistoryPanel, { ...props })
        },
      }),
      {},
    )
    expect(view.root.textContent.indexOf('歌曲 one')).toBeLessThan(
      view.root.textContent.indexOf('别名'),
    )
    expect(view.root.textContent).toContain('50%')
    props.query = '别名'
    await nextTick()
    expect(view.root.textContent).not.toContain('歌曲 one')
    const button = findCatalogElement(
      view.root,
      (node) => node.tag === 'button' && node.textContent.trim() === '待听',
    )
    dispatchCatalogEvent(button, 'onClick', false)
    expect(onQueue).toHaveBeenCalledExactlyOnceWith(records[1]!.track)
    props.query = ''
    props.platformId = 'one'
    await nextTick()
    expect(view.root.textContent).toContain('歌曲 one')
    expect(view.root.textContent).not.toContain('别名')
    props.platformId = 'all'
    props.startedAfterMs = 31
    await nextTick()
    expect(view.root.textContent).toContain('没有符合当前筛选条件的记录')
    expect(onQueue).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it.each(['cancel', 'accept', 'replace'] as const)(
    'binds history removal to explicit %s and its originating view',
    async (outcome) => {
      const visible = shallowRef(true)
      const onClearHistory = vi.fn()
      let confirmation!: ReturnType<typeof provideConfirmationDialog>
      const view = mountCatalogComponent(
        defineComponent({
          setup() {
            confirmation = provideConfirmationDialog()
            return () =>
              visible.value
                ? h(HistoryOperatorPanel, {
                    platforms: [],
                    resultCount: 2,
                    totalCount: 3,
                    query: '',
                    platformId: 'all',
                    timeRange: 'all',
                    onClearHistory,
                  })
                : null
          },
        }),
        {},
      )
      dispatchCatalogEvent(
        findCatalogElement(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '清空全部历史',
        ),
        'onClick',
        false,
      )
      expect(onClearHistory).not.toHaveBeenCalled()
      expect(confirmation.activeRequest.value?.title).toBe('清空播放历史')
      if (outcome === 'replace') {
        visible.value = false
        await nextTick()
      }
      if (outcome === 'cancel') confirmation.cancel()
      else confirmation.accept()
      await nextTick()
      expect(onClearHistory).toHaveBeenCalledTimes(outcome === 'accept' ? 1 : 0)
      view.unmount()
    },
  )
})
