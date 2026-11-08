import creationCss from '@any-music/plugin-music-creation/styles?inline'
import tagCss from '@any-music/plugin-tag-management/styles?inline'
import type { ThemeApplicationComposition } from '@any-music/plugin-ui-vue/trusted'
import classicCss from '@any-music/theme-default/styles?inline'
import { definition as classic } from '@any-music/theme-default/vue'
import sharedCss from '@any-music/ui/styles?inline'
import classicSfcCss from 'virtual:any-music-theme-styles/default'
import hostSfcCss from 'virtual:any-music-theme-styles/host'

import { builtInUiThemes } from './built-in-theme-directory'

import nativeCss from '../../styles/app.scss?inline'

export const protectedStyles = sharedCss + hostSfcCss + tagCss + creationCss + nativeCss
const fallback = {
  descriptor: builtInUiThemes[0],
  loaded: {
    definition: classic,
    css: sharedCss + hostSfcCss + tagCss + creationCss + classicCss + classicSfcCss,
  },
}
export const builtInThemes: ThemeApplicationComposition = {
  fallback,
  themes: [
    { descriptor: builtInUiThemes[0], load: async () => fallback.loaded },
    {
      descriptor: builtInUiThemes[1],
      load: async () => {
        const [{ definition }, { default: css }, { default: sfcCss }] = await Promise.all([
          import('@any-music/theme-studio/vue'),
          import('@any-music/theme-studio/styles?inline'),
          import('virtual:any-music-theme-styles/studio'),
        ])
        return { definition, css: sharedCss + hostSfcCss + tagCss + creationCss + css + sfcCss }
      },
    },
  ],
}
