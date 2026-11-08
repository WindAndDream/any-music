---
documentType: feature-design
runtimeScope: shared
---

# Local Library, Custom Tracks, and Plugins

Chinese counterpart: [本地资料库、自定义歌曲与声明式插件](../../../zh-cn/跨平台/功能设计/本地资料库与自定义插件.md).

Scope: shared library, recipes and declarative sources. Workbench stores business key suffixes through a stable-value port; Userscript adds any-music:userscript:* GM namespaces, desktop uses separate snapshots and a Rust product.json mirror. Credentials/proxy secrets belong to runtime storage, not product snapshots. Do not merge runtimes implicitly.

## 1. Product ownership

Host records, tag associations and creation drafts have separate owners. Current generation storage is initialized before mounting; named repository ports read and write `core`, `host` and `namespaces`. The library accepts schema 6 and downloads schema 2, with no previous-layout conversion. See [data ownership](../architecture/plugin-data-ownership.md).

## 2. Tags, Favorites, Playlists, and Materials

The built-in `plugin-music-creation` owns both Custom Music and Segment Creation through one `feature.composer` switch. The current build sets `unavailableReason`: the module starts disabled and cannot activate, enable or load its editing implementation, including through recovery/retry. Clicking Enable displays the configured development message in the shared top notice. Materials, drafts and published works are retained; host playback/download of works already referenced elsewhere remains available. When a future build removes the gate, both sections share the same enablement lifecycle and stable navigation IDs, ordering and visibility preferences. Other build-owned modules can supply their own reason independently of display-only `developmentStatus`.

The built-in plugin-tag-management exclusively owns user tags in feature.tags. Writes enforce NFKC, whitespace, length and case-insensitive deduplication. Enabled sessions project editing/search/filter/sort behavior into library views; disablement preserves data and withdraws projections, and dormant conditions need explicit restoration. Source labels remain core metadata.

User playlists use `playlist:<uuid>` IDs and store ordered stable track IDs. Platform collections remain `TrackListing` values and are never mixed with local playlists. Favorites and playlists share the tag namespace projection and support multi-select operations, including adding tracks to a playlist, downloading, unfavoriting, or removing visible queue items.

Material collections use `material-collection:<uuid>` IDs. Every direct source in one custom recipe must belong to the selected collection. Custom tracks may themselves be materials and are flattened only during compilation. Deletion rejects downstream references and only removes source records that are no longer used by Favorites, playlists, another collection, another recipe, or the pending-material inbox.

## 3. Playback and Download History

Selecting a track creates a playback-history entry; progress updates are throttled to one injected-storage write per second. The user can retain between 1 and 500 entries. Lowering the limit immediately removes the oldest entries, and the storage boundary enforces the same hard maximum.

The listen-later queue uses a separate playback-queue:v1 snapshot with a runtime-owned prefix/backend containing stable track IDs, order, and playback mode. Temporary Favorites playback contexts, the current position, shuffle bags, and media URLs are session-only.

Music Lists, Listen Later, Favorites, and individual playlists can start a managed download batch. One application-level manager applies a 1-5 worker limit, retries each song at most three times, and can cancel one song or the whole batch. Downloads unifies active tasks and saved records, with status selectors, per-song actions, pause/resume and retry. A single success saves MP3 directly; a multi-track batch triggers one ZIP save containing every successful MP3 and a JSON report.

Permanent download history is stored separately under download-history:v1 with a runtime-owned prefix/backend. It records origin, timing, concurrency, complete `Track` snapshots, every attempt and managed error, cancellation/interruption, and generated file metadata. It never stores media bytes, ephemeral URLs, the Blob, or the user's final disk path. A refresh converts unfinished work to `interrupted` without losing completed attempts. Downloaded tasks remain in Downloads; confirmed record removal preserves saved files. Paused tasks restart media resolution when resumed. Byte-range continuation, track priority changes and automatic continuation after refresh remain unimplemented.

## 4. Custom Track Compilation and Native Playback

Recipes use source-track milliseconds:

```ts
interface SegmentRecipe {
  sourceTrackId: string
  startMs: number
  endMs: number
}
```

Saving validates ranges, recursively expands nested custom tracks, detects cycles, maps intervals to ordinary platform leaves, merges adjacent continuous leaves, and produces a virtual prefix timeline. Repeated sub-recipes are cached, and interval slicing uses binary search to avoid re-expanding unrelated leaves.

Custom-track playback first divides compiled leaves into bounded chunks, prepares the current window and several following chunks concurrently, and schedules them against one audio clock. An in-window seek reuses buffered data; an out-of-window seek cancels the old session and rebuilds from the target chunk, with only the latest rapid seek allowed to take ownership. A source without Range support falls back to the ordinary playback path while later ephemeral descriptions can be prepared. Resolvers that read `complete-binary` are excluded before background prefetch. A cancellable session MP3 render is allowed only after leaf streaming paths fail. Ephemeral URLs, media bytes, decoded buffers, rendered output, and Blob URLs remain session-only. Export uses the same leaf recipes, streams normalization to 48 kHz stereo, and supports 192 kbps MP3 plus 16-bit PCM WAV.

Each unique source is resolved/read once per export through injected GM or Rust HTTP/media grants, retaining its built-in account identity. S15 catalogs lack media resolution and provide no download fallback. Media, generated bytes and URLs stay in the current session.

## 5. Native plugin packages

Tauri previews and installs verified `.amplugin` packages through explicit native consent and exact target admission. Static/code catalogs expose paged metadata and currently lack media resolution. Code catalogs use anonymous bounded native HTTPS, without account cookies/proxies. Userscript supports built-ins only. See the [S15 matrix](../architecture/plugin-system-s15-tools-and-desktop-delivery.md) and [runtime policy](../architecture/plugin-runtime-policy.md).

## 6. Runtime Settings

Tauri registers `feature.external-sources` as the optional built-in “外置音乐源” plugin. Its switch in the plugin center uses the existing module preferences and safe-start recovery. When enabled and a native package port exists, Settings → Music Sources exposes “外置音乐源” with public HTTPS package-address and local `.amplugin` file imports, plus native previews, consent and installed-package management. Files are limited to 16 MiB; addresses must return a standard package, and source packages declare `music.sources`. Native validation and target admission still decide which operations are available; Android's port remains preview-only.

Disabling the feature removes that settings entry and the “外置音乐源” group in source management, unmounts visited import forms, discards transient previews and cancels pending commands/catalog pages. Installed packages, grants and product records remain stored; re-enabling registers the current native catalog snapshot without replaying queries. Userscript has no external-source module or import entry because its external policy remains `none`.

Shared settings persist history limits and download concurrency. The following single-proxy configuration applies only to Userscript; desktop accounts/proxies follow [desktop rules](../../desktop/development.md). Proxy values are validated before storage and converted to Tampermonkey-specific fields only inside the GM HTTP adapter. Credentials stay in the current script's GM storage and never appear in domain models, errors, logs, or download reports. Saving a proxy does not imply that the browser and userscript manager support or can reach it.

## 7. Verification

Cover current-schema validation and damaged records, independent tag/creation ownership, portable-data conflicts and quotas, every-write interruption/recovery, source lifecycle races, recipe compilation and media cancellation. Download tests cover concurrency, retry, cancellation and refresh interruption. Native package tests preserve consent, budgets and revocation independently of product data. Live GM/IPC/playback checks require an explicit inspection request.
