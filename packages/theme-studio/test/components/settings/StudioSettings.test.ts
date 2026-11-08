import { createDefaultAppShellPreferences, PRODUCT_DESTINATIONS } from '@any-music/ui'
import type { UiThemeFeatureMap } from '@any-music/ui/theme'
import { describe, expect, it, vi } from 'vitest'

import StudioSettings from '../../../src/components/settings/StudioSettings.vue'
import { findStudioNode, invokeStudio, mountStudio } from '../../helpers/test-renderer'
import type { StudioTestNode } from '../../helpers/test-renderer'

function feature(enabledSourceIds: readonly string[]): UiThemeFeatureMap['settings'] {
  return {
    state: {
      section: 'sources',
      open: true,
      isMobileLayout: false,
      suspended: false,
      destinations: PRODUCT_DESTINATIONS,
      sources: ['甲', '乙'].map((name, index) => ({
        id: `source-${index + 1}`,
        name: `来源${name}`,
        provenance: 'built-in',
        capabilities: { search: true, importUrl: true, session: true },
        importUrlScopes: [],
      })),
      enabledSourceIds,
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

function sourceInput(root: StudioTestNode, name: string): StudioTestNode {
  const label = findStudioNode(root, (node) => node.tag === 'label' && node.textContent === name)
  return findStudioNode(label, (node) => node.tag === 'input')
}

describe('Studio source enablement controls', () => {
  it('keeps the last enabled source checked and explains why it cannot be disabled', () => {
    const settings = feature(['source-1'])
    const view = mountStudio(StudioSettings, { feature: settings })
    try {
      const checkbox = sourceInput(view.root, '来源甲')
      expect(checkbox.props.checked).toBe(true)
      expect(checkbox.props.disabled).toBe(true)
      const description = findStudioNode(
        view.root,
        (node) => node.props.id === checkbox.props['aria-describedby'],
      )
      expect(description.textContent.trim()).toBe('至少需要保留一个已启用的音乐源。')
      expect(description.props.role).toBe('status')

      // A queued native change must also be rejected after another source was disabled.
      const input = { checked: false }
      invokeStudio(checkbox, 'onChange', { target: input })
      expect(input.checked).toBe(true)
      expect(settings.actions.setSourceEnabled).not.toHaveBeenCalled()
    } finally {
      view.unmount()
    }
  })

  it('still lets a disabled source be enabled while preserving the authoritative projection', () => {
    const settings = feature(['source-1'])
    const view = mountStudio(StudioSettings, { feature: settings })
    try {
      const checkbox = sourceInput(view.root, '来源乙')
      expect(checkbox.props.checked).toBe(false)
      expect(checkbox.props.disabled).toBe(false)
      expect(checkbox.props['aria-describedby']).toBeUndefined()
      const input = { checked: true }
      invokeStudio(checkbox, 'onChange', { target: input })
      expect(settings.actions.setSourceEnabled).toHaveBeenCalledExactlyOnceWith('source-2', true)
      expect(input.checked).toBe(false)
    } finally {
      view.unmount()
    }
  })

  it('allows disabling one of multiple enabled sources without retaining a rejected native state', () => {
    const settings = feature(['source-1', 'source-2'])
    const view = mountStudio(StudioSettings, { feature: settings })
    try {
      const checkbox = sourceInput(view.root, '来源甲')
      expect(checkbox.props.checked).toBe(true)
      expect(checkbox.props.disabled).toBe(false)
      expect(view.root.textContent).not.toContain('至少需要保留一个已启用的音乐源。')
      const input = { checked: false }
      invokeStudio(checkbox, 'onChange', { target: input })
      expect(settings.actions.setSourceEnabled).toHaveBeenCalledExactlyOnceWith('source-1', false)
      expect(input.checked).toBe(true)
    } finally {
      view.unmount()
    }
  })
})
