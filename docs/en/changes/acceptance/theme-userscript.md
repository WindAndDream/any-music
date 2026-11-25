---
documentType: change-acceptance
runtimeScope: userscript
status: awaiting-acceptance
---

# Userscript theme acceptance

[中文](../../../zh-cn/变更/验收/用户脚本主题.md)

**Awaiting acceptance.** Classic and Studio use the [complete theme contract](../../modules/ui/themes.md). The next check is the current production bundle installed in the dedicated Tampermonkey environment when inspection is requested. The earlier attempt to repeat the final Studio settings repair was blocked on browser restart approval.

- Earlier installed GM checks cover startup, playback, switch, hide/reload, download/cache fallback, Bilibili private, Douyin and NetEase cases, plus host-page overlays, appearance, focus, keyboard/pointer, scroll and protected surfaces. [R1](../../../baselines/theme-ui-migration/T13-gm-r1.json), [R2](../../../baselines/theme-ui-migration/T13-gm-r2.json), [R3](../../../baselines/theme-ui-migration/T13-gm-r3.json), [R4](../../../baselines/theme-ui-migration/T13-gm-r4.json).
- The [PC follow-up](../../../baselines/theme-ui-migration/T13-pc-2026-11-01.json) covers DOM/layout on its earlier installed production bundle. [Surface inventory](../../../baselines/theme-ui-migration/T00-surfaces.json) and [baseline artifact](../../../baselines/theme-ui-migration/T00.json) support comparison.
- Recheck theme switch, Studio settings, cold start, real keyboard/pointer, scrolling and protected surfaces. Physical input, other browser/manager combinations and out-of-scope account/entitlement combinations are still open. Record exact artifact, browser, manager and input for each claimed result.
