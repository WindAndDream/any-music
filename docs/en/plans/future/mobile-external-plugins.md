---
documentType: future-plan
runtimeScope: tauri
status: proposed
---

# Mobile external plugin admission

[中文](../../../zh-cn/计划/未来/移动端外置插件.md)

**Proposed.** Both mobile runtimes currently return `externalPlugins: none`. Android offers bounded package preview; actual install, rollback, execution and DEV remain unavailable. See [mobile capabilities](../../modules/tauri/mobile.md).

- Treat declarative and code paths independently. For a chosen target, validate explicit consent, install/update/rollback/revoke/restore and native transport on the exact OS/engine/device/channel.
- Code also needs an isolated principal and resource filter, independent Worker/WASM/CSP/relay denial, bounded termination and real lifecycle recovery. Compare against the existing [executor isolation evidence](../../../baselines/plugin-system-s03/live-2026-10-18/acceptance.json) within its target scope and [desktop execution contract](../../modules/plugins/execution.md).
- Measure physical minimum-device memory/CPU, suspension/kill and storage/network recovery. Keep current off-by-default policy until the native target and channel conditions are met. Recheck official [Google Play device/network policy](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en) and [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/) when planning release.

Next planning step: select the smallest declarative target case and its acceptance requirements.
