import { GM, GM_openInTab } from '$'
import { configureWorkbenchRuntime } from '@any-music/music-workbench'
import { createPlaylistCoverCache } from '@any-music/music-workbench/storage'

import { builtInMusicSources } from '../features/music-sources/built-in-music-sources'
import { builtInThemes, protectedStyles } from '../features/plugins/built-in-themes'
import {
  builtInWorkbenchModules,
  builtInFeatureModules,
  loadTagManagement,
  loadMusicCreation,
  builtInUiThemes,
} from '../features/plugins/built-in-workbench-modules'
import { gmHttpClient, gmHttpTransport, configureGmHttpCache } from './http/gm-http-client'
import { configureGmHttpProxy } from './http/gm-proxy'
import { createGmProductStorage } from './product-storage'
import { createGmResourceCacheRuntime } from './resource-cache'

/** Retain the existing product namespace and the host browser's single account. */
export async function configureUserscriptWorkbench(): Promise<() => Promise<void>> {
  const storage = await createGmProductStorage()
  try {
    const cache = createGmResourceCacheRuntime(gmHttpTransport, configureGmHttpCache)
    storage.onDispose(cache.dispose)
    const playlistCovers = createPlaylistCoverCache({
      read: () => GM.getValue('any-music:userscript:playlist-covers:v1'),
      write: (value) => GM.setValue('any-music:userscript:playlist-covers:v1', value),
    })
    storage.onDispose(playlistCovers.dispose)
    configureWorkbenchRuntime({
      playlistCovers,
      resourceCache: cache.port,
      resolveArtwork: cache.resolveArtwork,
      themes: builtInThemes,
      protectedStyles,
      externalPlugins: 'none',
      loadTagManagement,
      loadMusicCreation,
      uiThemes: builtInUiThemes,
      modules: {
        runtime: 'userscript',
        form: 'desktop',
        directory: builtInWorkbenchModules,
        features: builtInFeatureModules,
      },
      storage,
      http: gmHttpClient,
      builtInMusicSources,
      configureProxy: configureGmHttpProxy,
      openLogin: (url) => {
        GM_openInTab(url, { active: true, insert: true })
      },
      canHide: true,
    })
  } catch (error) {
    configureGmHttpCache()
    await storage.dispose().catch(() => {})
    throw error
  }
  return storage.dispose
}
