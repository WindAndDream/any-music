import type { MusicSourcePlugin } from '@any-music/core'
import { LazyMusicSourcePlugin } from '@any-music/plugin-center/music-sources'

import { gmHttpClient } from '@/platform/http/gm-http-client'

import { builtInSourceDirectory } from './built-in-source-directory'

/** The host source comes first; implementations load only after explicit source use. */
export const builtInMusicSources: readonly MusicSourcePlugin[] = builtInSourceDirectory
  .toSorted(
    (left, right) =>
      Number(right.host === window.location.hostname) -
      Number(left.host === window.location.hostname),
  )
  .map(
    (source) =>
      new LazyMusicSourcePlugin({ ...source, loadPlugin: () => source.loadPlugin(gmHttpClient) }),
  )
