---
documentType: delivery-matrix
runtimeScope: tauri
---

# Tauri mobile capabilities

[中文](../../../zh-cn/板块/桌面与移动端/移动端能力.md)

| Capability             | Android                                                                                                                                                                                                   | iOS                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Project and startup    | Maintained Gradle/Kotlin project in `apps/tauri/src-tauri/gen/android`. Minimum API 26 and Chromium WebView 111. Native bootstrap shows a localized update message if the provider is missing or too old. | Configuration and restricted IPC surface. Native project/device delivery remains [planned](../../plans/future/ios-native-delivery.md). |
| Source directory       | Bilibili with native QR app handoff, CookieStores, account/proxy requests and foreground playback through account-bound loopback/Range grants.                                                            | Bilibili metadata with unavailable runtime capabilities.                                                                               |
| Files and credentials  | Native picker or single granted Android content stream, immutable preview staging, Document Provider saving, and Keystore-backed credentials.                                                             | Native account, secure credential and save adapters are unavailable.                                                                   |
| External plugins       | `externalPlugins: none`. Bounded preview, redacted diagnostics, snapshot/revocation. Installation, DEV and guest execution unavailable.                                                                   | `externalPlugins: none`. Local-data/capability/cancellation surface only.                                                              |
| Build and distribution | Local debug and optimized APK/AAB for arm64/x86_64, with explicit signing. Channel and minimum-device checks remain in [Android release acceptance](../../changes/acceptance/android-release.md).         | No device or channel acceptance.                                                                                                       |

Android `main-android` and iOS `main-mobile` ACLs target only the main WebView. Kotlin `mobile-platform` is Rust-only. Android forwards valid intents with grants inside the app UID. The native preview copies up to 16 MiB within five seconds into a private immutable snapshot; cancellation and bounded opener slots protect against stalled providers. Redacted diagnostics and document saving use native ownership. No system-browser/CDP, install/rollback, guest commands or executor relays are available on mobile.

See [Android validation](../../guides/android-validation.md) for builds and instrumentation, [Android playback](android-playback.md) for audio focus and cancellation, and [mobile external plugins](../../plans/future/mobile-external-plugins.md) for possible future admission work.

## Android source and media lifetimes

Backgrounding cancels transient work. Only an explicitly opened Bilibili app-authorization handoff can survive within its original 180 seconds. Returning never starts the handoff again. Cancellation, replacement and expiry invalidate it. Both official scan routes are validated before dispatch.

The accountProxy capability controls proxy settings. Loopback binds before capability discovery. The WebView allows cleartext only to loopback; the main host allows Blob workers/WASM required for bundled MP3 encoding, independently of executor CSP. See [Android device acceptance](../../changes/acceptance/android-release.md) for scoped account, transport and device evidence.
