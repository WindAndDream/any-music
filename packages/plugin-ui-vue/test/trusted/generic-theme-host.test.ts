import { expect, it } from 'vitest'

import { createThemeController, ThemeHost } from '../../src/trusted'
import { rootComposition } from './root-theme-fixture'

it('loads and runs the public generic host graph without evaluating either concrete theme', async () => {
  expect(ThemeHost).toBeDefined()
  const controller = createThemeController({
    composition: rootComposition(),
    form: 'desktop',
    resources: {
      prepare: () => ({ activate() {}, deactivate() {}, dispose() {} }),
      capture: () => () => {},
      afterRender: (callback) => callback(),
    },
  })
  expect(await controller.select('studio')).toBe(true)
  controller.dispose()
})
