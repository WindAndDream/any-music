import { createAsyncFeatureComponent } from '@any-music/ui'
import type { UiThemeDefinition } from '@any-music/ui/theme'

import ClassicRoot from './ClassicRoot.vue'
import ClassicDownloads from './components/downloads/ClassicDownloads.vue'
import ClassicCustomTracks from './components/library/ClassicCustomTracks.vue'
import ClassicFavorites from './components/library/ClassicFavorites.vue'
import ClassicHistory from './components/library/ClassicHistory.vue'
import ClassicPlaylists from './components/library/ClassicPlaylists.vue'
import ClassicQueue from './components/library/ClassicQueue.vue'
import ClassicCatalog from './components/music-sources/ClassicCatalog.vue'
import ClassicOverlays from './components/overlays/ClassicOverlays.vue'
import ClassicPlayer from './components/player/ClassicPlayer.vue'
import ClassicPlugins from './components/plugins/ClassicPlugins.vue'
import ClassicSettings from './components/settings/ClassicSettings.vue'
import ClassicNavigation from './components/shell/ClassicNavigation.vue'
import ClassicShell from './components/shell/ClassicShell.vue'
import ClassicComposer from './components/specialists/ClassicComposer.vue'
import ClassicTags from './components/specialists/ClassicTags.vue'
/** Complete classic theme; applications inject this root and scoped resources. */
export const definition = {
  id: 'default',
  contractVersion: 1,
  Root: ClassicRoot,
  views: {
    plugins: ClassicPlugins,
    tags: ClassicTags,
    composer: ClassicComposer,
    queue: ClassicQueue,
    favorites: ClassicFavorites,
    playlists: ClassicPlaylists,
    'custom-tracks': ClassicCustomTracks,
    history: ClassicHistory,
    downloads: ClassicDownloads,
    catalog: ClassicCatalog,
    shell: ClassicShell,
    navigation: ClassicNavigation,
    player: ClassicPlayer,
    settings: ClassicSettings,
    overlays: ClassicOverlays,
  },
} satisfies UiThemeDefinition

export { default as PlayerBar } from './components/player/PlayerBar.vue'
export { default as CatalogDrawer } from './components/music-sources/CatalogDrawer.vue'
/** Standalone controlled widgets retain their original lazy loading boundary. */
export const QueuePanel = createAsyncFeatureComponent(
  () => import('./components/music-sources/QueuePanel.vue'),
)
export const ActiveDownloadPanel = createAsyncFeatureComponent(
  () => import('./components/downloads/ActiveDownloadPanel.vue'),
)
