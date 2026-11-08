import { expect, it, vi } from 'vitest'

vi.mock('vue', () => {
  throw new Error('Directory discovery must not load Vue')
})

it('imports build metadata through its public entry without starting presentation', async () => {
  const { BUILT_IN_UI_THEMES } = await import('@any-music/plugin-ui-vue/directory')
  const { assertUiThemeDescriptor } = await import('@any-music/ui/theme')
  expect(BUILT_IN_UI_THEMES.map(({ id }) => id)).toEqual(['default', 'studio'])
  for (const descriptor of BUILT_IN_UI_THEMES)
    expect(() => assertUiThemeDescriptor(descriptor, 'mobile')).not.toThrow()
})
