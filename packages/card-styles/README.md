---
runtimeScope: shared
---

# Collection card styles

Reusable item presentation for complete themes, independent of dialogs and business operations.

- `@any-music/card-styles` exposes lightweight style metadata and pure playback-progress normalization.
- `@any-music/card-styles/vue` exposes `MinimalTrackCard`, `CoverPlaylistCard`, readonly player projections and named playback intents.
- Register each additional style in the lightweight metadata and `resolveCardStyle` renderer map, and extend the public style ID/validated preference contract. All complete themes share this registration rather than adding per-theme style branches.
- Themes supply props and handle named intents. The workbench owns media, task identities, ordering and runtime-namespaced preferences. Cards never persist data or create media timers.
- Minimal music covers show a waveform for the actual playing track and emit pause; paused covers emit play, with themes resuming the current track through the existing player action. Operator selection always takes precedence, including for playing or invalid tracks.
- The separate UI display dialog accepts extensible categories; it does not depend on this package. Whitespace (`留白`) is the default item style. Inline actions (`直显`) remain theme-owned. Discover search/import requests use one theme-owned default layout without a style selector. Playlists use one controlled cover card with arrangement choices and no style selector.
- Scoped SFC styles enter both runtime presentation surfaces through the build-owned resource collector. Use semantic tokens, no-referrer artwork and keyboard/touch/reduced-motion alternatives.

Run `pnpm --filter @any-music/card-styles test` and `pnpm --filter @any-music/card-styles typecheck` from the repository root. Node tests establish controlled contracts only; live layout and input acceptance require separately requested product inspection.
