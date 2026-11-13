import type { Track } from '@any-music/core'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, shallowRef, type CSSProperties } from 'vue'

import QueueTrackGrid from '../../../src/components/music-sources/QueueTrackGrid.vue'
import { findCatalogElement, mountCatalogComponent } from '../../helpers/test-renderer'

const renderGrid = vi.hoisted(() => vi.fn())
vi.mock('@any-music/ui/components/music-sources/TrackCardGrid.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup:
        (_, { slots }) =>
        () => {
          renderGrid()
          return h('div', slots.default?.())
        },
    }),
  }
})
vi.mock('../../../src/components/music-sources/TrackRow.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: ['track'],
      setup: (props) => () => h('article', { 'data-track-id': props.track.id }),
    }),
  }
})

describe('QueueTrackGrid drag rendering', () => {
  it('updates only the moving card without rendering or measuring the whole grid again', async () => {
    const tracks: Track[] = Array.from({ length: 200 }, (_, index) => ({
      id: String(index),
      title: `歌曲 ${index}`,
      artists: [],
      source: { pluginId: 'test', mediaKind: 'audio', resourceId: String(index) },
    }))
    const movingStyle = shallowRef<CSSProperties>({ transform: 'translate3d(0px, 10px, 0)' })
    const shiftedStyles = shallowRef(new Map<string, CSSProperties>())
    const getReorderStyle = vi.fn((id: string) =>
      id === '0' ? movingStyle.value : shiftedStyles.value.get(id),
    )
    const view = mountCatalogComponent(QueueTrackGrid, {
      tracks,
      positions: new Map(),
      selectedIds: new Set(),
      platformNames: new Map(),
      addedAtMsByTrackId: new Map(),
      draggedId: '0',
      getReorderStyle,
      favoriteTrackIds: new Set(),
      invalidTrackIds: new Set(),
      downloadBusy: false,
      displayMode: 'standard',
      mobileColumns: 1,
    })
    try {
      expect(getReorderStyle).toHaveBeenCalledTimes(tracks.length)
      getReorderStyle.mockClear()
      renderGrid.mockClear()
      for (let frame = 1; frame <= 3; frame += 1) {
        const style = { transform: `translate3d(0px, ${frame * 20}px, 0)` }
        movingStyle.value = style
        // eslint-disable-next-line no-await-in-loop -- 每帧先完成渲染，才能检查下一次输入是否重渲染整个网格。
        await nextTick()
        expect(getReorderStyle).toHaveBeenCalledExactlyOnceWith('0')
        expect(renderGrid).not.toHaveBeenCalled()
        const card = findCatalogElement(view.root, (node) => node.props['data-track-id'] === '0')
        expect(card.parent?.props.style).toEqual(style)
        getReorderStyle.mockClear()
      }
      // 邻项让位仍能独立更新，不能以跳过正常样式订阅换取拖动性能。
      shiftedStyles.value = new Map([['1', { transform: 'translate3d(0px, -100px, 0)' }]])
      await nextTick()
      const shifted = findCatalogElement(view.root, (node) => node.props['data-track-id'] === '1')
      expect(shifted.parent?.props.style).toEqual({ transform: 'translate3d(0px, -100px, 0)' })
      expect(renderGrid).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })
})
