---
documentType: future-plan
runtimeScope: tauri
status: proposed
---

# iOS native delivery

[中文](../../../zh-cn/计划/未来/iOS原生交付.md)

**Proposed.** The current app has iOS configuration and a restricted IPC surface. Native build/device acceptance requires macOS/Xcode and suitable physical devices. See [mobile capabilities](../../modules/tauri/mobile.md).

1. Generate and build the actual app with the locked toolchain. Validate WKWebView startup, private state, safe areas and lifecycle.
2. Implement scoped file and share handling, save destinations, Keychain, and admitted account/proxy/media adapters. Bind all requests to the available capabilities and preserve cancellation, stable records and credential isolation.
3. On signed device artifacts validate Classic input and recovery, playback/download/interruption, minimum-device budgets and system dialogs. Record channel acceptance separately from device checks.

External package install/DEV/execution remain governed by the distinct [mobile plugin plan](mobile-external-plugins.md).
