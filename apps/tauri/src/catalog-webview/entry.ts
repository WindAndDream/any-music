import classic from '@any-music/theme-default/styles?inline'
import shared from '@any-music/ui/styles?inline'
import classicComponents from 'virtual:any-music-theme-styles/default'
import hostComponents from 'virtual:any-music-theme-styles/host'

import { install as mount } from './renderer'

export function install(origin: string, lease: string, bridgeKey: string): boolean {
  return mount(origin, lease, bridgeKey, shared + classic + hostComponents + classicComponents)
}
