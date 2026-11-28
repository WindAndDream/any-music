---
documentType: change-acceptance
runtimeScope: tauri
status: awaiting-acceptance
---

# Android theme acceptance

[中文](../../../zh-cn/变更/验收/Android主题.md)

**Awaiting acceptance.** Earlier [debug-device checks](../../../baselines/theme-ui-migration/T13-android-followup.json) and the [signed optimized build](../../../baselines/theme-ui-migration/T13-runtime-followup.json) cover theme switching, saving and selected device operations. Those cases carry their own build and input scope.

Next, when device inspection is requested, verify Classic on the affected signed builds with narrow layout, touch, appearance settings, protected screens, tag-draft continuity and a sustained playback/download session. Broader devices, source/quality, specialist and capability combinations remain open. Track physical routes/calls/ducking in [Android audio](android-audio.md) and engine/channel gates in [Android release](android-release.md).
