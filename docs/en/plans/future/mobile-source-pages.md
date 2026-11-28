---
documentType: future-plan
runtimeScope: tauri
status: proposed
---

# Mobile source-page adapters

[中文](../../../zh-cn/计划/未来/移动端来源网页.md)

**Proposed.** Android has the Bilibili native adapter. Douyin's current [account-page port](../../modules/tauri/source-page-sessions.md) serves desktop. A mobile port needs its own verification and transport proof.

- Establish an account-owned native page, a consistent UA/request state and early origin-scoped observation before navigation. Confirm support for document-start injection on the real Android WebView. Late or unavailable capture reports unavailable. [Android WebViewCompat](<https://developer.android.com/reference/androidx/webkit/WebViewCompat#addDocumentStartJavaScript(android.webkit.WebView,java.lang.String,java.util.Set)>).
- Match the main-frame origin, named operation and account/listing generation, bound response bytes and dispose readers/views on navigation, cancellation and suspension. Native adapters commit verified credentials. Test profile/proxy isolation separately from UI.
- Select a small supported listing or login first, with actual engine/target acceptance. iOS requires its own [native delivery](ios-native-delivery.md) work.
