---
name: any-music-userscript-runtime
description: Implement or diagnose Any Music Tampermonkey runtime bindings for GM HTTP, cookies, page bridges, storage, permissions and media access in apps/userscript. Exclude Tauri native transport and shared-only protocol or UI changes.
---

# Any Music Userscript Runtime

Use for the GM/host-page boundary, not portable protocol implementation. Read the target app's AGENTS.md and [userscript rules](../../../docs/en/userscript/development.md).

## Follow the actual transport

Trace the injected HttpClient to platform/http/gm-http-client.ts and GM_xmlhttpRequest. Built-in requests use include. Userscript injects externalPlugins: none and constructs only build-known sources. Tauri native catalogs do not enable Userscript external plugins. GM's fetch option is script-manager transport, not host fetch or Rust HTTP; retain application-level timeout, abort and response-size semantics across its modes.

Keep cookies, device state, document-start signing/capture bridges and protected-page fallback in the application's platform directory. Inject optional capabilities into shared sources; signing alone must not create a duplicate business request. Synchronize exact @connect and actual @grant permissions in the affected userscript.

Preserve the host's single account and proxy boundary. Do not import the desktop account runtime, native CookieStore, IPC or loopback grant. Product GM storage stays separate from desktop storage; secrets stay out of product snapshots, errors and logs. Shared styles enter the Shadow Root and hiding preserves ongoing sessions.

## Verify the userscript layer

Run target-app tests/typecheck and root gates. Cover GM request credentials, cancellation, limits and bridge lifecycles where changed. Use `$music-source-adapter` for shared protocols and `$any-music-ui-delivery` for product UI.

Only explicit live inspection authorizes opening a browser/product. For real-GM iteration, follow the local-server workflow in the userscript rules: install the Vite connection script once and use gm-dev.html or a real source host, without repeated production builds/pasting. Distinguish webpage capture, preview GM substitutes, installed development GM and final production-artifact behavior; development grants are broader. Report missing live checks without changing captureDate or claiming desktop transport was verified.
