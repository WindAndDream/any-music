import tagCss from '@any-music/plugin-tag-management/styles?inline'
import type { ThemeApplicationComposition } from '@any-music/plugin-ui-vue/trusted'
import classicCss from '@any-music/theme-default/styles?inline'
import { definition as classic } from '@any-music/theme-default/vue'
import sharedCss from '@any-music/ui/styles?inline'
import classicSfcCss from 'virtual:any-music-theme-styles/default'
import hostSfcCss from 'virtual:any-music-theme-styles/host'

import { builtInUiThemes } from './built-in-theme-directory'

export const protectedStyles = sharedCss + hostSfcCss + tagCss
const fallback = {
  descriptor: builtInUiThemes[0],
  loaded: { definition: classic, css: protectedStyles + classicCss + classicSfcCss },
}
export const builtInThemes: ThemeApplicationComposition = {
  fallback,
  themes: [{ descriptor: fallback.descriptor, load: async () => fallback.loaded }],
}
