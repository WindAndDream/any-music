---
documentType: future-plan
runtimeScope: shared
status: proposed
---

# Creation and tag list consumers

[中文](../../../zh-cn/计划/未来/专用插件虚拟列表消费方.md)

**Proposed.** Specialist plugins retain namespaced drafts and tag associations. Adapt theme-owned lists and neutral plugin controls through public UI ports. Assess timeline and material controls when the creation workspace resumes.

| Batch | Consumer                                                              | Behavior to verify                                                                                                                           |
| ----- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| C22   | Classic tag directory through `TagManagementResults`                  | Tag identity, maintenance selection, filtering and details navigation.                                                                       |
| C24   | Neutral plugin `TagDetailsPanel` association lists                    | Entry occurrence keys, association editing and scope checks; no namespace writes on mount.                                                   |
| C27   | Neutral plugin `PendingMaterialStorage`                               | Pending order, edits and reuse survive virtual remount; no publish/replay effects.                                                           |
| C51   | Neutral plugin `SegmentTimeline` arrangement list                     | Preserve full recipe order, duplicate segment identity, editing and deletion. Lock the current index-bearing key behavior before adaptation. |
| C52   | Neutral plugin `SegmentTimeline` editing track                        | Adapt its existing horizontal axis, zoom, selection and segment widths independently of vertical list geometry.                              |
| C53   | Neutral plugin `MaterialFilterBar` platform native selector           | Investigate the full source directory and actual cost; preserve the native control.                                                          |
| C54   | Neutral plugin `MaterialFilterBar` tag native selector                | Preserve full tag choices and material-session filter drafts.                                                                                |
| C55   | Neutral plugin `MaterialCollectionToolbar` collection native selector | No small collection bound; retain full selection and the originating deletion confirmation.                                                  |
| C56   | Neutral plugin `TagMaintenanceToolbar` tag choices                    | Preserve query, original tag identity and rename/delete sessions.                                                                            |
| C57   | Neutral plugin `TagFilterBar` platform choices                        | Separate from theme filters; keep neutral control session ownership.                                                                         |
| C66   | Neutral plugin `TagDetailsPanel` platform statistics                  | Separate from its three fixed navigation entries and C24's theme-owned association slots.                                                    |

Use the [recorded branch inventory](../../../baselines/virtual-lists/2026-11-03-p00-p03/collection-surfaces.json) to locate candidate callers. Recheck current source and select one reusable batch before editing.
