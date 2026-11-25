import { provideConfirmationDialog } from '@any-music/ui/library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import StudioCollection from '../../../src/components/library/StudioCollection.vue'
import StudioFavorites from '../../../src/components/library/StudioFavorites.vue'
import { mountMeasuredStudio } from '../../helpers/measured-collection-renderer'
import { createStudioFavoritesFeature } from '../../helpers/studio-track-fixtures'

const candidate = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../../../src/components/library/StudioVirtualTrackLayout.vue', () => {
  candidate.load()
  throw new Error('The full-rendered collection loaded the virtual layout')
})
afterEach(() => vi.unstubAllEnvs())

describe('Studio collections in development and release profiles', () => {
  it.each(['staging', 'prod'].flatMap((mode) => [false, true].map((styled) => ({ mode, styled }))))(
    'keeps Favorites full-rendered in $mode, styled=$styled',
    async ({ mode, styled }) => {
      vi.stubEnv('MODE', mode)
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
    'keeps %s full-rendered during development',
    async (scope) => {
      vi.stubEnv('MODE', 'dev')
      const feature = createStudioFavoritesFeature(80, false)
      const view = mountMeasuredStudio(
        defineComponent({
          setup() {
            provideConfirmationDialog()
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
