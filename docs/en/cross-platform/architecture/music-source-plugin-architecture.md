---
documentType: architecture
runtimeScope: shared
---

# Music Source Plugin Architecture

Chinese counterpart: [音乐源插件架构](../../../zh-cn/跨平台/架构/音乐源插件架构.md).

Scope: shared source and media contracts. Transport is implemented by [Userscript GM](../../userscript/development.md) or [desktop IPC/Rust](../../desktop/development.md), without runtime detection in portable protocols.

## 1. Goals

A built-in music source translates discovery/playback into Any Music’s unified domain. Protocols and tests belong to each plugin-source-* package, without owning product UI. Userscript and Tauri consume them through separate transport/storage and optional page ports. Section 9 defines current S15 external catalog limits.

## 2. Layers

### Built-in distribution

| Target        | Built-in sources                      |
| ------------- | ------------------------------------- |
| Userscript    | Bilibili, Douyin, NetEase Cloud Music |
| Tauri desktop | Bilibili, Douyin, NetEase Cloud Music |
| Tauri mobile  | Bilibili                              |

Each source package exports lightweight `*_BUILT_IN_TARGETS`. Application directories bind this explicit target list to metadata, URL preflight, module construction and runtime factories. `selectBuiltInSources` rejects duplicate provider IDs and selects before constructing instances. An omitted target grants no distribution; adding a source must declare its targets. Native composition uses `runtime_capabilities.form`, never viewport width or the user agent. Source lists, plugin modules, account choices and account switching consume the same selected directory. Unavailable transport retains only that target's metadata; saved tracks and recipes keep their source identities without enabling an unsupported source. Native account admission is checked independently in Rust.

Mobile distribution does not imply equal native capabilities: Android provides Bilibili QR handoff and account HTTP; iOS authentication and mobile media remain unavailable. Douyin and NetEase are excluded from mobile source/module/account registration until its own native adapter is implemented and verified.

```text
Vue components
  ↓ only use Track / TrackListing / Session / ResolvedMediaSource
Application features and composables
  ↓ MusicSourcePlugin
Platform plugins (URLs, signing, raw types, endpoints, mappings)
  ↓ ports such as HttpClient / Storage
Runtime adapters (Userscript GM HTTP / Tauri IPC → Rust HTTP)
```

- `packages/core`: Track, public source contracts, error states, media policies and music recipe adapters.
- `packages/audio-composition`: independent recipes, timelines and browser codecs.
- `packages/plugin-center`: headless registration, availability and lazy loading.
- `packages/plugin-source-*/src`: portable product source protocols, signing, DTOs and mapping.
- `apps/userscript/src/platform/music-plugins/<platform>`: host cookies/signing/page bridges; apps/tauri/src/platform: IPC ports; src-tauri: native HTTP/accounts/login.

See [Reusable Package Boundaries](reusable-package-boundaries.md).

- `apps/*/src/features/music-sources`: runtime source construction; shared registry/session/listing composition lives in packages/music-workbench/src/features.
- `packages/music-workbench/src/features/player`: source-independent queues and media orchestration, with injected transport/media preparation/saving.
- Components only emit intentions such as search, import, play, and enqueue; they must not construct third-party URLs.

Directories are named by responsibility rather than by their first source. Code such as `useTrackCatalog`, `usePluginSession`, and `usePlaybackQueue` consumes only core contracts and must not live under `features/bilibili` or `features/douyin`. Only API paths, signing, raw types, platform URL recognition, and field mappings retain platform-specific directory names.

### 2.1 Descriptors, Availability, and Lazy Modules

`MusicSourceDescriptor` is stable metadata that can be read without executing a platform implementation. It contains the ID, name, built-in/external provenance, capabilities, and exact import URL scopes. URL imports are rejected locally before a drawer or request is created. Built-in sources use `LazyMusicSourcePlugin` so signing code, DTOs, APIs, and media logic load only when a session, listing iterator, or playback action first needs them. A successful module is reused; a rejected import is cleared so a later action can retry.

