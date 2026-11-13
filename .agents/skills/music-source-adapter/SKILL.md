---
name: music-source-adapter
description: Add or diagnose Any Music portable source protocols, lazy listings, sessions and media resolution shared by Userscript and Tauri. Use for source or playback behavior; runtime transport follows the matching runtime skill and presentation-only changes use UI delivery.
---

# Any Music Source Adapter

Implement the requested source behind `MusicSourcePlugin`, preserving stable identity, lazy work and cancellable playback. Follow explicit user directions and root validation rules.

## Locate the boundary

Read the target guides and relevant sections of [source architecture](../../../docs/en/cross-platform/architecture/music-source-plugin-architecture.md) and [errors](../../../docs/en/cross-platform/architecture/error-and-state-model.md).

Identify userscript, tauri or shared scope from the task and call chain before choosing transport. For GM/host bindings read [userscript runtime](../any-music-userscript-runtime/SKILL.md); for IPC/Rust/account bindings read [Tauri runtime](../any-music-tauri-runtime/SKILL.md). Read only the affected runtime; shared-only changes keep transport injected. Cross-runtime work verifies each implementation separately.

- Formal protocols, signing, DTOs, URL recognition and mapping: `packages/plugin-source-bilibili/src` or `packages/plugin-source-douyin/src`.
- Generic identity/lifecycle and music registration: `packages/plugin-center` and `/music-sources`.
- Music models, error states and ports: `packages/core`; generic recipes/timelines/prefetch: `packages/audio-composition`.
- Userscript GM HTTP, cookies, device state and page signing/fallback: apps/userscript/src/platform. Tauri renderer IPC adapters: apps/tauri/src/platform; actual HTTP, account cookies, native login and media grants: apps/tauri/src-tauri. Inject runtime capabilities; do not read host/WebView fetch from portable adapters.

## Implement one vertical slice

Use existing sanitized contracts and deterministic fixtures first. A changed endpoint or signature may need recapture: use `$bilibili-contract-capture` or `$douyin-contract-capture` only when live browser work was explicitly requested. Otherwise report the contract as unverified instead of opening a browser or updating captureDate.

Keep descriptor metadata and exact import scopes readable before loading the implementation. Validate URLs locally and retry failed dynamic imports. Use stable source/part IDs; videos can supply audio. Expose large listings through `TrackListing.pages()` with one page per consumer step and no work after consumption stops.

Resolve current media descriptors immediately before playback; include only small required API calls. Send built-in calls through injected HTTP with included credentials. Userscript uses externalPlugins: none. External catalogs use verified native installation/grants and named ports, and currently provide no media resolution. Declarative API gateways can declare host-owned authentication; follow [Music Source Authentication](../../../docs/en/desktop/source-authentication.md) for account-bound paging, configuration fingerprints and the native credential boundary. See the [S15 capability matrix](../../../docs/en/cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md) before changing external behavior. Add exact built-in @connect domains in affected userscripts; keep native IPC permissions and account transport in Tauri. Map auth failures to expired sessions and operational failures to AppErrorState, retaining upstream details only as local causes.

For media transport, seek, custom songs or catalog loading changes, read [playback constraints](references/playback.md). Never persist short-lived URLs or media bytes in product snapshots; disposable bytes belong only in the separate bounded runtime resource cache. Render cross-host artwork through the owning UI's no-referrer component.

## Verify

Cover stable IDs, rejected URLs without network work, missing fields, pagination stop, session expiry, media unavailability and retry. For playback, test request counts/order, bounded overlap, cancellation and fallback selection; avoid public-network timing thresholds.

External catalog tests cover native admission, page cancellation and explicit media unavailability. Built-in protocol tests belong to their source packages, lifecycle races to plugin-center, and runtime composition to the application.

Run target tests/typecheck and root gates. Synchronize Chinese/English behavior documents. If live playback was requested, record descriptor resolution, media assignment/first playable bytes, playing and custom-leaf transitions in the requested runtime. For Userscript compare source and unrelated hosts; for Tauri verify native account/IPC/grant transport. Website capture is protocol evidence, not GM or Rust acceptance. Otherwise report omitted live checks without updating captureDate.
