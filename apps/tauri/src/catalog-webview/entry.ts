import classic from '@any-music/theme-default/styles?inline'
import studio from '@any-music/theme-studio/styles?inline'
import shared from '@any-music/ui/styles?inline'
import classicComponents from 'virtual:any-music-theme-styles/default'
import hostComponents from 'virtual:any-music-theme-styles/host'
import studioComponents from 'virtual:any-music-theme-styles/studio'

import { install as mount } from './renderer'

export function install(origin: string, lease: string, bridgeKey: string): boolean {
  return mount(origin, lease, bridgeKey, {
    classic: shared + classic + hostComponents + classicComponents,
    studio: shared + studio + hostComponents + studioComponents,
  })
}
