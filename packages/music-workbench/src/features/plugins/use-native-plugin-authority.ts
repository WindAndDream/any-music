import type { MusicSourceSession } from '@any-music/core'
import type { NativePluginSnapshot, NativePluginPackagePreview } from '@any-music/ui'
import { onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

export interface NativePluginAuthorityPort {
  snapshot(): Promise<readonly NativePluginSnapshot[]>
  subscribeInstalls?(receive: (installs: readonly NativePluginSnapshot[]) => void): () => void
  revoke(installId: string): Promise<void>
  install?(
    token: string,
    capabilities: readonly string[],
    transferData: boolean,
    userLinkedNetwork: boolean,
  ): Promise<void>
  rollback?(installId: string): Promise<void>
  cancelExecution?(installId: string): Promise<void>
  sourceSession?(installId: string): Promise<MusicSourceSession>
  sourceAccount?(installId: string): Promise<{ accountId: string | null }>
  execute?(
    installId: string,
    command: string,
    inputJson: string,
    sourceAccount?: { accountId: string | null },
  ): Promise<{ token: string; value: unknown }>
  saveResult?(token: string): Promise<boolean>
  diagnostics?(): Promise<readonly unknown[]>
  exportDiagnostics?(): Promise<boolean>
  previewPackage?(bytes: Uint8Array): Promise<NativePluginPackagePreview>
  discardPreview?(token: string): Promise<void>
  pickPackage?(): Promise<NativePluginPackagePreview | null>
  previewPackageUrl?(url: string): Promise<NativePluginPackagePreview>
  beginDev?(): Promise<{ pairingPath: string; previewOnly: boolean } | null>
  endDev?(): Promise<void>
  subscribePackagePreviews?(
    receive: (preview: NativePluginPackagePreview) => void,
  ): Promise<() => void>
  currentPreview?(): Promise<NativePluginPackagePreview | null>
}

/** Native snapshots are transient display data, never a renderer grant cache. */
export function useNativePluginAuthority(
  port: NativePluginAuthorityPort | undefined,
  active: MaybeRefOrGetter<boolean>,
) {
  const installs = shallowRef<readonly NativePluginSnapshot[]>([])
  const busy = shallowRef(false)
  const result = shallowRef<{ token: string; value: unknown }>()
  const diagnostics = shallowRef<readonly unknown[]>([])
  const errorMessage = shallowRef<string>()
  const packagePreview = shallowRef<NativePluginPackagePreview>()
  const devPairingPath = shallowRef<string>()
  let unsubscribePreviews: (() => void) | undefined
  let disposed = false
  let revision = 0
  const executing = new Map<symbol, string>()
  const unsubscribeInstalls = port?.subscribeInstalls?.((snapshot) => {
    // Operations publish their own fresh snapshot; idle native notifications keep counts current.
    if (!disposed && !busy.value) installs.value = snapshot
  })
  if (port?.subscribePackagePreviews)
    void port
      .subscribePackagePreviews((preview) => {
        if (!disposed) {
          revision++
          busy.value = false
          errorMessage.value = undefined
          clearPackagePreview()
          packagePreview.value = preview
        }
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe()
        else unsubscribePreviews = unsubscribe
      })
      .catch(() => {})

  async function beginDev() {
    if (!port?.beginDev || busy.value || disposed) return
    busy.value = true
    errorMessage.value = undefined
    try {
      const pairing = await port.beginDev()
      if (!disposed && pairing) devPairingPath.value = pairing.pairingPath
      else if (disposed) void port.endDev?.().catch(() => {})
    } catch {
      if (!disposed) errorMessage.value = 'DEV 本机配对不可用，生产权限和数据保持隔离。'
    } finally {
      if (!disposed) busy.value = false
    }
  }
  async function endDev() {
    try {
      await port?.endDev?.()
    } finally {
      devPairingPath.value = undefined
      clearPackagePreview()
    }
  }

  async function run(action?: () => Promise<void>, force = false): Promise<void> {
    if (!port || disposed || (busy.value && !force)) return
    const token = ++revision
    busy.value = true
    errorMessage.value = undefined
    try {
      if (action) {
        // Invalidate the visible projection immediately; never optimistically mark a revoke successful.
        installs.value = []
        await action()
      }
      if (disposed || token !== revision) return
      const snapshot = await port.snapshot()
      if (disposed || token !== revision) return
      installs.value = snapshot
      if (port.currentPreview && !packagePreview.value) {
        const preview = await port.currentPreview()
        if (!disposed && token === revision && preview) packagePreview.value = preview
      }
    } catch {
      if (!disposed && token === revision) {
        installs.value = []
        errorMessage.value = '无法读取或更新原生授权，请刷新重试。'
      }
    } finally {
      if (!disposed && token === revision) busy.value = false
    }
  }
  const refresh = () => run()
  const revoke = (installId: string) =>
    run(async () => {
      result.value = undefined
      await port!.revoke(installId)
    }, true)
  const install = (
    capabilities: readonly string[],
    transferData: boolean,
    userLinkedNetwork: boolean,
  ) =>
    run(async () => {
      if (!packagePreview.value || !port?.install) return
      await port.install(packagePreview.value.token, capabilities, transferData, userLinkedNetwork)
      packagePreview.value = undefined
      result.value = undefined
    })
  const rollback = (id: string) =>
    run(async () => {
      result.value = undefined
      await port?.rollback?.(id)
    })
  const execute = (id: string, command: string, input: unknown) =>
    run(async () => {
      const current = revision
      result.value = undefined
      const execution = Symbol(id)
      executing.set(execution, id)
      try {
        const output = await port?.execute?.(id, command, JSON.stringify(input))
        if (!disposed && current === revision) result.value = output
      } finally {
        executing.delete(execution)
      }
    })
  const saveResult = () =>
    run(async () => {
      if (result.value) await port?.saveResult?.(result.value.token)
    })
  const exportDiagnostics = () =>
    run(async () => {
      await port?.exportDiagnostics?.()
    })
  const refreshDiagnostics = () =>
    run(async () => {
      const values = await port?.diagnostics?.()
      if (!disposed) diagnostics.value = values ?? []
    })
  async function acquirePackage(action: () => Promise<NativePluginPackagePreview | null>) {
    if (disposed || busy.value) return
    const token = ++revision
    busy.value = true
    errorMessage.value = undefined
    try {
      const preview = await action()
      if (preview) {
        if (!disposed && token === revision) {
          clearPackagePreview()
          packagePreview.value = preview
        } else void port?.discardPreview?.(preview.token).catch(() => {})
      }
    } catch {
      if (!disposed && token === revision)
        errorMessage.value = '插件包无法预览，请检查地址、目标策略、完整性与大小限制。'
    } finally {
      if (!disposed && token === revision) busy.value = false
    }
  }
  const chooseNativePackage = () =>
    port?.pickPackage ? acquirePackage(() => port.pickPackage!()) : Promise.resolve()
  const previewPackageUrl = (url: string) =>
    port?.previewPackageUrl ? acquirePackage(() => port.previewPackageUrl!(url)) : Promise.resolve()
  async function selectPackageFile(file: File): Promise<void> {
    if (!port?.previewPackage || disposed || busy.value) return
    const token = ++revision
    busy.value = true
    clearPackagePreview()
    errorMessage.value = undefined
    try {
      if (!file.name.toLowerCase().endsWith('.amplugin') || file.size > 16 * 1024 * 1024)
        throw new Error('Unsupported package')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (disposed || token !== revision) return
      const preview = await port.previewPackage(bytes)
      if (!disposed && token === revision) packagePreview.value = preview
      else void port.discardPreview?.(preview.token).catch(() => {})
    } catch {
      if (!disposed && token === revision)
        errorMessage.value = '插件包无法预览，请检查格式、完整性与大小限制。'
    } finally {
      if (!disposed && token === revision) busy.value = false
    }
  }
  function clearPackagePreview() {
    const token = packagePreview.value?.token
    packagePreview.value = undefined
    if (token) void port?.discardPreview?.(token).catch(() => {})
  }
  watch(
    () => toValue(active),
    (value) => {
      if (value) void refresh()
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    clearPackagePreview()
    disposed = true
    revision++
    unsubscribePreviews?.()
    unsubscribeInstalls?.()
    for (const id of new Set(executing.values())) void port?.cancelExecution?.(id).catch(() => {})
    if (devPairingPath.value) void port?.endDev?.().catch(() => {})
  })
  return {
    installs: readonly(installs),
    result: readonly(result),
    diagnostics: readonly(diagnostics),
    install,
    rollback,
    execute,
    saveResult,
    refreshDiagnostics,
    exportDiagnostics,
    busy: readonly(busy),
    errorMessage: readonly(errorMessage),
    refresh,
    revoke,
    packagePreview: readonly(packagePreview),
    selectPackageFile,
    clearPackagePreview,
    chooseNativePackage,
    previewPackageUrl,
    devPairingPath: readonly(devPairingPath),
    beginDev,
    endDev,
  }
}
