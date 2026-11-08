import { AppError } from '@any-music/core'
import { configureWorkbenchRuntime } from '@any-music/music-workbench'
import { invoke } from '@tauri-apps/api/core'

import { AccountRuntime } from '../features/accounts/account-runtime'
import { createBuiltInMusicSources } from '../features/music-sources/built-in-music-sources'
import { createUnavailableMusicSources } from '../features/music-sources/unavailable-music-sources'
import { builtInThemes, protectedStyles } from '../features/plugins/built-in-themes'
import {
  createBuiltInWorkbenchModules,
  loadTagManagement,
  loadMusicCreation,
  builtInUiThemes,
} from '../features/plugins/built-in-workbench-modules'
import { androidPlaybackEnvironment } from './android-playback-environment'
import { nativeDownloadScheduler } from './native-download-scheduler'
import { createNativeHttpClient } from './native-http'
import { nativePackagePreview, nativePluginAuthority } from './native-plugin-authority'
import { configureSourceAccountSelection } from './native-plugin-authority'
import { createTauriPlaylistCoverCache } from './playlist-cover-cache'
import { prepareNativeMedia } from './prepare-native-media'
import { createProductStorage } from './product-storage'
import { nativeResourceCache, resolveNativeArtwork } from './resource-cache'
import { loadRuntimeCapabilities, requireRuntimeCapability } from './runtime-capabilities'
import type { NativeRuntimeCapabilities } from './runtime-capabilities'
import { verifyNativeDownload } from './verify-native-download'

let configuredCapabilities: Readonly<NativeRuntimeCapabilities> | undefined
export function getNativeRuntimeCapabilities(): Readonly<NativeRuntimeCapabilities> {
  if (!configuredCapabilities) throw new Error('Native capabilities are not configured')
  return configuredCapabilities
}

export const accountRuntime = new AccountRuntime()
export async function configureTauriWorkbench(): Promise<void> {
  const capabilities = await loadRuntimeCapabilities()
  configuredCapabilities = Object.freeze(capabilities)
  await accountRuntime.initialize()
  if (capabilities.externalPlugins !== 'none') {
    configureSourceAccountSelection(
      (id) => accountRuntime.selectedAccountIds.value[`external:${id}`],
      () => accountRuntime.refreshSourcePlatforms(),
      async (id) => {
        await accountRuntime.refresh()
        const platform = `external:${id}`
        const auth = accountRuntime.sourcePlatforms.value.find(
          (p) => p.id === platform,
        )?.authentication
        if (!auth) return { status: 'not-required' }
        const selected = accountRuntime.selectedAccountIds.value[platform]
        const accounts = accountRuntime.snapshot.value.accounts.filter(
          (a) => a.platformId === platform && a.enabled,
        )
        const account = selected
          ? accounts.find((a) => a.id === selected)
          : (accounts.find((a) => a.state.login === 'signed-in') ??
            accounts.find((a) => a.authentication === 'anonymous'))
        if (account?.authentication === 'credential')
          return account.state.login === 'signed-in'
            ? { status: 'signed-in', user: { id: account.id, name: account.name } }
            : { status: 'signed-out' }
        return { status: auth.allowUnauthenticated ? 'not-required' : 'signed-out' }
      },
      async (id) => {
        await accountRuntime.refresh()
        const platform = `external:${id}`
        const selected = accountRuntime.selectedAccountIds.value[platform]
        const accounts = accountRuntime.snapshot.value.accounts.filter(
          (a) => a.platformId === platform && a.enabled,
        )
        const account = selected
          ? accounts.find((a) => a.id === selected)
          : (accounts.find((a) => a.state.login === 'signed-in') ??
            accounts.find((a) => a.authentication === 'anonymous'))
        return { accountId: account?.id ?? null }
      },
    )
  }
  if (capabilities.form === 'desktop') await accountRuntime.refreshSourcePlatforms()
  const storage = await createProductStorage()
  const externalPlugins = capabilities.externalPlugins
  const modules = createBuiltInWorkbenchModules(capabilities.form)
  const sources =
    capabilities.accountTransport === 'provided'
      ? createBuiltInMusicSources(accountRuntime, capabilities.form)
      : createUnavailableMusicSources(capabilities.form)
  // These newly constructed facades belong to this composition. Account HTTP
  // does not imply a media adapter; reject before descriptor or grant requests.
  if (capabilities.media !== 'provided')
    for (const source of sources)
      source.resolveMedia = async () => {
        throw new AppError('unsupported-operation', '此运行端暂不支持媒体播放与下载。')
      }
  configureWorkbenchRuntime({
    playlistCovers: createTauriPlaylistCoverCache(),
    resourceCache: nativeResourceCache,
    resolveArtwork: capabilities.media === 'provided' ? resolveNativeArtwork : undefined,
    playbackEnvironment:
      capabilities.platform === 'android' ? androidPlaybackEnvironment : undefined,
    themes: builtInThemes,
    protectedStyles,
    downloadScheduler: nativeDownloadScheduler,
    verifyDownload: capabilities.nativeSave === 'provided' ? verifyNativeDownload : undefined,
    externalPlugins,
    nativePluginAuthority:
      externalPlugins !== 'none'
        ? nativePluginAuthority
        : capabilities.packageFiles === 'provided'
          ? nativePackagePreview
          : undefined,
    loadTagManagement,
    loadMusicCreation,
    uiThemes: builtInUiThemes,
    modules: {
      runtime: 'tauri',
      form: capabilities.form,
      ...modules,
    },
    storage,
    http:
      capabilities.accountTransport === 'provided'
        ? createNativeHttpClient()
        : {
            request: async () => {
              throw new AppError('unsupported-operation', '此运行端暂不支持来源网络请求。')
            },
          },
    // Source factories bind their own account HTTP/CDP ports. Gate construction too,
    // rather than relying only on the workbench's generic HTTP adapter.
    builtInMusicSources: sources,
    configureProxy: () => {},
    openLogin: (_, platformId) => {
      requireRuntimeCapability(capabilities.accountTransport, '账号登录')
      const accountPlatform =
        accountRuntime.sourcePlatforms.value.find((p) => p.pluginId === platformId)?.id ??
        platformId
      window.dispatchEvent(
        new CustomEvent('any-music:open-account-login', { detail: accountPlatform }),
      )
    },
    canHide: false,
    subscribeSourceInvalidation: accountRuntime.subscribeSourceInvalidation,
    prepareMedia: (_, source) => {
      requireRuntimeCapability(capabilities.media, '媒体播放')
      return prepareNativeMedia(source)
    },
    saveBlob: async (blob, fileName) => {
      requireRuntimeCapability(capabilities.nativeSave, '保存文件')
      if (capabilities.form === 'mobile' && blob.size > 32 * 1024 * 1024)
        throw new AppError(
          'limit-exceeded',
          '文件超过手机单次保存上限（32 MiB），请选择较小的导出格式或缩短片段。',
        )
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const saved = await invoke<{ fileName: string; sizeBytes: number; sha256: string } | null>(
        'save_download',
        {
          fileName,
          bytes: Array.from(bytes),
        },
      ).catch((cause: unknown) => {
        throw new AppError(
          'storage-write-failed',
          typeof cause === 'string' ? cause : '文件保存失败，请检查下载目录与磁盘空间。',
          { cause },
        )
      })
      if (!saved) throw new AppError('operation-cancelled', '已取消保存文件。')
      return saved
    },
  })
}
