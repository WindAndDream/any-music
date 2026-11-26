---
documentType: change-acceptance
runtimeScope: tauri
status: awaiting-acceptance
---

# Windows theme acceptance

[中文](../../../zh-cn/变更/验收/Windows主题.md)

**Awaiting acceptance.** Both [themes](../../modules/ui/themes.md) are wired. Next, exercise physical input and system dialogs in the current build when inspection is requested.

- The [optimized runtime sample](../../../baselines/theme-ui-migration/T13-runtime-followup.json) covers theme/audio and selected download/save cases.
- The [Windows PC follow-up](../../../baselines/theme-ui-migration/T13-pc-2026-11-01.json) records layout/appearance, WebView keyboard/focus, scroll restoration, account/proxy/editor drafts, protected surfaces and recovery on its recorded build.
- Physical input, end-to-end file/directory/installation consent dialogs and additional account/permission combinations remain open. Verify continuity and focus after theme changes. Track exact-target plugin admission independently in [desktop plugin acceptance](desktop-plugin-delivery.md).
