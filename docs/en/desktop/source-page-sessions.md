---
documentType: engineering-note
runtimeScope: tauri
---

# Source page session extension

Chinese counterpart: [来源网页会话扩展](../../zh-cn/桌面端/来源网页会话扩展.md).

## Current implementation

Desktop Douyin uses the account's embedded page (a child WebView of the product window; see [Runtime Architecture](runtime-architecture.md)). Catalog parsing consumes `DouyinBrowserCatalog`; media bytes still use native HTTP and media grants. Android currently provides Bilibili account transport, without Douyin page verification or catalog admission. See [Runtime Architecture](runtime-architecture.md).

`loadDouyinPlugin` accepts an optional trusted `createPageCatalog` factory in application composition. It receives the selected account ID and cancellation signal and returns the existing portable catalog port. Without a factory, composition uses the native account-page session. A supplied adapter's failure never selects another transport. Page access never moves into shared source parsing. The existing native `request_state` path still applies; this factory alone does not add a mobile login, verification surface, capability, or credential bridge.

## Feasibility and remaining work

- Desktop uses Tauri 2.12.1 child WebViews (the desktop-only `unstable` feature; [Tauri Window API](https://docs.rs/tauri/2.12.1/tauri/window/struct.Window.html#method.add_child)). They form a browser context separate from the former Chrome/Edge Profiles: stored native credentials seed a new context once, and old Chrome Profiles are no longer read. Child WebViews use different engines per platform (WebView2, WKWebView, WebKitGTK), so live website compatibility needs separate acceptance on each.
- Android can select a desktop UA before navigation using `setUserAgentString`; changing it during navigation can restart loading. UA selection must belong to the account's native page adapter and remain consistent with its request state. A desktop UA alone does not establish source compatibility. [Android WebSettings](<https://developer.android.com/reference/android/webkit/WebSettings#setUserAgentString(java.lang.String)>).
- Android can read page data through `evaluateJavascript` on the UI thread. Early response observation needs `DOCUMENT_START_SCRIPT` feature detection and origin-scoped injection before navigation. Tauri's fallback for remote Android pages does not guarantee injection before website scripts, so late injection must report unavailable capture rather than silently return incomplete data. [Android WebView](<https://developer.android.com/reference/android/webkit/WebView#evaluateJavascript(java.lang.String,android.webkit.ValueCallback)>), [WebViewCompat](<https://developer.android.com/reference/androidx/webkit/WebViewCompat#addDocumentStartJavaScript(android.webkit.WebView,java.lang.String,java.util.Set)>), [Tauri WebviewBuilder](https://docs.rs/tauri/2.12.1/tauri/webview/struct.WebviewBuilder.html#method.initialization_script).

On desktop, remote pages may only call `account_page_report` and have no product IPC permission. The remaining requirements also bind mobile implementations: validate the main-frame origin and named operation, bound captured response bytes, bind every result to the account/listing generation, and close listeners/views on cancellation, account changes, navigation, and suspension. Native code owns credential commits and verification completion; page messages cannot claim success or issue arbitrary HTTP/storage operations. Android account/profile isolation and proxy parity need separate validation; iOS needs its own implementation and acceptance.

Desktop embedded pages have automated tests only. No mobile Douyin capability, live website capture or device acceptance is delivered.
