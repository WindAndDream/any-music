import type { SourceAuthentication } from '@any-music/plugin-sdk'

export type AccountLoginMethod = 'qr' | 'system-browser' | 'credentials' | 'phone'
export interface AccountPlatform {
  id: string
  name: string
  pluginId?: string
  authentication?: SourceAuthentication
  authenticationBinding?: string
  available?: boolean
}
export interface AccountAuthentication {
  apiBaseUrl?: string
  allowUnauthenticated: boolean
  methods: readonly AccountLoginMethod[]
  credentialFields: SourceAuthentication['credentialFields']
}
export const BUILT_IN_AUTHENTICATION: AccountAuthentication = {
  allowUnauthenticated: false,
  methods: ['qr', 'system-browser'],
  credentialFields: [],
}
export const isExternalAccount = (platformId: string) => platformId.startsWith('external:')