Registered sources expose `unchecked/checking/available/invalid/unavailable` availability states. Only an explicit negative response is `invalid`; transport or protocol failures remain retryable `unavailable` states. Enabled sources that have not passed the check cannot search or import, while existing drawer recipes remain paused instead of being deleted.

## 3. Stable Identity and Ephemeral Media

The recommended `Track.id` format is `<plugin>:<kind>:<resource>:<part>`. `Track.source` stores only:

- the plugin ID;
- the video, audio, or custom media kind;
- a stable platform resource ID;
- an optional part or chapter ID;
- an optional original page URL.

A `ResolvedMediaSource` is generated for every playback attempt. Remote media results include ephemeral URLs, fallback nodes, MIME type, codec, duration, loading strategy, the selected quality, and the available qualities ordered from highest to lowest. Small media explicitly declared as `complete-binary` includes bytes, a MIME type, and one rendered quality for the current session. Quality IDs, ranks, and both media forms are runtime values and must never be persisted. A runtime may inject an idempotent ephemeral `release()` holding account usage and loopback media grants. Playback releases it after track changes/disposal; export releases it after reading succeeds, fails or is cancelled; custom-song prefetch releases it on loader disposal. Cancelled or losing resolved descriptors also release it. The callback never enters recipes or storage.

Runtime-owned disposable [resource caches](../features/resource-cache.md) may retain bounded artwork/media bytes independently of product storage. They never persist resolved descriptors/URLs or replace current account/grant validation and native-first startup.

## 4. Lazy Listings

`TrackListing.account` may expose the actual request account's public ID, platform username, and custom name. Multi-account runtimes populate it after the first lazy page chooses an identity; the workbench rereads it instead of substituting the currently selected account. The workbench retains the first successful page’s public ID and names with the cached result, separately from live account status and request routing. Continuing with another account preserves that origin; an explicit refresh selects a new origin. Credentials and live account state are never persisted. Details add no session requests. Single-host-account runtimes may capture their known identity when a request starts.

Searches, collections, creator uploads, and favorites all return a `TrackListing`. Its `pages()` method is an async iterator, and every `next()` call loads exactly one page:

The workbench tracks list-runtime membership reactively. A synchronous view may read a newly published recipe before its runtime is inserted; insertion must refresh the view and subsequent page results. Missing runtime state alone never means the source was uninstalled: that status requires the source registry to lack the provider ID. The initial login-state probe waits for source-module activation, so startup cannot cancel its own probe; disposal before startup completes prevents that request.

A runtime may inject cancellable `verify()` into a live listing, bound to the account that actually failed. This capability is never persisted in recipes; shared packages do not choose browsers or transports. The error panel exposes the user-initiated action only for `verification-required`. On success the workbench reuses the same listing and reloads from page one. Sources without this capability retain the source-page link and manual retry.

```ts
for await (const page of listing.pages()) {
  render(page.items)
  if (userStopped) break
}
```

Stopping iteration means stopping consumption; the application must not continue fetching the entire collection in the background. Each page also reports its page number, page size, optional total, and `hasMore`. Bilibili page-number pagination must stop on an empty page or when `hasMore=false`. Douyin cursor pagination must additionally stop when the cursor does not change, preventing a malformed response from causing an infinite loop.

Discovery retains stable track metadata, loaded-page counts, totals, errors and optional `TrackPage.continuation` positions in the workspace snapshot. Reopening, restarting, changing filters or submitting the same source/kind/input reuses these results; displaying an unfiltered short list can request further pages. When an idle list is suspended by source-module startup, disablement or source-wide invalidation, its old reader closes but cached results remain: the next load binds a fresh listing through the current source and resumes its saved position. Completed lists stay complete; a missing or rejected position preserves the rows and requires explicit Refresh. Discovery fills unfiltered short lists one page at a time until the scroll area is filled or the source ends; downward scrolling admits subsequent pages without a Load More button; explicit Refresh recreates the original request from page one. Tracks are deduplicated by stable ID, including when platform rankings change between pages.

