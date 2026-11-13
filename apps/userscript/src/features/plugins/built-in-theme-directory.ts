import { descriptor as classic } from '@any-music/theme-default'
import { descriptor as studio } from '@any-music/theme-studio'

/** Metadata access cannot evaluate either Vue/style entry. */
export const builtInUiThemes = Object.freeze([classic, studio] as const)
