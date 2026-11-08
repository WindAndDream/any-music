import { describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => ({ classic: 0, studio: 0 }))
vi.mock('@any-music/theme-default/vue', () => {
  loaded.classic++
  return { definition: { id: 'default' } }
})
vi.mock('@any-music/theme-studio/vue', () => {
  loaded.studio++
  return { definition: { id: 'studio' } }
})
vi.mock('@any-music/theme-default/styles?inline', () => ({ default: 'classic-css' }))
vi.mock('@any-music/theme-studio/styles?inline', () => ({ default: 'studio-css' }))
vi.mock('virtual:any-music-theme-styles/default', () => ({ default: 'classic-scoped-css' }))
vi.mock('virtual:any-music-theme-styles/studio', () => ({ default: 'studio-scoped-css' }))
vi.mock('virtual:any-music-theme-styles/host', () => ({ default: 'host-scoped-css' }))

import { builtInUiThemes } from '../../../src/features/plugins/built-in-theme-directory'

describe('application-owned complete theme composition', () => {
  it('discovers metadata without executing Vue or style entries', () => {
    expect(builtInUiThemes.map(({ id }) => id)).toEqual(['default', 'studio'])
    expect(Object.isFrozen(builtInUiThemes)).toBe(true)
    expect(loaded).toEqual({ classic: 0, studio: 0 })
  })
  it('preloads only the explicit classic fallback and executes Studio on demand', async () => {
    const { builtInThemes, protectedStyles } =
      await import('../../../src/features/plugins/built-in-themes')
    expect(loaded).toEqual({ classic: 1, studio: 0 })
    expect(builtInThemes.fallback.loaded.definition.id).toBe('default')
    expect(builtInThemes.fallback.loaded.css).toContain('classic-scoped-css')
    expect(protectedStyles).not.toContain('classic-css')
    expect(protectedStyles).not.toContain('studio-css')
    const studio = builtInThemes.themes.find(({ descriptor }) => descriptor.id === 'studio')!
    const selected = await studio.load()
    expect(loaded).toEqual({ classic: 1, studio: 1 })
    expect(selected.definition.id).toBe('studio')
    expect(selected.css).toContain('studio-scoped-css')
    expect(selected.css).not.toContain('classic-scoped-css')
    expect(await studio.load()).toEqual(selected)
    expect(loaded.studio).toBe(1)
  })
})
