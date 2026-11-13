import type { NativeAccount } from './account-runtime'

/** Public facts only. Credential presence and a routing pause cannot prove logout. */
export interface AccountState {
  login: 'signed-in' | 'signed-out' | 'unknown'
  verification: 'required' | 'not-required' | 'unknown'
  connection: 'available' | 'unavailable' | 'unknown'
}

export function getAccountState(account: NativeAccount): AccountState {
  return account.state
}
