import type { UiThemeDefinition } from '@any-music/ui/theme'

import StudioCatalog from './components/catalog/StudioCatalog.vue'
import StudioDownloads from './components/downloads/StudioDownloads.vue'
import StudioCustomTracks from './components/library/StudioCustomTracks.vue'
import StudioFavorites from './components/library/StudioFavorites.vue'
import StudioHistory from './components/library/StudioHistory.vue'
import StudioPlaylists from './components/library/StudioPlaylists.vue'
import StudioQueue from './components/library/StudioQueue.vue'
import StudioOverlays from './components/overlays/StudioOverlays.vue'
import StudioPlayer from './components/player/StudioPlayer.vue'
import StudioPlugins from './components/plugins/StudioPlugins.vue'
import StudioSettings from './components/settings/StudioSettings.vue'
import StudioNavigation from './components/shell/StudioNavigation.vue'
import StudioShell from './components/shell/StudioShell.vue'
import StudioComposer from './components/specialists/StudioComposer.vue'
import StudioTags from './components/specialists/StudioTags.vue'
import StudioRoot from './StudioRoot.vue'

/** Complete controlled Studio presentation; application production adoption belongs to T11. */
export const definition = {
  id: 'studio',
  contractVersion: 1,
  Root: StudioRoot,
  views: {
    shell: StudioShell,
    navigation: StudioNavigation,
    player: StudioPlayer,
    catalog: StudioCatalog,
    queue: StudioQueue,
    favorites: StudioFavorites,
    playlists: StudioPlaylists,
    'custom-tracks': StudioCustomTracks,
    history: StudioHistory,
    downloads: StudioDownloads,
    plugins: StudioPlugins,
    settings: StudioSettings,
    overlays: StudioOverlays,
    tags: StudioTags,
    composer: StudioComposer,
  },
} satisfies UiThemeDefinition
