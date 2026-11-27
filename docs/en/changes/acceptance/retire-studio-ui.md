---
documentType: change-acceptance
runtimeScope: repository
status: awaiting-acceptance
---

# Retire the Studio interface and stale implementations

[中文](../../../zh-cn/变更/验收/移除工作室界面.md)

Studio's previous interface, application registrations and Windows catalog branch have been removed. Routine delivery covers Classic and shared contracts until the user starts the [Studio redesign](../../modules/ui/themes.md). Startup with a stored Studio selection uses Classic and retains the per-theme settings map.

The replaced catalog, library and download panels and the obsolete login experiment UI and IPC have been removed. The [standalone Rust experiment](../../modules/tauri/accounts.md#windows-development-background-login-experiment) remains available. The disabled creation workspace was withdrawn from both products. Its drafts, materials and recipe logic are retained, and published works remain available through existing library actions. Collection display preferences use their current host storage keys in both runtimes.

## Verification

- `pnpm test` passed. Shared Node tests cover Classic remounts, theme fallback, stored preferences, filters, pagination, playback and download continuity. Creation tests cover draft persistence and published recipes. The Tauri workspace tests and TS/Rust protocol comparison passed.
- `pnpm build` passed with workspace type checking, Userscript production output and the Windows Tauri production binary. Both frontend build graphs and the compiled Windows catalog child contain Classic resources. Studio and the retired product panels are absent.
- `pnpm lint`, `pnpm format:check`, `pnpm check:native`, `pnpm check:rust:msrv` and `pnpm check:rust:deny` passed. The locked pnpm workspace resolves offline.

When live inspection is requested, verify Classic startup with a stored Studio selection in [installed Tampermonkey](theme-userscript.md) and [Windows](theme-windows.md). Check the existing [Windows result viewport handoff](virtual-catalog-lists.md) and [Android](theme-android.md) cases under their own acceptance records.
