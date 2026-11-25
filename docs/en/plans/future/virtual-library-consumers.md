---
documentType: future-plan
runtimeScope: shared
status: proposed
---

# Library list consumers

[中文](../../../zh-cn/计划/未来/资料库虚拟列表消费方.md)

**Proposed.** Reuse the [grid and table adapters](../../modules/ui/virtual-lists.md) after checking the actual owner of each list. Preserve occurrence/task identity and existing full-collection actions.

| Batch | Consumer                                              | Behavior to verify                                                                               |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| C11   | Studio `StudioHistory`                                | Same history requirements across both table/card branches.                                       |
| C13   | Studio `StudioDownloads`                              | Virtual unmount does not pause, retry, cancel or restart tasks; action confirms retain identity. |
| C15   | Studio `StudioPlaylists` overview                     | Preserve its independent layout, filters, keyboard movement and item styles.                     |
| C28   | Classic `ClassicCustomTracks`                         | Published-work card branches, filters, full selection and actions.                               |
| C29   | Studio `StudioCustomTracks`                           | Reuse migrated table geometry while measuring expandable credits/recipe details correctly.       |
| C58   | Host `PlaylistValidationNotice` issue details         | Issues can grow with tracks; preserve full diagnostics, retry and overlay identity.              |
| C68   | Classic `CustomTrackDrawer` expanded source directory | Independently adapt nested sources, ranges and original actions alongside the C28 parent card.   |

Use the [recorded branch inventory](../../../baselines/virtual-lists/2026-11-03-p00-p03/collection-surfaces.json) to locate candidate callers. Recheck current source and select one reusable batch before editing.
