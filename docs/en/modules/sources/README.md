---
documentType: module-contract
runtimeScope: shared
---

# Music source modules

[中文](../../../zh-cn/板块/音乐源/文档索引.md)

Source packages own upstream URL recognition, signatures, DTOs, pagination and mapping to `Track` and `TrackListing`. Workbench composes the registry, list sessions and playback from portable ports. UI emits search/import/play/download intents. [GM](../userscript/development.md) and [Rust/IPC](../tauri/development.md) own their transport, account context and media access.

| Runtime       | Built-in source directory                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Userscript    | Bilibili, Douyin, NetEase Cloud Music                                                                                           |
| Tauri desktop | Bilibili, Douyin, NetEase Cloud Music                                                                                           |
| Tauri mobile  | Bilibili. Android has native account and foreground media ports. See [mobile capabilities](../tauri/mobile.md) for exact scope. |

Applications select `*_BUILT_IN_TARGETS` using the runtime form and reject duplicate provider IDs before construction. Roots expose lightweight descriptors, capabilities, URL scopes and contribution metadata. An unsupported URL is rejected before a request. Lazy modules load on first use, cache success and clear failures for retry. Keep provider IDs such as `bilibili`, module IDs such as `source.bilibili`, contribution IDs such as `source.bilibili/provider`, and stored track IDs distinct.

The registry owns operation generations. Disablement, failure, policy or account change cancels old listings, resolution and media. Re-enabling preserves records and waits for an explicit new action. A failure leaving zero usable sources keeps core views available. The user cannot disable the last configured source. Userscript fixes `externalPlugins: none`; Tauri allows only native-verified projections and checks [runtime policy](../plugins/runtime-policy.md).

| Detail                                                             | Read                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Availability, lazy pages, saved continuations and cancellation     | [Listings and sessions](listings.md)                                                                                              |
| Stable identities, descriptor/native/Range/MSE startup and artwork | [Media](media.md)                                                                                                                 |
| Custom track bounded leaf scheduling                               | [Custom recipes](../library/custom-tracks.md)                                                                                     |
| Endpoint fields and web observations                               | [Bilibili](bilibili/web-api-contract.md), [Douyin](douyin/web-api-contract.md), [NetEase Cloud Music](netease/api-integration.md) |
| Native built-in login and embedded pages                           | [Tauri runtime](../tauri/runtime.md), [source page sessions](../tauri/source-page-sessions.md)                                    |
| Native account binding for external source gateways                | [Music source authentication](../tauri/source-authentication.md)                                                                  |

Use `$music-source-adapter` for protocol/playback changes. Verify request count, order, concurrency, cancellation, retry and provider-specific empty/error/termination cases. Recapture only on request using the applicable capture skill. Website, installed GM and Rust evidence have separate scopes.
