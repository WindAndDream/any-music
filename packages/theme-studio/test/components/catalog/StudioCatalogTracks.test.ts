import { expect, it, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'

import StudioCatalogTracks from '../../../src/components/catalog/StudioCatalogTracks.vue'
import { mountMeasuredStudio } from '../../helpers/measured-collection-renderer'
import {
  createStudioTrackActions,
  createStudioTrackList,
} from '../../helpers/studio-track-fixtures'
import { findStudioNode, invokeStudio } from '../../helpers/test-renderer'

it.each([false, true])(
  'bounds mounted catalog results and preserves their actions (styled=%s)',
  async (styled) => {
    const state = createStudioTrackList(false)
    state.itemStyle = styled ? 'minimal' : 'default'
    state.tracks = Array.from({ length: 1000 }, (_, index) => ({
      ...state.tracks[0]!,
      id: `track-${index}`,
      title: `歌曲 ${index}`,
    }))
    const actions = { ...createStudioTrackActions(), toggleQueue: vi.fn(), loadMore: vi.fn() }
    const scrollElement = shallowRef<HTMLElement | null>(null)
    const view = mountMeasuredStudio(
      defineComponent({
        setup: () => () =>
          h(StudioCatalogTracks, {
            state,
            actions,
            drawer: {
              id: 'search',
              isLoading: false,
              loadedPageCount: 1,
              hasMore: true,
              paginationLocked: false,
            },
            loadedTrackCount: state.tracks.length,
            canLoadMore: true,
            scrollElement: scrollElement.value,
            virtualized: true,
          }),
      }),
      { styled },
    )
    try {
      scrollElement.value = view.scroll as unknown as HTMLElement
      const control = (index: number) =>
        findStudioNode(
          view.root,
          (node) => node.props['data-am-focus-key'] === `track:track-${index}:play`,
        )
      await vi.waitFor(() => expect(control(0)).toBeDefined())
      expect(() => control(999)).toThrow()
      const count = () => view.root.querySelectorAll(styled ? '[data-occurrence]' : 'tr').length
      expect(count()).toBeLessThan(24)
      if (!styled) {
        expect(view.root.querySelector('table')?.props['aria-rowcount']).toBe(1001)
        expect(view.root.querySelector('[aria-rowindex="2"]')?.tag).toBe('tr')
      }

      view.scroll.scrollTop = styled ? 30_000 : 30_400
      view.scroll.dispatchEvent(new Event('scroll'))
      const distant = () =>
        findStudioNode(view.root, (node) =>
          /^track:track-[3-4]\d{2}:play$/.test(String(node.props['data-am-focus-key'])),
        )
      await vi.waitFor(() => expect(distant()).toBeDefined())
      expect(() => control(0)).toThrow()
      expect(count()).toBeLessThan(24)
      const button = distant()
      const id = String(button.props['data-am-focus-key']).split(':')[1]
      invokeStudio(button, 'onClick', { stopPropagation() {} })
      if (styled) expect(actions.select).toHaveBeenCalledExactlyOnceWith([id])
      else
        expect(actions.play).toHaveBeenCalledExactlyOnceWith(
          id,
          state.tracks.map((track) => track.id),
        )
      expect(actions.loadMore).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  },
)
