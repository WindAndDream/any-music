import type {
  AppErrorState,
  DownloadedFileSummary,
  HttpClient,
  MusicSourcePlugin,
  ResolvedMediaSource,
  Track,
} from '@any-music/core'
import type { ModuleDescriptor, ModuleForm, ModuleRuntime } from '@any-music/plugin-center'
import type { ExternalPluginPolicy } from '@any-music/plugin-center'
import type { ThemeApplicationComposition } from '@any-music/plugin-ui-vue/trusted'
import type { TagManagementImplementation, MusicCreationImplementation } from '@any-music/ui'
import type { RemoteImageResolver } from '@any-music/ui'
import type { UiThemeDescriptor } from '@any-music/ui/theme'

import type { DownloadScheduler } from '../features/downloads/download-scheduler'
import type { NativePluginAuthorityPort } from '../features/plugins/use-native-plugin-authority'
import type { NetworkProxySettings } from '../features/settings/network-proxy-settings'
import type { ResourceCachePort } from '../features/settings/use-resource-cache-settings'
import type { PlaylistCoverCache } from '../storage/playlist-cover-cache'

export interface StableValueStorage {
  read<T>(key: string, fallback?: T): T | undefined
  write(key: string, value: unknown): void
  /** Runtime adapters may reclaim unreachable generation chunks. */
  remove?(key: string): void
}

/** 运行端撤销公开身份时同步 renderer，凭证与原生资源清理由运行端负责。 */
export interface SourceInvalidation {
  /** A completed account verification may refresh its own credentials before reloading. */
  reason?: 'credentials-updated' | 'configuration-updated'
  pluginId: string
  accountId?: string
  /** 已解析或正在解析的媒体叶子；用于精确结束受影响的播放器与导出。 */
  trackIds?: readonly string[]
  error: AppErrorState
}

/** Renderer capabilities; credentials and platform sessions stay behind these ports. */
export interface WorkbenchRuntime {
  playlistCovers?: PlaylistCoverCache
  resourceCache?: ResourceCachePort
  resolveArtwork?: RemoteImageResolver
  /** Runtime interruptions cancel playback; becoming available never replays it. */
  playbackEnvironment?: {
    /** Use the media element when the runtime's focus owner cannot govern Web Audio. */
    preferMediaElement: boolean
    isBlocked(): boolean
    subscribeInterruption(listener: () => void): () => void
  }
  externalPlugins: ExternalPluginPolicy
  nativePluginAuthority?: NativePluginAuthorityPort
  loadMusicCreation?: () => Promise<MusicCreationImplementation>
  loadTagManagement?: () => Promise<TagManagementImplementation>
  uiThemes?: readonly UiThemeDescriptor[]
  /** Application build-owned complete roots/resources; storage never supplies loaders. */
  themes?: ThemeApplicationComposition
  protectedStyles?: string
  /** Trusted build directory only; external installation and native authority are separate stages. */
  modules?: {
    runtime: ModuleRuntime
    form: ModuleForm
    directory: readonly ModuleDescriptor[]
    features?: readonly ModuleDescriptor[]
  }
  storage: StableValueStorage
  http: HttpClient
  builtInMusicSources: readonly MusicSourcePlugin[]
  configureProxy(settings: NetworkProxySettings): void
  openLogin(url: string, platformId: string): void
  prepareMedia?(track: Track, source: ResolvedMediaSource): Promise<ResolvedMediaSource>
  saveBlob?(
    blob: Blob,
    fileName: string,
  ): Promise<{
    fileName: string
    sizeBytes: number
    sha256?: string
  } | void>
  /** Exact filename and complete content verification in the current native directory. */
  verifyDownload?(file: DownloadedFileSummary, signal: AbortSignal): Promise<boolean>
  downloadScheduler?: DownloadScheduler
  canHide?: boolean
  subscribeSourceInvalidation?(listener: (event: SourceInvalidation) => void): () => void
}

let runtime: WorkbenchRuntime | undefined

/** One workbench per renderer; configuration precedes Vue/Pinia state creation. */
export function configureWorkbenchRuntime(value: WorkbenchRuntime): void {
  runtime = value
}

export function getWorkbenchRuntime(): WorkbenchRuntime {
  if (!runtime) throw new Error('Music workbench runtime has not been configured')
  return runtime
}
