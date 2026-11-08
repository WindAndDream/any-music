import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onScopeDispose, shallowRef } from 'vue'

import type { CatalogTrackDisplayMode } from '../../../src/components/music-sources/catalog-track-display-mode'
import TrackCardGrid from '../../../src/components/music-sources/TrackCardGrid.vue'
import { findCatalogElement, mountCatalogComponent } from './catalog-test-renderer'

describe('TrackCardGrid display changes', () => {
  it('reuses card nodes and their resource scopes across density, columns and motion changes', async () => {
    const displayMode = shallowRef<CatalogTrackDisplayMode>('standard')
    const mobileColumns = shallowRef<1 | 2>(1)
    const animate = shallowRef(true)
    const keys = Array.from({ length: 30 }, (_, index) => String(index))
    const mount = vi.fn(),
      release = vi.fn()
    const card = defineComponent({
      props: ['id'],
      setup(props) {
        mount()
        onScopeDispose(release)
        return () => h('article', { 'data-track-id': props.id })
      },
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(
            TrackCardGrid,
            {
              displayMode: displayMode.value,
              mobileColumns: mobileColumns.value,
              animate: animate.value,
              itemKeys: keys,
            },
            { default: () => keys.map((id) => h(card, { key: id, id })) },
          ),
      }),
      {},
    )
    try {
      const first = findCatalogElement(view.root, (node) => node.props['data-track-id'] === '0')
      for (const mode of ['compact', 'comfortable', 'standard'] as const) {
        displayMode.value = mode
        mobileColumns.value = 2
        animate.value = !animate.value
        // eslint-disable-next-line no-await-in-loop -- Verify each committed display change preserves the existing nodes.
        await nextTick()
        expect(findCatalogElement(view.root, (node) => node.props['data-track-id'] === '0')).toBe(
          first,
        )
        expect(
          findCatalogElement(view.root, (node) => node.props['data-display-mode'] === mode).props[
            'data-mobile-columns'
          ],
        ).toBe(2)
      }
      expect(mount).toHaveBeenCalledTimes(30)
      expect(release).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
    expect(release).toHaveBeenCalledTimes(30)
  })
})
