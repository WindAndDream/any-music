import type { NetworkProxySettings } from '../features/settings/network-proxy-settings'
import { getWorkbenchRuntime } from './workbench-runtime'

export function configureHttpProxy(settings: NetworkProxySettings): void {
  getWorkbenchRuntime().configureProxy(settings)
}
