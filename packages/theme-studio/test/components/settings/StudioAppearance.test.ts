import { createDefaultAppShellPreferences, PRODUCT_DESTINATIONS } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'

import StudioAppearance from '../../../src/components/settings/StudioAppearance.vue'
import { findStudioNode, invokeStudio, mountStudio } from '../../helpers/test-renderer'

function feature(): UiThemeFeatureMap['settings'] {
  return {
    state: {
      section: 'navigation',
      open: true,
      isMobileLayout: false,
      suspended: false,
      destinations: PRODUCT_DESTINATIONS,
      sources: [],
      enabledSourceIds: [],
      availabilityBySourceId: {},
      externalSourcesEnabled: false,
      profileId: 'profile',
      appearance: 'system',
      themeId: 'studio',
      themes: [],
      preferences: createDefaultAppShellPreferences(),
      playbackHistoryLimit: 100,
      downloadConcurrency: 2,
      creatorDisplayName: '作者',
      filterHistory: {
        limits: { search: 12, tags: 12, published: 12, duration: 12, platforms: 12, naming: 12 },
        collapseAfter: 3,
      },
    },
    actions: {
      close: vi.fn(),
      selectSection: vi.fn(),
      setSourceEnabled: vi.fn(),
      checkSource: vi.fn(),
      setAppearance: vi.fn(),
      selectTheme: vi.fn(),
      setPreferences: vi.fn(),
      setPlaybackHistoryLimit: vi.fn(),
      setDownloadConcurrency: vi.fn(),
      setCreatorDisplayName: vi.fn(),
      setFilterHistory: vi.fn(),
    },
    availability: { status: 'available' },
    status: { status: 'ready' },
  }
}

describe('Studio required navigation', () => {
  it('marks required destinations and rejects attempts to hide them while optional destinations remain editable', () => {
    const settings = feature()
    const view = mountStudio(StudioAppearance, { feature: settings })
    try {
      for (const destination of PRODUCT_DESTINATIONS) {
        const row = findStudioNode(
          view.root,
          (node) => node.tag === 'li' && node.textContent.includes(destination.label),
        )
        const checkbox = findStudioNode(row, (node) => node.tag === 'input')
        expect(Boolean(checkbox.props.disabled)).toBe(!destination.canHide)
        expect(row.textContent.includes('必需')).toBe(!destination.canHide)
        invokeStudio(checkbox, 'onChange', { target: { checked: false } })
        if (!destination.canHide) expect(settings.actions.setPreferences).not.toHaveBeenCalled()
        else {
          expect(settings.actions.setPreferences).toHaveBeenCalledWith({
            ...settings.state.preferences,
            hiddenDestinationIds: [destination.id],
          })
          vi.mocked(settings.actions.setPreferences).mockClear()
        }
      }
    } finally {
      view.unmount()
    }
  })
})
