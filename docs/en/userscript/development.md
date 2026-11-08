---
documentType: architecture
runtimeScope: userscript
---

# Userscript Development

Chinese counterpart: [篡改猴开发规范](../../zh-cn/用户脚本/开发规范.md). Applies to `apps/userscript`. The backend here means GM transport and host-page adapters. These adapters are separate from the desktop Rust backend.

## Data access and call chain

`music-workbench / plugin-source-* → injected HttpClient → apps/userscript/src/platform/http/gm-http-client.ts → GM_xmlhttpRequest`.

- Built-in APIs explicitly use `credentials: 'include'` and GM's target-domain authentication; S10 no longer assembles or executes external declarative sources. Do not switch to host-page fetch based on the current page domain.
- GM `fetch: true` is an internal Tampermonkey transport option. Small text requests and header/progress-limited byte requests follow different strategies with shared application timeout/cancellation semantics. This option does not apply to Rust.
- Cookies, device snapshots, BDMS/Web SecSDK signing, document-start bridges and protected-list page fallback stay in `src/platform`, injected into portable sources. Signing does not send a second business request; page capture handles the website's own responses separately.
- Userscript build configuration owns @grant, exact @connect, @noframes and metadata. Desktop IPC capabilities do not replace them.
- This runtime uses one host account and one proxy. Convert proxy settings only at the GM boundary; browser compatibility limits apply and saving does not prove connectivity. Account pools, Rust CookieStores and native media grants are not integrated here.

## Storage, media and mounting

Disposable artwork/eligible GM binary-response caching uses a separate manager-owned namespace, capacity/LRU limits and confirmed clearing. Browser-direct media retains the existing native-first startup contract. Cache shutdown drains before releasing the product writer session; cache values never enter product backups. See [Resource Cache](../cross-platform/features/resource-cache.md).

S06 registers the tab's writer session and creates versioned product generations before mounting; bootstrap awaits this initialization. Named repository ports map into ownership partitions; stage/manifest/journal validation precedes one commit pointer. The adapter announces a unique owner through `GM.saveTab` before querying `GM.getTabs`, rejecting a second expanded workbench before product IO. The session survives hiding, and actual unmount/page exit freezes the writer and drains acknowledged persistence before removing its registration. Suspended tabs never expire by a timestamp lease. Product reads/writes/deletions use asynchronous GM APIs and an ordered queue; synchronous GM caches are not a cross-tab lock or an authoritative initial snapshot. Startup creates only the current generation format. `GM.deleteValue` reclaims old generation chunks; proxy configuration stays in a separate runtime-local key. Portable-data preflight, full-workbench reload after import and recovery are specified in the [data ownership](../cross-platform/architecture/plugin-data-ownership.md).

- Product keys use `any-music:userscript:*` with separate test storage. Do not mix GM storage with desktop product.json or native credential files. Proxy secrets remain in runtime configuration, outside product snapshots, errors and logs. Async persistence failure freezes later saves and displays a persistent storage error with a reload instruction; its event listener is removed with the workbench scope.
- Use shared workbench/media algorithms, GM HTTP for managed media bytes and the shared native-streaming fallback order. GM Range/MSE evidence does not prove Rust grant playback.
- Keep the launcher and document-start bridge light; load the product tree on first expansion. T11 injects host styles into the outer Shadow Root and activates shared/SFC/selected-theme resources inside the stable complete-theme surface. Metadata is separate; the optional Studio entry executes only after selection. Hiding preserves playback/downloads; disposal cleans up. See [edge cases](architecture/edge-cases.md).

## Iterate in Tampermonkey with the local server

When browser inspection is explicitly requested, prepare and reuse the real Tampermonkey environment from the repository root:

```powershell
pnpm setup:userscript
# Optional: select Edge, or prepare only the browser/extension without starting Vite.
pnpm setup:userscript --browser edge
pnpm setup:userscript --browser-only
```

`scripts/setup-userscript-browser.mjs` finds an installed stable Chrome/Edge, remembers the selected browser and launches/reuses its visible window with a dedicated persistent profile at `.local/userscript-browser/<browser>`. It uses neither a temporary automation profile nor extension-disabling flags. Keep this Git-ignored directory: it contains extensions, userscripts, manager storage and website logins. The command does not use or change your everyday browser profile. If neither browser is installed, install one first; enterprise policies may still prevent extension installation or debugging.

