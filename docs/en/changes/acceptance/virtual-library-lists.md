---
documentType: change-acceptance
runtimeScope: shared
status: awaiting-acceptance
---

# Library virtual-list acceptance

[中文](../../../zh-cn/变更/验收/资料库虚拟列表.md)

**Awaiting acceptance.** These [list consumers](../../modules/ui/virtual-lists.md#current-consumers) run in the normal development profile. Each affected consumer needs its own staging/production decision.

| Consumer                                     | Check next in installed GM and Tauri                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C00 Classic Favorites, C14 playlist overview | Viewport artwork/geometry and return from a platform/list. Check physical input, scroll focus, both drag directions, interruption and rapid sidebar reversals. [C00 scoped live evidence](../../../baselines/virtual-lists/2026-11-05-c00-live-admission/live-checks.json) and [motion follow-up](../../../baselines/virtual-lists/2026-11-06-card-motion-flicker/verification.json). |
| C01/C02 Classic queue and playlist detail    | Real full filtered order, queue positions/current item, stale removal checks, distant focus and keyboard/touch drop. [Static/build evidence](../../../baselines/virtual-lists/2026-11-07-classic-queue-playlist/verification.json).                                                                                                                                                   |
| C10/C12 Classic history and downloads        | Flat/platform return, stable occurrence/task identity, progress, status filtering and full-order reorder. Verify native pointer/touch/focus on each real build.                                                                                                                                                                                                                       |

Next, verify a representative branch per affected consumer: short/empty and 1k/10k, scrolling in both directions, current focus and disconnected departed cells, filter and batch actions on the full collection. Derive mounted rows from viewport, overscan and retained targets. The [window-lifetime sample](../../../baselines/virtual-lists/2026-11-07-window-lifetime/verification.json) is scoped to its recorded build. Earlier [GM and native static comparisons](../../../baselines/virtual-lists/2026-11-06-c00-revalidation/verification.json) retain minor pixel differences, so strict visual parity is still open. Live reproduction requires an explicit request.

## Release closeout

For G00–G04, run the final workspace checks/builds and entry audits, compare the actual installed Userscript and Tauri production artifacts, and verify affected mobile layouts on admitted engines/devices. Cover sustained playback/downloads and account/context changes, normal exit and resource cleanup. Close the remaining consumer inventory and applicable [grid](../in-progress/grid-performance.md) and [storage](../../plans/future/nonblocking-library-persistence.md) limitations before claiming whole-plan responsiveness. Remove temporary activation paths for accepted consumers when the applicable gates pass.
