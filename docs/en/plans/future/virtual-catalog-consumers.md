---
documentType: future-plan
runtimeScope: shared
status: proposed
---

# Catalog list consumers

[中文](../../../zh-cn/计划/未来/目录虚拟列表消费方.md)

**Proposed.** Classic Userscript Douyin (remaining C08) and the other Studio catalog result paths (remaining C09) still need adaptation. Check their scroll roots, full-result order, viewport fill, paging and retry before reusing the shared adapter. The integrated paths have [separate acceptance](../../changes/acceptance/virtual-catalog-lists.md).

| Batch | Consumer                                                      | Behavior to verify                                                                          |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| C21   | Studio catalog drawer/request rail through `StudioDrawerRail` | Current rail orientation and scrolling; virtualize the growing axis without redesigning it. |

Use the [recorded branch inventory](../../../baselines/virtual-lists/2026-11-03-p00-p03/collection-surfaces.json) to locate candidate callers. Recheck current source and select one reusable batch before editing.
