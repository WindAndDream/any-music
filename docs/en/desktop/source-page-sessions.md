---
documentType: engineering-note
runtimeScope: tauri
---

# Source page session extension

Chinese counterpart: [来源网页会话扩展](../../zh-cn/桌面端/来源网页会话扩展.md).

## Current implementation

Desktop Douyin uses an account-owned system browser through native CDP. Catalog parsing consumes `DouyinBrowserCatalog`; media bytes still use native HTTP and media grants. Android currently provides Bilibili account transport, without Douyin page verification or catalog admission. See [Runtime Architecture](runtime-architecture.md).

`loadDouyinPlugin` accepts an optional trusted `createPageCatalog` factory in application composition. It receives the selected account ID and cancellation signal and returns the existing portable catalog port. Without a factory, composition uses the current native CDP adapter. A supplied adapter's failure never selects another transport. This reserves a replacement point for an embedded native page reader without moving page access into shared source parsing. The existing native `request_state` path still applies; this factory alone does not add a mobile login, verification surface, capability, or credential bridge.

## Feasibility and remaining work

- Desktop in-app page display is feasible through a separately owned native view. Tauri 2.12.1 exposes child WebViews behind its desktop-only `unstable` feature. This would be a separate browser context; displaying the current system Chrome/Edge CDP page inside that WebView requires another presentation/session solution. Do not assume their cookies, proxies, or profiles are interchangeable. [Tauri Window API](https://docs.rs/tauri/2.12.1/tauri/window/struct.Window.html#method.add_child).
- Android can select a desktop UA before navigation using `setUserAgentString`; changing it during navigation can restart loading. UA selection must belong to the account's native page adapter and remain consistent with its request state. A desktop UA alone does not establish source compatibility. [Android WebSettings](<https://developer.android.com/reference/android/webkit/WebSettings#setUserAgentString(java.lang.String)>).
- Android can read page data through `evaluateJavascript` on the UI thread. Early response observation needs `DOCUMENT_START_SCRIPT` feature detection and origin-scoped injection before navigation. Tauri's fallback for remote Android pages does not guarantee injection before website scripts, so late injection must report unavailable capture rather than silently return incomplete data. [Android WebView](<https://developer.android.com/reference/android/webkit/WebView#evaluateJavascript(java.lang.String,android.webkit.ValueCallback)>), [WebViewCompat](<https://developer.android.com/reference/androidx/webkit/WebViewCompat#addDocumentStartJavaScript(android.webkit.WebView,java.lang.String,java.util.Set)>), [Tauri WebviewBuilder](https://docs.rs/tauri/2.12.1/tauri/webview/struct.WebviewBuilder.html#method.initialization_script).

An admitted implementation must keep remote pages outside product IPC permissions, validate the main-frame origin and named operation, bound captured response bytes, bind every result to the account/listing generation, and close listeners/views on cancellation, account changes, navigation, and suspension. Native code owns credential commits and verification completion; page messages cannot claim success or issue arbitrary HTTP/storage operations. Android account/profile isolation and proxy parity need separate validation; iOS needs its own implementation and acceptance.

This is an extension seam and a documentation-based feasibility assessment. No embedded page, mobile Douyin capability, live website capture, or device acceptance is delivered by it.