Continuation contains only a next page number or numeric cursor. Bilibili listings expose page positions; Douyin search retains its actual returned cursor rather than reconstructing it from the number of displayed songs. Public Douyin cursor listings also expose positions. Private/self listings, flattened directory listings and external catalogs without an explicit continuation retain their results and require manual refresh after restart. A rejected/expired continuation preserves old results and stops automatic requests; it never replays earlier pages. These are adapter contracts covered by offline tests, not new website/GM/Rust acceptance evidence. Cached results are bounded to 10,000 tracks per list; damaged or truncated snapshots cannot reuse a continuation that would skip missing rows.

Playback-confirmed `not-found` / `source-not-found` failures retain an unavailable marker by stable track ID across lists and restarts. Network, timeout, authentication, verification, rate-limit, malformed-response and generic media failures do not permanently invalidate a track. Successful playback removes its marker. Media URLs, bytes, account leases, cookies and verification capabilities never enter the snapshot; every playback still resolves current media.

## 5. Session State Machine

Plugins expose five stable states:

- `not-required`: the plugin does not require an account session;
- `signed-out`: the user is definitely signed out;
- `signed-in`: the user is signed in, with a minimal user summary;
- `expired`: the UI previously showed a signed-in state, but a business request reported invalid authentication;
- `unavailable`: a network, platform, or response failure prevents the plugin from inferring authentication state.

UI `loading` is a request-process state and does not belong in the domain session. When any business request receives a signed-out error, the plugin should transition a cached `signed-in` state to `expired`, then let the user decide whether to open the login page.

See [Error and State Model](error-and-state-model.md) for shared error and persistence rules. Source adapters map upstream failures to the shared catalog while retaining HTTP status, platform codes, and raw response context inside the adapter.

## 6. Media Loading

- `eager`: short content may be preloaded aggressively by the browser; it still uses remote media and does not imply persisted bytes.
- `range`: long content loads metadata only and relies on HTTP Range requests from the media element for on-demand seeking.

The plugin only declares a policy. The player decides the `preload` value, fallback URL switching, and failure presentation. For Bilibili videos, request DASH first and select an audio representation without downloading the video track. For ordinary Douyin videos, prefer the full work audio so background music is not mistaken for the complete soundtrack; photo posts use the work's music. Media with no custom headers or only a Referer first receives a native streaming attempt. A cross-site Referer becomes `no-referrer`, while same-site playback preserves the browser default. If native loading fails, or the source requires another custom header, the player uses injected HTTP Range reads and Mediabunny to remux encoded audio into fragmented media so the native `<audio>` element still owns pause, seek, and playback-rate behavior.

When a Range request is redirected into an oversized complete response, the runtime transport aborts at the headers and lets the current reader retry the ephemeral final CDN URL directly; that URL is never persisted. Backup nodes are hedged at 250 ms intervals through retrieval of the first encoded audio packet, rather than merely container recognition, and losing probes are cancelled. Negative AAC preroll timestamps in Douyin MP4 files are shifted onto a zero-based muxing timeline without decoding or re-encoding. MSE backpressure retains about 30 seconds ahead of the playhead and 15 seconds behind it, pausing background reads and evicting consumed ranges instead of filling SourceBuffer with an entire long track. A seek inside that retained window updates the native clock directly. A seek into an evicted or not-yet-produced interval aborts the old session, starts a new Range/MSE stream at the target audio packet, and restores the pre-seek playing or paused state. Native-control dragging is briefly debounced, and a later seek invalidates the earlier asynchronous read. The total first-fragment startup budget is five seconds. A timeout or wholly unavailable Range input skips the duplicate full-track extraction pass and proceeds to complete-media fallback; an explicitly rejected MSE codec may still use a session-scoped audio-only Object URL. A longer timeline above the native controls displays the target time to 0.1-second precision on hover and applies the same direct-seek or stream-rebuild policy when committed.

