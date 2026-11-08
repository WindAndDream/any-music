/** Public pending-login presentation. Native tokens, cookies and SDK payloads never cross IPC. */
export interface LoginVerification {
  methods: { id: string; label: string; inApp: boolean }[]
  selectedMethod: string
  maskedMobile: string
  retryAfter: number
  codeLength: number
}

export interface QrLoginResult {
  status: 'waiting' | 'scanned' | 'signed-in' | 'expired' | 'verification-required' | 'blocked'
  qrContent?: string
  qrImage?: string
  expiresAt?: number
  message?: string
  verification?: LoginVerification
  keepPolling?: boolean
}

export type LoginPhase =
  | 'choose'
  | 'generating'
  | 'waiting'
  | 'scanned'
  | 'verification'
  | 'browser'
  | 'credentials'
  | 'phone'
  | 'complete'
  | 'expired'
  | 'blocked'
