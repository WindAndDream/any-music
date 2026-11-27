import { createWorkbenchModuleDirectory } from '@any-music/music-workbench'
import { createTagManagementModule } from '@any-music/plugin-tag-management'

import { builtInSourceDirectory } from '../music-sources/built-in-source-directory'
import { builtInUiThemes } from './built-in-theme-directory'

/** Build-owned identity; user imports and stored manifests never feed this directory. */
export const builtInFeatureModules = [
  ...builtInSourceDirectory.map((source) => source.createModule('userscript')),
  createTagManagementModule('userscript'),
]
export const loadTagManagement = () => import('@any-music/plugin-tag-management/vue')
export const builtInWorkbenchModules = createWorkbenchModuleDirectory(
  'userscript',
  builtInFeatureModules,
  builtInUiThemes,
)

export { builtInUiThemes } from './built-in-theme-directory'
