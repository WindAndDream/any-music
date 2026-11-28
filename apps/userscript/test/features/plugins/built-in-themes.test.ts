import { describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => ({ classic: 0 }))
vi.mock('@any-music/theme-default/vue', () => {
  loaded.classic++
  return { definition: { id: 'default' } }
})
vi.mock('@any-music/theme-default/styles?inline', () => ({ default: 'classic-css' }))
vi.mock('virtual:any-music-theme-styles/default', () => ({ default: 'classic-scoped-css' }))
vi.mock('virtual:any-music-theme-styles/host', () => ({ default: 'host-scoped-css' }))

import { builtInUiThemes } from '../../../src/features/plugins/built-in-theme-directory'

describe('application-owned complete theme composition', () => {
  it('discovers metadata without executing Vue or style entries', () => {
    expect(builtInUiThemes.map(({ id }) => id)).toEqual(['default'])
    expect(Object.isFrozen(builtInUiThemes)).toBe(true)
    expect(loaded).toEqual({ classic: 0 })
  })
  it('registers the Classic fallback with scoped styles', async () => {
    const { builtInThemes, protectedStyles } =
      await import('../../../src/features/plugins/built-in-themes')
    expect(loaded).toEqual({ classic: 1 })
    expect(builtInThemes.fallback.loaded.definition.id).toBe('default')
    expect(builtInThemes.fallback.loaded.css).toContain('classic-scoped-css')
    expect(protectedStyles).not.toContain('classic-css')
    expect(builtInThemes.themes.map(({ descriptor }) => descriptor.id)).toEqual(['default'])
    expect(await builtInThemes.themes[0]!.load()).toBe(builtInThemes.fallback.loaded)
  })
})
