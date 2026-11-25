---
documentType: change-acceptance
runtimeScope: tauri
status: awaiting-acceptance
---

# Android device and release acceptance

[中文](../../../zh-cn/变更/验收/Android发布.md)

**Awaiting acceptance.** The [Android adapters](../../modules/tauri/mobile.md) and local signed APK/AAB builds exist. Use [the Android validation guide](../../guides/android-validation.md) for repeatable procedures.

| Recorded evidence                                                                                                                                                                      | Scope and open cases                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [APK, engine and device checks](../../../baselines/plugin-system-s16/android-release-checks.json) and [adapter checks](../../../baselines/plugin-system-s16/android-local-checks.json) | API 34/WebView 113 emulator debug checks and API 35/WebView 153 arm64 reference-phone release smoke and native adapter tests. API 26 with an old provider exercised only the update message. x86_64 API 35 software-renderer first cold start failed. Activity teardown/recreation and canceled replies still require targeted checks. |
| [Built-in media on a debug device](../../../baselines/android-builtin-media/2026-10-20.json) and [signed audio samples](android-audio.md)                                              | Bilibili app handoff/restart, paged account requests, debug account/proxy playback/seek and document saving, plus exact signed playback/interruption cases. Repeat on signed release for account expiry, proxy/fallback, Range/seek, downloads and more providers/devices as applicable.                                               |
| Channel and minimum-device checks                                                                                                                                                      | Verify a physical arm64 minimum device, real memory/storage/power and network pressure, recovery and data transfer without authority. Verify signed ABI/manifest/16 KiB behavior on devices, publisher identity, privacy and channel review.                                                                                           |

Next: when requested, reproduce first cold start and lifecycle on the same engine/renderer before extending device coverage. Local signing and target-specific checks remain limited to the recorded artifacts. [iOS](../../plans/future/ios-native-delivery.md) and [mobile external execution](../../plans/future/mobile-external-plugins.md) have their own plans.
