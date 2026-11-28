---
documentType: module-contract
runtimeScope: shared
---

# Stable source identity, media and artwork

[中文](../../../zh-cn/板块/音乐源/媒体解析与加载.md)

The workbench resolves a new media descriptor from the saved track identity for each playback attempt. The respective [runtime](README.md) owns transport.

## 3. Stable Identity and Ephemeral Media

The recommended `Track.id` format is `<plugin>:<kind>:<resource>:<part>`. `Track.source` stores only:

- the plugin ID;
- the video, audio, or custom media kind;
- a stable platform resource ID;
- an optional part or chapter ID;
- an optional original page URL.

A `ResolvedMediaSource` is generated for every playback attempt. Remote media results include ephemeral URLs, fallback nodes, MIME type, codec, duration, loading strategy, the selected quality, and the available qualities ordered from highest to lowest. Small media explicitly declared as `complete-binary` includes bytes, a MIME type, and one rendered quality for the current session. Quality IDs, ranks, and both media forms are runtime values and must never be persisted. A runtime may inject an idempotent ephemeral `release()` holding account usage and loopback media grants. Playback releases it after track changes/disposal; export releases it after reading succeeds, fails or is cancelled; custom-song prefetch releases it on loader disposal. Cancelled or losing resolved descriptors also release it. The callback never enters recipes or storage.

Runtime-owned disposable [resource caches](../resource-cache.md) may retain bounded artwork/media bytes independently of product storage. They never persist resolved descriptors/URLs or replace current account/grant validation and native-first startup.

## 6. Media Loading

Terminal playback errors use the top notice. Settings → Playback Settings offers **无法播放时自动跳过**, on by default. Both runtimes save an explicit off choice with the playback queue preferences. When enabled, the active queue or collection advances according to its playback mode, using the next song in list order if repeat-one fails. A run of failures attempts each song at most once and stops when the candidates run out. Preview failures only report the error. See [playback failure acceptance](../../changes/acceptance/playback-failure-feedback.md).

- `eager`: short content may be preloaded aggressively by the browser; it still uses remote media and does not imply persisted bytes.
- `range`: long content loads metadata only and relies on HTTP Range requests from the media element for on-demand seeking.

The plugin only declares a policy. The player decides the `preload` value, fallback URL switching, and failure presentation. For Bilibili videos, request DASH first and select an audio representation without downloading the video track. For ordinary Douyin videos, prefer the full work audio so background music is not mistaken for the complete soundtrack; photo posts use the work's music. Media with no custom headers or only a Referer first receives a native streaming attempt. A cross-site Referer becomes `no-referrer`, while same-site playback preserves the browser default. If native loading fails, or the source requires another custom header, the player uses injected HTTP Range reads and Mediabunny to remux encoded audio into fragmented media so the native `<audio>` element still owns pause, seek, and playback-rate behavior.

When a Range request is redirected into an oversized complete response, the runtime transport aborts at the headers and lets the current reader retry the ephemeral final CDN URL directly; that URL is never persisted. Backup nodes are hedged at 250 ms intervals through retrieval of the first encoded audio packet, rather than merely container recognition, and losing probes are cancelled. Negative AAC preroll timestamps in Douyin MP4 files are shifted onto a zero-based muxing timeline without decoding or re-encoding. MSE backpressure retains about 30 seconds ahead of the playhead and 15 seconds behind it, pausing background reads and evicting consumed ranges instead of filling SourceBuffer with an entire long track. A seek inside that retained window updates the native clock directly. A seek into an evicted or not-yet-produced interval aborts the old session, starts a new Range/MSE stream at the target audio packet, and restores the pre-seek playing or paused state. Native-control dragging is briefly debounced, and a later seek invalidates the earlier asynchronous read. The total first-fragment startup budget is five seconds. A timeout or wholly unavailable Range input skips the duplicate full-track extraction pass and proceeds to complete-media fallback; an explicitly rejected MSE codec may still use a session-scoped audio-only Object URL. A longer timeline above the native controls displays the target time to 0.1-second precision on hover and applies the same direct-seek or stream-rebuild policy when committed.

The player omits `qualityId` on the initial resolution, which requires the plugin to select its highest currently available quality. A user switch resolves a fresh ephemeral URL for the requested candidate, then preserves the current position and playing/paused state; a failed switch leaves the old media active. Shared UI never invents platform ordering or labels. Adapters validate requested IDs and prefer structured bitrate, quality, gear, and codec fields, fall back to verifiable URL extension or bitrate hints, and only then use labels such as “Quality 1” and “Quality 2.”

The shared Range reader permits at most three HTTP requests across concurrent reads and size probes, with chunks of at most 2 MiB. A failed read cancels its sibling chunks before queued work can start, while independent reads can continue. Every 206 response must match the requested interval, body length and a consistent total size. Failed size probes can be retried; cancellation rejects late responses and cached reads, and disposal clears session caches. Complete-file loading also checks cancellation after HTTP settlement before returning bytes.

GM fetch/XHR timeout and single-proxy details belong to [userscript rules](../userscript/development.md#gm-transport-and-proxy-details). Desktop uses [IPC/Rust HTTP and account media grants](../tauri/development.md), without GM proxy or host-page state.

## 7. Cross-Site Images

Track covers are display resources and do not participate in platform API requests, but a normal `<img>` sends the current host page as its Referer by default. Showing a Bilibili `i*.hdslb.com` cover on a Douyin page can therefore trigger Bilibili CDN hotlink protection and return 403.

All third-party covers are rendered through the shared UI's `RemoteImage` component:

- use `referrerpolicy="no-referrer"` so the current host is not disclosed to the image source;
- retain native browser caching and lazy loading instead of converting covers into persisted binaries;
- show a stable placeholder on failure so a platform error cannot break the layout;
- do not store Bilibili, Douyin, or other domain policies in `Track`, and do not branch on `pluginId` inside the shared component.

If a future platform refuses requests even without a Referer, add a size-limited runtime resource-loading port (Userscript GM / Tauri native) that produces revocable Object URLs at the runtime layer. Do not put `GM_*` directly in shared UI.
