import { editingStateKey } from '@any-music/ui'
import type { EditingSession } from '@any-music/ui'
import { shallowRef } from 'vue'
import type { ShallowRef } from 'vue'

import type { NativeAccount } from './account-runtime'

const nameKey = editingStateKey<ShallowRef<string>>('native-account-name')
const connectionKey = editingStateKey<{
  primary: ShallowRef<string>
  backups: ShallowRef<string[]>
}>('native-account-connection')

/** The native controller resets these cells on real navigation, never on theme disposal. */
export function useAccountNameDraft(name: string, editing?: EditingSession) {
  return editing?.state(nameKey, () => shallowRef(name)) ?? shallowRef(name)
}

export function useAccountConnectionDraft(account: NativeAccount, editing?: EditingSession) {
  const create = () => ({
    primary: shallowRef(account.proxyId ?? ''),
    backups: shallowRef([...(account.backupProxyIds ?? [])]),
  })
  return editing?.state(connectionKey, create) ?? create()
}
