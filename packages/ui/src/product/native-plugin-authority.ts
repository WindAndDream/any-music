/** Display projection only. Native authorization is rechecked at every operation. */
export interface NativePluginSnapshot {
  installId: string
  pluginId: string
  contentHash: string
  publisher: string
  generation: number
  dataGeneration: number
  permissionEpoch: number
  enabled: boolean
  historicalLevel: 'L0' | 'L1' | 'L2' | 'Secret'
  commands?: readonly { id: string; title: { en: string; 'zh-CN': string } }[]
  contributions?: readonly string[]
  canRollback?: boolean
  dev?: boolean
}

/** Native package preview is inert display data and carries no execution authority. */
export interface NativePluginPackagePreview {
  token: string
  pluginId: string
  version: string
  contentHash: string
  publisher: string | null
  publisherVerified: boolean
  execution: string
  permissions: readonly string[]
  addedPermissions: readonly string[]
  historicalLevel: string
  canInstall: boolean
  blockedReason: string
  dev?: boolean
  contributions?: readonly string[]
}
