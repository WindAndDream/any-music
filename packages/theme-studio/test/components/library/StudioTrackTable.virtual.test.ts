import { provideConfirmationDialog } from '@any-music/ui/library'
import { getPresentationContinuity } from '@any-music/ui/theme'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, shallowRef } from 'vue'

import StudioCollection from '../../../src/components/library/StudioCollection.vue'
import StudioFavorites from '../../../src/components/library/StudioFavorites.vue'
import StudioTrackTable from '../../../src/components/library/StudioTrackTable.vue'
import { studioVirtualFavoritesCanaryKey } from '../../../src/composables/studio-virtual-favorites-canary'
import { provideStudioOverlays } from '../../../src/composables/use-studio-overlays'
import { MeasuredStudioNode, mountMeasuredStudio } from '../../helpers/measured-collection-renderer'
import {
  createStudioTrackActions,
  createStudioTrackList,
  createStudioFavoritesFeature,
} from '../../helpers/studio-track-fixtures'
import { findStudioNode, invokeStudio } from '../../helpers/test-renderer'

async function settle() {
  // Explicitly await the lazy SFC, then let measured rows and interaction registrations publish.
  await import('../../../src/components/library/StudioVirtualTrackLayout.vue')
  for (let tick = 0; tick < 10; tick++) {
    // eslint-disable-next-line no-await-in-loop -- Ordered measured mount/registration flushes.
    await nextTick()
  }
}
function setup(count: number, styled: boolean, collection = false) {
  vi.stubGlobal('HTMLElement', MeasuredStudioNode)
  const initial = createStudioTrackList(false)
  initial.tracks = Array.from({ length: count }, (_, index) => ({
    ...initial.tracks[0]!,
    id: `track-${index}`,
    title: `歌曲 ${index}`,
  }))
  initial.itemStyle = styled ? 'minimal' : 'default'
  const state = shallowRef(initial)
  const actions = createStudioTrackActions()
  const actionId = shallowRef<string | null>(null)
  const active = shallowRef(true)
  const columns = shallowRef(2)
  const view = mountMeasuredStudio(
    defineComponent({
      setup() {
        provideConfirmationDialog()
        provideStudioOverlays(() => actionId.value)
        return () =>
          active.value
            ? collection
              ? h(StudioCollection, {
                  title: '我的喜欢',
                  scope: 'favorites:tracks',
                  state: state.value,
                  actions,
                  availability: { status: 'available' },
                  status: { status: 'ready' },
                  virtualized: true,
                })
              : h(StudioTrackTable, {
                  state: state.value,
                  actions,
                  continuityRegion: 'favorites:tracks',
                  virtualized: true,
                })
            : null
      },
    }),
    { styled, columns: () => columns.value },
  )
  return { ...view, state, actions, actionId, active, columns }
}
function mounted(root: MeasuredStudioNode) {
  return root.querySelectorAll('[data-am-continuity-item]')
}
afterEach(() => vi.unstubAllGlobals())