The player omits `qualityId` on the initial resolution, which requires the plugin to select its highest currently available quality. A user switch resolves a fresh ephemeral URL for the requested candidate, then preserves the current position and playing/paused state; a failed switch leaves the old media active. Shared UI never invents platform ordering or labels. Adapters validate requested IDs and prefer structured bitrate, quality, gear, and codec fields, fall back to verifiable URL extension or bitrate hints, and only then use labels such as “Quality 1” and “Quality 2.”

The shared Range reader permits at most three HTTP requests across concurrent reads and size probes, with chunks of at most 2 MiB. A failed read cancels its sibling chunks before queued work can start, while independent reads can continue. Every 206 response must match the requested interval, body length and a consistent total size. Failed size probes can be retried; cancellation rejects late responses and cached reads, and disposal clears session caches. Complete-file loading also checks cancellation after HTTP settlement before returning bytes.

GM fetch/XHR timeout and single-proxy details belong to [userscript rules](../../userscript/development.md#gm-transport-and-proxy-details). Desktop uses [IPC/Rust HTTP and account media grants](../../desktop/development.md), without GM proxy or host-page state.

## 7. Cross-Site Images

Track covers are display resources and do not participate in platform API requests, but a normal `<img>` sends the current host page as its Referer by default. Showing a Bilibili `i*.hdslb.com` cover on a Douyin page can therefore trigger Bilibili CDN hotlink protection and return 403.

All third-party covers are rendered through the shared UI's `RemoteImage` component:

- use `referrerpolicy="no-referrer"` so the current host is not disclosed to the image source;
- retain native browser caching and lazy loading instead of converting covers into persisted binaries;
- show a stable placeholder on failure so a platform error cannot break the layout;
- do not store Bilibili, Douyin, or other domain policies in `Track`, and do not branch on `pluginId` inside the shared component.

If a future platform refuses requests even without a Referer, add a size-limited runtime resource-loading port (Userscript GM / Tauri native) that produces revocable Object URLs at the runtime layer. Do not put `GM_*` directly in shared UI.

## 8. Custom Track Recipes

The implemented recipe uses milliseconds:

```ts
interface SegmentRecipe {
  sourceTrackId: string
  startMs: number
  endMs: number
}
```

When a custom track is clipped again, recursively flatten its recipe before saving: map intervals through custom-track references to leaf media, use a visitation stack to detect cycles, and merge adjacent continuous segments from the same source. Virtual duration is the sum of all segment lengths. Map the playhead to a segment with prefix sums or a binary-search index. A prefix-sum array is sufficient at normal scale; consider a Fenwick tree or another dynamic structure only when many segments and frequent edits occur together.

Custom-track playback must not download every complete leaf and render the whole output before it can start. The default path divides the compiled leaf timeline into range-decoded chunks of at most four seconds without crossing source boundaries. Before playback, it prepares at least three seconds and at most three contiguous chunks, while three workers continue decoding a rolling twenty-second look-ahead window into session-only PCM. A run of one-second fragments therefore occupies the prefetch slots concurrently instead of starting resolution at each join. AudioContext schedules every contiguous ready chunk on one clock, so boundaries no longer depend on a low-frequency `timeupdate` event switching URLs at the last moment.

Range prefetch reads only the media intervals needed by the target chunks. Ephemeral descriptors and decoded buffers live only for the playback session; rejected promises are removed immediately, and seek, track switch, or unmount aborts old reads and rebuilds the window around the new playhead. If a source rejects Range, the browser cannot decode it, or prefetch fails, the player preserves the virtual position and falls back to one native `<audio>` streaming one leaf at a time. That path still resolves lightweight descriptors over a ten-second look-ahead window, capped at twelve chunks and three workers. In-leaf seeks move the native clock directly, while cross-leaf seeks lock the requested position and playback intent until the target media clock takes control. Primary URL, backup-node, and runtime HTTP Range/MSE fallback ordering remains identical to ordinary-track playback.

Only after every streaming path for a leaf fails does the application render a session-only MP3 with Mediabunny and hand its temporary Object URL to native `<audio>` as a compatibility fallback. Switching tracks aborts an unfinished fallback render. Source bytes, rendered bytes, Blob URLs, and ephemeral media URLs never enter the library, and downloads continue to use the complete export pipeline.

## 9. Custom Plugin Boundary

S15 .amplugin code/static catalogs require native validation, consent and exact target admission. They yield catalog pages on demand, currently without media resolution or guest artwork/page URL loading. Their schemaVersion values belong to different protocols and are not interchangeable.

### 9.1 Unified sources and unavailable media capabilities

Built-in music.sources implementations and native-verified external catalogs enter the same picker. Unprovided media/extensions below remain target requirements, not enabled features:

- Keep internal MusicSourcePlugin/TrackListing; external boundaries carry DTOs, listing references, next/close/cancel and bounded resource references, restored by trusted adapters.
- Request one page per consumption; stopping, revocation or generation replacement ends old work. Model enablement/installation/availability/session separately and preserve source/track IDs.
- Inject trusted built-in runtime ports separately; external networking uses the anonymous native Gate. Native grants recheck selected-data sensitivity.
- Future media/artwork/Range/downloads must bind identity, epoch, budgets and revocation instead of handing URLs to WebView. Preserve descriptor/native/Range-MSE/complete-fallback order and leaf budgets. Missing media is currently unavailable.

Negotiate wire/Profile/contribution/data versions separately. Automated checks cover paging, request counts/order, cancellation, late-result rejection and explicit media unavailability; GM, Rust and device playback require separate evidence.

## 10. Extension Checklist

Use `$music-source-adapter` when adding or revising a platform adapter. Use `$bilibili-contract-capture` to recapture Bilibili and `$douyin-contract-capture` to recapture Douyin. Verify stable IDs, missing fields, empty pages, unchanged cursors, private resources, expired authentication, multipart videos or photo posts, short and long media, fallback nodes, and cover display from a host page outside the source platform. The current contracts are documented in [Bilibili Web API Contract](../platforms/bilibili/web-api-contract.md) and [Douyin Web API Contract](../platforms/douyin/web-api-contract.md).

## Source ownership and cancellation

Bilibili and Douyin metadata, protocols, signatures, DTOs, mapping, pagination and tests now belong to plugin-source-bilibili / plugin-source-douyin. Roots expose only descriptors, local URL preflight and music.sources contributions; /runtime loads implementations lazily. Douyin /browser and /contracts keep optional browser capabilities separate from trusted types. Modules source.bilibili / source.douyin, providers bilibili / douyin and contributions source.*/provider are distinct; stored track/recipe IDs remain unchanged.

Applications compose plugin-source-* directly, preserving separate injected GM and account-bound Rust HTTP/CDP/grant ports. Source packages depend only on public core/plugin-center entries; workbench never imports concrete source implementations. Neither forwarding packages nor the source JSON interpreter are assembled.

The host registry owns generations, operation cancellation and media release. Disable, failure and policy/identity invalidation end old listings, resolution, prefetch and media. Workbench stops affected playback/exports while retaining records and queue order. Re-enabling never replays tasks; the next explicit pagination/retry builds a fresh listing. Zero usable sources caused by failure/policy do not rewrite switches or block core destinations. User attempts to disable the last configured source remain rejected.

## Runtime policy

Userscript fixes externalPlugins: none before construction and at enablement/command/media/prefetch boundaries. Built-in identity comes only from the build directory. Tauri derives policy from runtime_capabilities; native installation rejects unadmitted activation. See the [current runtime policy](plugin-runtime-policy.md) and [S15 delivery matrix](plugin-system-s15-tools-and-desktop-delivery.md).
