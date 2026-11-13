# Playback constraints

Read this reference when changing media resolution, transport, seek, custom songs or catalog loading. Shared player, Range/MSE and decoder orchestration belongs to music-workbench; generic window/prefetch algorithms belong to audio-composition. Actual transport is injected: Userscript uses GM HTTP, Tauri uses IPC/Rust and account-bound loopback media grants. GM-specific optimizations do not apply to Rust.

## Resolution and ordinary playback

- Keep ordinary resolveMedia descriptor-only: obtain current URLs, headers, MIME, duration, qualities and fallbacks through small APIs. Do not probe/download/decode/remux media there. Core also supports an explicit `complete-binary` result for small media; preserve that session-only contract without restoring the removed source JSON interpreter.
- Disposable bytes may enter the owning runtime's separate bounded [resource cache](../../../../docs/en/cross-platform/features/resource-cache.md). Never put cache bytes, temporary URLs or Blob URLs in product snapshots; cache hits retain current native account/grant checks and native-first startup.
- Loading uses eager/range. Prefer native streaming with no custom headers or only Referer, suppressing cross-host referrers at the media element. Tauri first prepares native media grants with account credentials/headers in Rust. Enter managed Range/MSE through injected HTTP after native failure or when other required headers prevent native playback; GM reads apply only to Userscript.
- Hedge backup nodes with bounded staggered concurrency until the first playable encoded packet; cancel losers. Apply a first-fragment budget, backpressure and track-switch cancellation. Do not serialize full timeouts or repeat known-failed Range/full extraction paths. Complete reads are the cancellable last fallback.
- Seek within the retained MSE window by moving the clock. Outside it, cancel the old session and rebuild from the target encoded packet without remuxing from zero. Keep a stable logical timeline and the selected playing/paused intent; only the newest rapid seek may take over.

## Custom songs

- Play compiled leaves without pre-rendering the complete result or downloading every original first. Prefer bounded Range-decoded chunks prepared with fixed concurrency and scheduled contiguously on one audio clock.
- When range prefetch is unavailable, reuse ordinary per-leaf transport and concurrently resolve a bounded look-ahead descriptor window. Exclude any complete-binary resolver before calling it in background prefetch.
- Descriptors and decoded buffers stay in the current session. Remove failed promises and abort reads on seek, track switch or disposal. Only after the leaf streaming paths fail may a cancellable session-level complete render be used.

## External catalogs

Current native catalogs expose paged metadata and do not resolve media. Do not synthesize media URLs or use generic HTTP as an unavailable-provider fallback. Built-in media resolution follows the owning GM/Rust transport, account identity, cancellation and lifetime contracts above.

## Evidence

Deterministic tests should prove small descriptor requests, native-first selection, bounded overlap, cancelled losers, no duplicate slow fallback, latest-seek ownership and rejection-cache removal. When live checks are explicitly requested, record descriptor resolution, media assignment/first playable bytes, playing and custom-leaf transitions in both locale platform contracts with the actual date and runtime. Identify webpage observation, GM or Rust evidence separately. Do not use public-network wall-clock speed as the sole assertion.