The command reads live extension-manager state. A missing stable Tampermonkey opens its official browser store and waits for you to confirm installation; a disabled extension opens its settings instead of reinstalling it. It also waits for the user-script execution permission. Enable **Allow User Scripts** in Tampermonkey's extension details, or **Developer Mode** on older browsers, as described in [Tampermonkey's official instructions](https://www.tampermonkey.net/faq.php?locale=en&q=Q209). Store installation and permission confirmation are one-time browser actions; the script does not silently bypass them. `--timeout 600` is the default wait in seconds for each setup stage; a timeout exits unsuccessfully and retains the profile for the next attempt. If the Chrome store is unreachable, select Edge and use its official store; each browser has its own profile.

By default the command starts Vite at `http://127.0.0.1:18765`, or reuses a setup-command server belonging to this checkout. An unrelated listener, including a separately started Vite without the setup identity endpoint, fails on the fixed port instead of silently switching origins. Stop that listener and rerun. It opens `gm-dev.html`, checks the injected development entry, the `server:Any Music` identity, actual Tampermonkey GM functions and the launcher, and opens the connection-script installer only if that check fails after retrying the host page. Click **Install** once. Enable that development script and disable the production `Any Music` script in the same browser profile to avoid competing launchers. A production/preview launcher alone does not pass this environment check.

Vite serves source modules and updates/reloads them as files change. Refresh the host page when a change needs a full restart. Reinstall the small connection script only when its origin/port or generated metadata changes; do not rebuild and paste the production bundle after each edit. Ctrl+C stops a Vite server owned by the current invocation, leaving the browser/profile installed; a reused server remains owned by its original process. `.local/userscript-browser/endpoint.json` records the current loopback debugging address for tools that support attaching to an existing browser. Attach to this browser rather than creating a fresh automation window. Re-run setup after closing/reopening it to refresh the address.

`gm-dev.html` deliberately imports neither the product entry nor `platform/dev` doubles. The ordinary `/` preview still uses the development GM substitute. Development and production scripts have separate manager storage, even though both use `any-music:userscript:*` keys inside their own script. Keep one expanded development workbench: hiding retains its writer session, so close the owning tab before expanding another host. To check source hosts, use the same development script on their actual pages.

Record this as **installed development script with real GM transport**, separately from preview doubles and final production-artifact acceptance. The development plugin requests broader grants than the production metadata; real development GM success does not validate the final production permission set, bundled startup or timing. Run the production build once for the final gate and install that artifact only for its separate acceptance pass.

## Skills and verification

- Use `$any-music-userscript-runtime` for runtime adapters, `$music-source-adapter` for portable protocols and `$any-music-ui-delivery` for product UI.
- Start with `pnpm --filter @any-music/userscript test` and `pnpm --filter @any-music/userscript typecheck`. Then complete root checks.
- Capture or installed-script regression requires explicit live inspection in the task. Distinguish website capture, Vite GM substitutes and actual GM requests; none verifies desktop account/credential transport.

## GM transport and proxy details

For small text API requests in Chrome, the GM HTTP adapter explicitly enables Tampermonkey's fetch transport so authenticated XHR does not add a fixed delay before every request. Media bytes and requests that depend on response headers or progress events for early size enforcement stay on XHR. Because Tampermonkey's fetch mode does not honor `details.timeout`, the adapter maintains one abortable application timer for both transports and callers continue to depend only on `HttpRequest.timeoutMs`.

### Single-proxy settings

Proxy configuration is a runtime setting, not part of `HttpRequest`, `MusicSourcePlugin`, or platform DTOs. Validated HTTP/HTTPS/SOCKS settings are converted only inside the GM HTTP adapter, so platform APIs, complete media reads, and Range requests share the same current snapshot. Disabled settings omit the GM proxy field. Credentials remain in the current script's GM storage and must never enter logs, error states, download reports, or domain models.

The implementation uses Tampermonkey's Firefox `GM_xmlhttpRequest.proxy` support. Saving a configuration does not prove connectivity, and unsupported browser/manager combinations remain direct; the settings UI must state that compatibility boundary.

## Built-in runtime policy

Userscript fixes `externalPlugins: none` before source construction and at activation, enablement, commands, media and prefetch. Only build-known feature/source modules are assembled; product backups and self-reported identity fields cannot register externals. There is no source JSON installer or archive-management view. See [runtime policy](../cross-platform/architecture/plugin-runtime-policy.md).

Keep canonical tracks, playlists, tag namespaces and published recipes independent of optional source modules. Disabled or unavailable leaves fail explicitly; valid built-in leaves retain playback. The production graph excludes external installers, Worker/WASM executors and public-network brokers. Exact built-in API/media domains remain in @connect.

Page bridges exchange minimal allowlisted DTOs and validate source/origin, request/target, expiry and cancellation. Nonces correlate messages without authenticating same-page code; Shadow DOM and DOM events grant no GM/plugin authority.

Composition directly consumes plugin-source-bilibili/plugin-source-douyin metadata and lazy /runtime. Each GM operation receives cancellation; Douyin capture waits and fallback pages clean up when cancelled. Preserve the host account, single proxy, document-start bridges and hide-preserves-session behavior.

Acceptance checks none at every entry and inspects the actual production graph. Report automated checks and installed GM evidence separately; desktop sandbox or webpage capture cannot establish this runtime's transport acceptance.
