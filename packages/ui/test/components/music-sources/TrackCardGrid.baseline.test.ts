import { writeFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onScopeDispose, shallowRef } from 'vue'

import TrackCardGrid from '../../../src/components/music-sources/TrackCardGrid.vue'
import TrackCardSummary from '../../../src/components/tracks/TrackCardSummary.vue'
import {
  createVirtualCollectionFixture,
  resizeFixtureContent,
  virtualCollectionSizes,
} from '../../fixtures/virtual-scroll/collection-data'
import {
  findCatalogElement,
  mountCatalogComponent,
  type CatalogTestElement,
} from './catalog-test-renderer'

interface StructureSample {
  count: number
  slotScopes: number
  hostElements: number
  releasedScopes: number
}
const samples: StructureSample[] = []

function countHostElements(node: CatalogTestElement): number {
  return (
    (node.tag.startsWith('#') || node.tag === 'root' ? 0 : 1) +
    node.children.reduce((sum, child) => sum + countHostElements(child), 0)
  )
}

describe('pre-virtualization grid structure (Node renderer, no layout timing)', () => {
  it.each(virtualCollectionSizes)(
    'records the current full slot allocation for %i logical items',
    (count) => {
      const { records } = createVirtualCollectionFixture(count)
      const mount = vi.fn(),
        release = vi.fn()
      const card = defineComponent({
        props: ['index'],
        setup(props) {
          mount()
          onScopeDispose(release)
          return () =>
            h(
              'article',
              { 'data-occurrence': props.index },
              h(TrackCardSummary, {
                track: records[props.index]!.track,
                detailLines: records[props.index]!.customTags,
              }),
            )
        },
      })
      const view = mountCatalogComponent(
        defineComponent({
          setup: () => () =>
            h(
              TrackCardGrid,
              {
                displayMode: 'standard',
                mobileColumns: 1,
                itemKeys: records.map(({ track }) => track.id),
              },
              {
                default: () =>
                  records.map((record, index) => h(card, { key: record.track.id, index })),
              },
            ),
        }),
        {},
      )
      const sample = {
        count,
        slotScopes: mount.mock.calls.length,
        hostElements: countHostElements(view.root),
        releasedScopes: 0,
      }
      try {
        // This is a baseline of the existing slot contract, not an acceptance bound for P07/P09.
        expect(sample.slotScopes).toBe(count)
        expect(sample.hostElements).toBeGreaterThanOrEqual(count)
      } finally {
        view.unmount()
      }
      sample.releasedScopes = release.mock.calls.length
      expect(sample.releasedScopes).toBe(count)
      samples.push(sample)
      if (
        samples.length === virtualCollectionSizes.length &&
        process.env.AM_VIRTUAL_BASELINE_OUTPUT
      ) {
        writeFileSync(
          process.env.AM_VIRTUAL_BASELINE_OUTPUT,
          `${JSON.stringify({ method: 'Vue Node custom renderer; TrackCardGrid with TrackCardSummary slots; standard density, one mobile column; no browser, CSS layout, image decode or timing', samples }, null, 2)}\n`,
        )
      }
    },
    30_000,
  )

  it('keeps duplicate-song occurrences and resource scopes distinct through edits and reorder', async () => {
    const { occurrences } = createVirtualCollectionFixture(80)
    const items = shallowRef(occurrences)
    const mount = vi.fn(),
      release = vi.fn()
    const card = defineComponent({
      props: ['item'],
      setup(props) {
        mount()
        onScopeDispose(release)
        return () =>
          h('article', { 'data-occurrence': props.item.occurrenceKey }, props.item.track.title)
      },
    })
    const view = mountCatalogComponent(
      defineComponent({
        setup: () => () =>
          h(
            TrackCardGrid,
            {
              displayMode: 'standard',
              mobileColumns: 1,
              itemKeys: items.value.map((item) => item.occurrenceKey),
            },
            {
              default: () => items.value.map((item) => h(card, { key: item.occurrenceKey, item })),
            },
          ),
      }),
      {},
    )
    try {
      const firstKey = occurrences[0]!.occurrenceKey
      const first = findCatalogElement(
        view.root,
        (node) => node.props['data-occurrence'] === firstKey,
      )
      const expanded = resizeFixtureContent(createVirtualCollectionFixture(1).records[0]!, true)
      const reordered = occurrences.toReversed()
      const changedIndex = reordered.findIndex((item) => item.occurrenceKey === firstKey)
      reordered[changedIndex] = { ...reordered[changedIndex]!, track: expanded.track }
      items.value = reordered
      await nextTick()
      expect(
        findCatalogElement(view.root, (node) => node.props['data-occurrence'] === firstKey),
      ).toBe(first)
      expect(first.textContent).toBe(expanded.track.title)
      expect(mount).toHaveBeenCalledTimes(80)
      expect(release).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
    expect(release).toHaveBeenCalledTimes(80)
  })
})
