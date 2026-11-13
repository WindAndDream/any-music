import { AppError } from '@any-music/core'
import type { ExternalPluginPolicy } from '@any-music/plugin-center'
import { invoke } from '@tauri-apps/api/core'

type CapabilityStatus = 'provided' | 'unavailable'
export interface NativeRuntimeCapabilities {
  platform: 'desktop' | 'android' | 'ios'
  form: 'desktop' | 'mobile'
  externalPlugins: ExternalPluginPolicy
  accountTransport: CapabilityStatus
  accountProxy: CapabilityStatus
  systemBrowser: CapabilityStatus
  secureCredentials: CapabilityStatus
  media: CapabilityStatus
  nativeSave: CapabilityStatus
  packageFiles: CapabilityStatus
  packageSharing: CapabilityStatus
  packageDeepLinks: CapabilityStatus
  backgroundExecution: CapabilityStatus
}

/** Native discovery must succeed before composing ports. No user-agent inference or
 * desktop fallback can expand the effective mobile policy. */
export function loadRuntimeCapabilities(): Promise<NativeRuntimeCapabilities> {
  return invoke('runtime_capabilities')
}

export function requireRuntimeCapability(status: CapabilityStatus, name: string): void {
  if (status !== 'provided')
    throw new AppError('unsupported-operation', `此运行端暂不支持${name}。`)
}