describe.each([false, true])(
  'Studio C03 candidate styled=%s (injected Node geometry)',
  (styled) => {
    it.each([0, 1, 80, 1000, 10000])(
      'does not retain visited row/card DOM after traversing %i results in both directions',
      async (count) => {
        const view = setup(count, styled)
        try {
          await settle()
          const initial = mounted(view.root).map((node) => node.props['data-am-continuity-item'])
          const visited = new Set<MeasuredStudioNode>()
          const connected = (node: MeasuredStudioNode) => {
            for (
              let parent: MeasuredStudioNode | null = node;
              parent;
              parent = parent.parentElement
            )
              if (parent === view.root) return true
            return false
          }
          const extent = styled ? Math.ceil(count / 2) * 156 : count * 76
          const end = Math.max(0, 24 + extent - view.scroll.clientHeight)
          for (const fraction of [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]) {
            view.scroll.scrollTop = end * fraction
            view.scroll.dispatchEvent(new Event('scroll'))
            // eslint-disable-next-line no-await-in-loop -- Count connected nodes at every committed window.
            await settle()
            const current = mounted(view.root)
            for (const node of current) visited.add(node)
            expect(current.length).toBeLessThanOrEqual(24)
            expect([...visited].filter(connected)).toHaveLength(current.length)
          }
          expect(mounted(view.root).map((node) => node.props['data-am-continuity-item'])).toEqual(
            initial,
          )
          if (count >= 80) expect(visited.size).toBeGreaterThan(initial.length)
          expect(view.state.value.tracks).toHaveLength(count)
          expect(view.actions.play).not.toHaveBeenCalled()
          expect(view.actions.select).not.toHaveBeenCalled()
        } finally {
          view.unmount()
        }
      },
    )

    it('waits for the lazy candidate when restoring before its first measured render', async () => {
      const view = setup(1000, styled)
      try {
        await nextTick()
        const element = view.root.querySelector('[data-am-continuity-key="favorites:tracks"]')!
        const adapter = getPresentationContinuity(element as unknown as Element)!
        const pending = adapter.restore(
          { focus: { itemKey: 'track-900', controlKey: 'track:track-900:play' } },
          new AbortController().signal,
        )
        await settle()
        expect(await pending).toBe(true)
        expect(
          (view.document.activeElement as unknown as MeasuredStudioNode).dataset.amFocusKey,
        ).toBe('track:track-900:play')
        expect(view.actions.play).not.toHaveBeenCalled()
      } finally {
        view.unmount()
      }
    })
    it('admits only Favorites through its private key and removes all selected favorites beyond the mounted window', async () => {
      vi.stubGlobal('HTMLElement', MeasuredStudioNode)
      const original = createStudioFavoritesFeature(1000, styled)
      const ids = original.state.tracks.map(({ id }) => id)
      const feature = {
        ...original,
        state: { ...original.state, selectedTrackIds: ids, favoriteTrackIds: ids },
      }
      let confirmation!: ReturnType<typeof provideConfirmationDialog>
      const view = mountMeasuredStudio(
        defineComponent({
          setup() {
            confirmation = provideConfirmationDialog()
            provide(studioVirtualFavoritesCanaryKey, true)
            return () => h(StudioFavorites, { feature })
          },
        }),
        { styled },
      )
      try {
        await settle()
        expect(mounted(view.root).length).toBeLessThan(24)
        expect(view.root.textContent).not.toContain('歌曲 999')
        const remove = findStudioNode(
          view.root,
          (node) => node.tag === 'button' && node.textContent.trim() === '移除已选',
        )
        invokeStudio(remove, 'onClick')
        confirmation.accept()
        await settle()
        expect(feature.actions.toggleFavorite).toHaveBeenCalledTimes(1000)
        expect(feature.actions.toggleFavorite).toHaveBeenLastCalledWith('track-999')
      } finally {
        view.unmount()
      }
    })
    it.each([0, 1, 80, 1000, 10000])(
      'bounds real row/card mounting for %i full results',
      async (count) => {
        const view = setup(count, styled)
        try {
          await settle()
          expect(mounted(view.root).length).toBeLessThanOrEqual(24)
          expect(mounted(view.root).length > 0).toBe(count > 0)
          if (!styled) {
            const table = findStudioNode(view.root, (node) => node.tag === 'table')
            expect(table.props['aria-rowcount']).toBe(count + 1)
            expect(findStudioNode(table, (node) => node.tag === 'caption').textContent).toContain(
              String(count),
            )
            expect(
              view.root
                .querySelectorAll('[data-am-continuity-item]')
                .every((node) => node.tag === 'tr'),
            ).toBe(true)
          }
          expect(view.actions.play).not.toHaveBeenCalled()
          expect(view.actions.select).not.toHaveBeenCalled()
        } finally {
          view.unmount()
        }
        expect(
          view.observers.every((observer) => observer.disconnect.mock.calls.length === 1),
        ).toBe(true)
      },
    )

    it('plays/selects the complete owner-filtered collection, including offscreen matches and cleared results', async () => {
      const view = setup(1000, styled, true)
      try {
        await settle()
        const all = findStudioNode(
          view.root,
          (node) => node.tag === 'input' && node.props['aria-label'] === undefined,
        )
        invokeStudio(all, 'onChange')
        const ids = view.state.value.tracks.map(({ id }) => id)
        expect(view.actions.select).toHaveBeenLastCalledWith(ids)
        const firstPlay = view.root.querySelector('[data-am-focus-key="track:track-0:play"]')!
        invokeStudio(firstPlay, 'onClick')
        if (styled) expect(view.actions.select).toHaveBeenLastCalledWith(['track-0'])
        else expect(view.actions.play).toHaveBeenLastCalledWith('track-0', ids)
        const matches = view.state.value.tracks.filter((_, index) => index >= 990)
        view.state.value = { ...view.state.value, tracks: matches }
        await settle()
        invokeStudio(
          view.root.querySelector('[data-am-focus-key="track:track-990:play"]')!,
          'onClick',
        )
        if (styled) expect(view.actions.select).toHaveBeenLastCalledWith(['track-990'])
        else
          expect(view.actions.play).toHaveBeenLastCalledWith(
            'track-990',
            matches.map(({ id }) => id),
          )
        invokeStudio(all, 'onChange')
        expect(view.actions.select).toHaveBeenLastCalledWith(matches.map(({ id }) => id))
        view.state.value = { ...view.state.value, tracks: [] }
        await settle()
        expect(mounted(view.root)).toHaveLength(0)
        view.state.value = { ...view.state.value, tracks: matches }
        await settle()
        expect(mounted(view.root)[0]!.dataset.amContinuityItem).toBe('track-990')
      } finally {
        view.unmount()
      }
    })

    it('retains the action opener across distant scrolling and releases it when the root dialog closes', async () => {
      const view = setup(1000, styled)
      try {
        await settle()
        const opener = mounted(view.root)[0]!
        invokeStudio(
          opener.querySelector('[data-am-focus-key="track:track-0:actions"]')!,
          'onClick',
        )
        expect(view.actions.showTrackActions).toHaveBeenCalledExactlyOnceWith('track-0')
        view.actionId.value = 'track-0'
        await settle()
        view.scroll.scrollTop = 50_000
        view.scroll.dispatchEvent(new Event('scroll'))
        await settle()
        expect(mounted(view.root).some((node) => node === opener)).toBe(true)
        expect(mounted(view.root).length).toBeLessThan(30)
        view.actionId.value = null
        await settle()
        expect(mounted(view.root).some((node) => node === opener)).toBe(false)
      } finally {
        view.unmount()
      }
    })

    it('restores an offscreen semantic focus target before focusing and rejects a disposed surface', async () => {
      const view = setup(1000, styled)
      try {
        await settle()
        const surface = view.root.querySelector('[data-am-continuity-key="favorites:tracks"]')!
        const adapter = getPresentationContinuity(surface as unknown as Element)!
        expect(adapter).toBeDefined()
        expect(
          mounted(view.root).some((node) => node.dataset.amContinuityItem === 'track-900'),
        ).toBe(false)
        const pending = adapter.restore(
          { focus: { itemKey: 'track-900', controlKey: 'track:track-900:play' } },
          new AbortController().signal,
        )
        await settle()
        expect(await pending).toBe(true)
        expect(
          (view.document.activeElement as unknown as MeasuredStudioNode).dataset.amFocusKey,
        ).toBe('track:track-900:play')
        expect(
          mounted(view.root).some((node) => node.dataset.amContinuityItem === 'track-900'),
        ).toBe(true)
        view.active.value = false
        await settle()
        expect(
          await adapter.restore(
            { focus: { itemKey: 'track-0', controlKey: 'track:track-0:play' } },
            new AbortController().signal,
          ),
        ).toBe(false)
        expect(view.actions.play).not.toHaveBeenCalled()
      } finally {
        view.unmount()
      }
    })

    it('switches the existing responsive viewport and preserves mounted identity on density changes', async () => {
      const view = setup(1000, styled)
      try {
        await settle()
        const first = mounted(view.root)[0]
        view.state.value = { ...view.state.value, displayMode: 'compact', mobileColumns: 2 }
        await settle()
        expect(mounted(view.root)[0]).toBe(first)
        view.setNarrow(true)
        await settle()
        view.desk.scrollTop = 50_000
        view.desk.dispatchEvent(new Event('scroll'))
        await settle()
        expect(mounted(view.root).some((node) => node.dataset.amContinuityItem === 'track-0')).toBe(
          false,
        )
        expect(view.scroll.scrollTop).toBe(0)
        expect(mounted(view.root).length).toBeLessThan(30)
      } finally {
        view.unmount()
      }
    })
  },
)
