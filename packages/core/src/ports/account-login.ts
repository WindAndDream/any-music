/** Login challenges describe intent; a runtime chooses QR display, same-device handoff or system browser. */
export interface AccountLoginCapabilities {
  qrPresentation: 'display' | 'handoff' | 'unavailable'
  verification: 'system-browser' | 'platform-auth-session' | 'unavailable'
  isolatedAccounts: boolean
}

export type AccountLoginChallenge =
  | {
      kind: 'qr'
      accountId: string
      content: string
      expiresAtMs: number
      presentation: 'display' | 'handoff'
    }
  | {
      kind: 'verification'
      accountId: string
      reason: 'login' | 'secondary-verification' | 'risk-control'
    }
  | { kind: 'signed-in'; accountId: string }

/** Credentials remain in native storage; challenges expose only the public login state. */
export interface AccountLoginPort {
  capabilities: AccountLoginCapabilities
  begin(accountId: string): Promise<AccountLoginChallenge>
  poll(accountId: string): Promise<AccountLoginChallenge>
  cancel(accountId: string): Promise<void>
}
