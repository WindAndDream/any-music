import {
  createExternalSourcesModule,
  createWorkbenchModuleDirectory,
} from '@any-music/music-workbench'
import type { ModuleForm } from '@any-music/plugin-center'
import { createMusicCreationModule } from '@any-music/plugin-music-creation'
import { createTagManagementModule } from '@any-music/plugin-tag-management'

import { getBuiltInSourceDirectory } from '../music-sources/built-in-source-directory'
import { builtInUiThemes } from './built-in-theme-directory'

/** Renderer business modules only. This directory confers no Rust installation or network grant. */
export function createBuiltInWorkbenchModules(form: ModuleForm) {
  const features = [
    ...getBuiltInSourceDirectory(form).map((source) => source.createModule('tauri')),
    createTagManagementModule('tauri'),
    createMusicCreationModule('tauri'),
    createExternalSourcesModule('tauri'),
  ]
  return { features, directory: createWorkbenchModuleDirectory('tauri', features, builtInUiThemes) }
}
export const loadMusicCreation = () => import('@any-music/plugin-music-creation/vue')
export const loadTagManagement = () => import('@any-music/plugin-tag-management/vue')

export { builtInUiThemes } from './built-in-theme-directory'
