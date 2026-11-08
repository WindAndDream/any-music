import { describe, expect, it } from 'vitest'

import {
  createDefaultAppShellPreferences,
  normalizeAppShellPreferences,
} from '../../src/product/app-shell-preferences'

describe('app shell preferences', () => {
  it('keeps a user order while appending destinations introduced by a later release', () => {
    const normalized = normalizeAppShellPreferences({
      destinationOrder: ['favorites', 'catalog'],
    })

    expect(normalized.destinationOrder.slice(0, 2)).toEqual(['favorites', 'catalog'])
    expect(new Set(normalized.destinationOrder).size).toBe(
      createDefaultAppShellPreferences().destinationOrder.length,
    )
  })

  it('drops unknown destinations and refuses to hide fixed mobile destinations', () => {
    const normalized = normalizeAppShellPreferences({
      destinationOrder: ['missing', 'queue', 'queue', 'download-history'],
      hiddenDestinationIds: ['missing', 'catalog', 'queue', 'favorites', 'download-history'],
    })

    expect(normalized.destinationOrder[0]).toBe('queue')
    expect(normalized.destinationOrder).not.toContain('missing')
    expect(normalized.destinationOrder).not.toContain('download-history')
    expect(normalized.hiddenDestinationIds).toEqual(['queue'])
  })

  it('falls back safely when persisted values have incompatible types', () => {
    const normalized = normalizeAppShellPreferences({
      sidebarSide: 'center',
      isSidebarCollapsed: 'yes',
      isMobileNavigationEnabled: 0,
      theme: 'sepia',
    })

    expect(normalized).toMatchObject({
      sidebarSide: 'left',
      isSidebarCollapsed: false,
      isMobileNavigationEnabled: true,
      theme: 'system',
    })
  })
})
