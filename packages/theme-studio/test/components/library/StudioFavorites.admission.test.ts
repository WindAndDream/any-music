import { provideConfirmationDialog } from '@any-music/ui/library'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'

import StudioCollection from '../../../src/components/library/StudioCollection.vue'
import StudioFavorites from '../../../src/components/library/StudioFavorites.vue'
import { studioVirtualFavoritesCanaryKey } from '../../../src/composables/studio-virtual-favorites-canary'
import { mountMeasuredStudio } from '../../helpers/measured-collection-renderer'
import { createStudioFavoritesFeature } from '../../helpers/studio-track-fixtures'

const candidate = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../../../src/components/library/StudioVirtualTrackLayout.vue', () => {
  candidate.load()
  throw new Error('An unadmitted consumer must not execute the virtual candidate')
})

describe('Studio C03 independent production admission', () => {
  it.each([false, true])(
    'keeps Favorites full-rendered and the lazy candidate untouched, styled=%s',
    async (styled) => {
      const feature = createStudioFavoritesFeature(80, styled)
      const view = mountMeasuredStudio(
        defineComponent({
          setup() {
            provideConfirmationDialog()
            return () => h(StudioFavorites, { feature })
          },
        }),
        { styled },
      )
      try {
        await nextTick()
        expect(view.root.textContent).toContain('歌曲 79')
        expect(candidate.load).not.toHaveBeenCalled()
      } finally {
        view.unmount()
      }
    },
  )

  it.each(['queue:tracks', 'playlist:p:tracks'])(
    'never admits %s through the Favorites key',
    async (scope) => {
      const feature = createStudioFavoritesFeature(80, false)
      const view = mountMeasuredStudio(
        defineComponent({
          setup() {
            provideConfirmationDialog()
            provide(studioVirtualFavoritesCanaryKey, true)
            return () =>
              h(StudioCollection, {
                title: scope,
                scope,
                state: feature.state,
                actions: feature.actions,
                availability: feature.availability,
                status: feature.status,
              })
          },
        }),
        {},
      )
      try {
        await nextTick()
        expect(view.root.textContent).toContain('歌曲 79')
        expect(candidate.load).not.toHaveBeenCalled()
      } finally {
        view.unmount()
      }
    },
  )
})
