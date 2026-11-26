---
documentType: module-contract
runtimeScope: shared
---

# Lazy listings and source sessions

[中文](../../../zh-cn/板块/音乐源/分页与会话.md)

Source packages adapt endpoints to one-page reads. The workbench owns retained results and cancels live readers through injected runtime ports.

## Availability

The registry reports `unchecked/checking/available/invalid/unavailable`. An explicit negative response yields `invalid`; transport or protocol failures remain retryable. Sources must pass availability before search/import. Existing listing recipes stay paused and retain their data.

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

Discovery retains stable track metadata, loaded-page counts, totals, errors and optional `TrackPage.continuation` positions in the workspace snapshot. An initial visit can load subsequent pages with downward scroll input, including when a short list has no scrollbar. Leaving the detail page locks pagination for that list. Reopening the detail, including with results restored after restart, displays the retained rows without requesting any pages. Confirming Refresh clears the previous result and starts the original request from page one with pagination enabled for that visit. Within an active paginable visit, suspending the source closes its old reader; a later page request can bind the current source and continue from a valid saved position. A missing or rejected position preserves the rows and requires Refresh. Tracks are deduplicated by stable ID. Browser-backed sources expose the same listing contract. The workbench releases the source reader at the final page while retaining displayed results.

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

See [Error and State Model](../errors.md) for shared error and persistence rules. Source adapters map upstream failures to the shared catalog while retaining HTTP status, platform codes, and raw response context inside the adapter.
