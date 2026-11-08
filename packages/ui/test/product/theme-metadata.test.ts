import { expect, it, vi } from 'vitest'

vi.mock('vue', () => {
  throw new Error('Metadata must not load Vue')
})
vi.mock('@any-music/core', () => {
  throw new Error('Metadata must not start business instances')
})

it('evaluates the public contract graph without importing Vue, styles or business instances', async () => {
  const contract = await import('@any-music/ui/theme')
  expect(contract.UI_THEME_CONTRACT_VERSION).toBe(1)
  expect(contract.UI_THEME_REQUIRED_VIEWS).toContain('catalog')
  expect(Object.keys(contract).toSorted()).toEqual(
    [
      'UI_THEME_CONTRACT_VERSION',
      'UI_THEME_OPTIONAL_VIEWS',
      'UI_THEME_REQUIRED_VIEWS',
      'assertUiThemeDefinition',
      'assertUiThemeDescriptor',
      'getPresentationContinuity',
      'registerPresentationContinuity',
    ].toSorted(),
  )
})
