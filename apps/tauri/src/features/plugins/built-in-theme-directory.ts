import { descriptor as classic } from '@any-music/theme-default'
import { descriptor as studio } from '@any-music/theme-studio'

/** Native capability composition and theme identity are independent. */
export const builtInUiThemes = Object.freeze([classic, studio] as const)
