---
documentType: module-contract
runtimeScope: shared
---

# Virtual lists, grids and tables

[中文](../../../zh-cn/板块/界面/虚拟列表.md)

`packages/ui` owns the renderer-only `ui/virtual-scroll` entry. It exposes pooled scroll contexts, fixed/measured lists, responsive grids and legal HTML table units, using the pinned TanStack adapter. Themes inject their actual scroll roots, controlled identities and existing skins; the host keeps filtering, ordering, selection, paging, media and writes over the full collection.

## Geometry and lifetime

- Use stable occurrence keys, immutable full geometry and bounded visible rows plus overscan. The logical card row uses its tallest natural cell. A flat keyed parent preserves visible card scopes across column changes. CSS owns widths, columns and gaps. `VirtualTrackCardGrid` uses implicit `0px` columns and compressed tracks for offscreen intervals. `VirtualTable` measures a keyed `tbody` unit with its detail rows, preserving legal row/column structure and full ARIA positions.
- Mount measured natural border-box units with a pooled observer. Cache at most the active measurement generation (512 entries by default). Width, content and style generations invalidate heights. Row membership changes invalidate affected stretched rows; same-row reorder and unchanged maxima can reuse geometry. True spatial changes still reconstruct O(N) rows. Ingress, eviction and width batches keep an independent motion baseline. Follow the [motion contract](motion-and-gestures.md).
- `useVirtualItemRetention` defaults to eight active occurrences and caps at 32. Retain only active drag, landing, editor and required focus/menu targets. Keep adapter registration alive across immutable snapshots, then dispose it on root or session replacement. `useVirtualScrollAnchor` leases scroll compensation and cancels stale work on user scroll, reset or replacement.
- The neutral `ui/theme` continuity contract stores transient occurrence, offset and control identity. `ui/library` resolves full geometry or native boxes. The theme transaction waits for the current lazy adapter, mounts offscreen targets before focus, and leases scroll ownership during restoration. Saved product snapshots exclude these values.
- Virtualized views use the window even when a result is small or empty. Filter and select over the complete data; native Ctrl+F / Cmd+F covers mounted DOM. Preserve reduced motion, keyboard alternatives and the [viewport-derived mounting budget](motion-and-gestures.md#72-viewport-based-mounting-budget).

## Current consumers

| Entry                                                                                                      | Current activation                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classic Favorites, Listen Later, playlist overview/details, playback history, downloads. Studio Favorites. | The normal `dev` profile uses windowing. Staging and production use full rendering pending [library-list acceptance](../../changes/acceptance/virtual-library-lists.md).                                                                          |
| Classic request directory and non-Douyin catalog track results                                             | Windowing is integrated independently of the library development gate. See [catalog acceptance](../../changes/acceptance/virtual-catalog-lists.md).                                                                                               |
| Douyin results in the Tauri desktop app, plus the Windows child result WebView                             | Both themes use the desktop catalog viewport port. The child keeps scroll/checkpoint and full loaded/filter semantics. The Windows handoff and other runtime cases have separate [acceptance](../../changes/acceptance/virtual-catalog-lists.md). |

See [current list work](../../changes/in-progress/virtual-list-consumers.md) for the next consumer.
