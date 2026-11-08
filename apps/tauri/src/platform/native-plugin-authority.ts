import { AppError } from '@any-music/core'
import type { NativePluginAuthorityPort } from '@any-music/music-workbench'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type Snapshot = Awaited<ReturnType<NativePluginAuthorityPort['snapshot']>>
const listeners = new Set<(states: Snapshot) => void>()
let selectAccount: (installId: string) => string | undefined = () => undefined
let refreshSources: (() => Promise<void>) | undefined
let sourceSession: NonNullable<NativePluginAuthorityPort['sourceSession']> = async () => ({
  status: 'not-required',
})
let sourceAccount: NonNullable<NativePluginAuthorityPort['sourceAccount']> = async () => ({
  accountId: null,
})
let sourceIdentity = ''
let snapshotRequest: Promise<Snapshot> | undefined
let snapshotRevision = 0
export function configureSourceAccountSelection(
  select: typeof selectAccount,
  refresh?: () => Promise<void>,
  session?: typeof sourceSession,
  account?: typeof sourceAccount,
) {
  selectAccount = select
  refreshSources = refresh
  if (session) sourceSession = session
  if (account) sourceAccount = account
}
function snapshot(): Promise<Snapshot> {
  // Subscriptions and the center's initial refresh start together. The native DB
  // admits one operation at a time; share only the pending read, never settled state.
  if (!snapshotRequest) {
    const request = readSnapshot(snapshotRevision).finally(() => {
      if (snapshotRequest === request) snapshotRequest = undefined
    })
    snapshotRequest = request
  }
  return snapshotRequest
}
async function readSnapshot(revision: number): Promise<Snapshot> {
  const states = await invoke<Snapshot>('plugin_authority_snapshot')
  if (revision !== snapshotRevision) return snapshot()
  const identity = states
    .map((s) => `${s.installId}:${s.contentHash}:${s.enabled}:${s.permissionEpoch}`)
    .join('|')
  if (identity !== sourceIdentity) {
    await refreshSources?.()
    if (revision !== snapshotRevision) return snapshot()
    sourceIdentity = identity
  }
  for (const listener of listeners) listener(states)
  return states
}
function updateAuthority<T>(request: Promise<T>): Promise<T> {
  return request.finally(() => {
    // A read awaiting account-directory refresh may predate this native change.
    // Its completion must neither satisfy the next refresh nor publish old install state.
    snapshotRevision++
    snapshotRequest = undefined
  })
}

/** Named main-view operations. Identity, consent, sessions and epoch remain native-owned. */
export const nativePluginAuthority: NativePluginAuthorityPort = {
  sourceSession: (id) => sourceSession(id),
  sourceAccount: (id) => sourceAccount(id),
  install: (token, capabilities, transferData, userLinkedNetwork) =>
    updateAuthority(
      invoke('plugin_package_install', { token, capabilities, transferData, userLinkedNetwork }),
    ),
  rollback: (installId) => updateAuthority(invoke('plugin_package_rollback', { installId })),
  cancelExecution: (installId) => invoke('plugin_command_cancel', { installId }),
  execute: async (installId, command, inputJson, account) => {
    try {
      return await invoke('plugin_command_run', {
        installId,
        command,
        inputJson,
        accountId: account ? account.accountId : selectAccount(installId),
        withoutLogin: account?.accountId === null,
      })
    } catch (cause) {
      const message = String(cause)
      if (message.startsWith('not-authenticated:'))
        throw new AppError('not-authenticated', message.slice('not-authenticated:'.length))
      if (message.startsWith('operation-cancelled:'))
        throw new AppError('operation-cancelled', message.slice('operation-cancelled:'.length))
      throw cause
    }
  },
  saveResult: (token) => invoke('plugin_result_save', { token }),
  diagnostics: () => invoke('plugin_diagnostics'),
  exportDiagnostics: () => invoke('plugin_diagnostics_export'),
  snapshot,
  subscribeInstalls(receive) {
    let active = true
    listeners.add(receive)
    void snapshot().catch(() => {
      if (active) receive([])
    })
    return () => {
      active = false
      listeners.delete(receive)
    }
  },
  revoke: (installId) => updateAuthority(invoke('plugin_authority_revoke', { installId })),
  previewPackage: (bytes) => invoke('plugin_package_preview', { bytes: Array.from(bytes) }),
  discardPreview: (token) => invoke('plugin_package_discard_preview', { token }),
  pickPackage: () => invoke('plugin_package_pick_preview'),
  previewPackageUrl: (url) => invoke('plugin_package_url_preview', { url }),
  beginDev: () => updateAuthority(invoke('plugin_dev_begin')),
  endDev: () => updateAuthority(invoke('plugin_dev_end')),
  currentPreview: () => invoke('plugin_package_current_preview'),
  subscribePackagePreviews: async (receive) => {
    const stop = await listen('any-music:plugin-package-preview', (event) =>
      receive(event.payload as Parameters<typeof receive>[0]),
    )
    const capabilities = await invoke<{ platform: string }>('runtime_capabilities')
    if (capabilities.platform !== 'android') return stop
    // Notification payloads carry no authority. Drain only the native OS-selected inbox.
    const incoming = async () => {
      const preview = await invoke<Parameters<typeof receive>[0] | null>(
        'plugin_package_current_preview',
      ).catch(() => null)
      if (preview) receive(preview)
    }
    window.addEventListener('any-music:mobile-package-ready', incoming)
    window.addEventListener('focus', incoming)
    return () => {
      stop()
      window.removeEventListener('any-music:mobile-package-ready', incoming)
      window.removeEventListener('focus', incoming)
    }
  },
}

/** Document inspection is available before execution admission. Do not advertise DEV,
 * install, rollback or command controls on a preview-only native target. */
export const nativePackagePreview: NativePluginAuthorityPort = {
  snapshot: nativePluginAuthority.snapshot,
  subscribeInstalls: nativePluginAuthority.subscribeInstalls,
  revoke: nativePluginAuthority.revoke,
  previewPackage: nativePluginAuthority.previewPackage,
  discardPreview: nativePluginAuthority.discardPreview,
  pickPackage: nativePluginAuthority.pickPackage,
  previewPackageUrl: nativePluginAuthority.previewPackageUrl,
  currentPreview: nativePluginAuthority.currentPreview,
  subscribePackagePreviews: nativePluginAuthority.subscribePackagePreviews,
  diagnostics: nativePluginAuthority.diagnostics,
  exportDiagnostics: nativePluginAuthority.exportDiagnostics,
}
