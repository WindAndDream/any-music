---
documentType: future-plan
runtimeScope: shared
status: proposed
---

# Library list consumers

[中文](../../../zh-cn/计划/未来/资料库虚拟列表消费方.md)

**Proposed.** Reuse the [grid and table adapters](../../modules/ui/virtual-lists.md) after checking the actual owner of each list. Preserve occurrence/task identity and existing full-collection actions.

| Batch | Consumer                                      | Behavior to verify                                                                  |
| ----- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| C58   | Host `PlaylistValidationNotice` issue details | Issues can grow with tracks; preserve full diagnostics, retry and overlay identity. |

Use the [recorded branch inventory](../../../baselines/virtual-lists/2026-11-03-p00-p03/collection-surfaces.json) to locate candidate callers. Recheck current source and select one reusable batch before editing.
