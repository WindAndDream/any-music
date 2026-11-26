---
documentType: module-contract
runtimeScope: tauri
---

# Account-owned source page sessions

[中文](../../../zh-cn/板块/桌面与移动端/来源网页会话.md)

Tauri owns the embedded account page and its credential boundary. See [accounts and proxies](accounts.md) for isolation and IPC and [Douyin catalog](douyin-catalog.md) for the result WebView. Mobile proposals are tracked in [future plans](../../plans/future/mobile-source-pages.md).

## Current implementation

Desktop Douyin uses the account's embedded page (a child WebView of the product window; see [Runtime Architecture](runtime.md)). Catalog parsing consumes `DouyinBrowserCatalog`; media bytes still use native HTTP and media grants. Android currently provides Bilibili account transport, without Douyin page verification or catalog admission. See [Runtime Architecture](runtime.md).

`loadDouyinPlugin` accepts an optional trusted `createPageCatalog` factory in application composition. It receives the selected account ID and cancellation signal and returns the existing portable catalog port. Without a factory, composition uses the native account-page session. A supplied adapter's failure never selects another transport. Page access never moves into shared source parsing. The existing native `request_state` path still applies; this factory alone does not add a mobile login, verification surface, capability, or credential bridge.
