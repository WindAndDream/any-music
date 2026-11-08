import type { QrLoginResult } from './account-login'

export type LoginExperimentMode = 'headed-hidden' | 'headless'
/** Only public observations cross IPC; the browser's requests and credentials stay native. */
export interface LoginExperimentSnapshot {
  runId: string
  mode: LoginExperimentMode
  phase: 'starting' | 'waiting' | 'needs-browser' | 'visible' | 'finished' | 'failed' | 'cancelled'
  browser: string
  version: string
  login: QrLoginResult
  browserLogin: boolean
  rustSession: 'not-checked' | 'signed-in' | 'signed-out' | 'unavailable'
  smsRequested: boolean
  smsVerified: boolean
  windowObservation: 'not-observed' | 'window-observed'
  visibleFallback: boolean
  cleanup: 'pending' | 'complete' | 'failed'
}
