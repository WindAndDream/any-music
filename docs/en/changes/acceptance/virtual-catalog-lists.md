---
documentType: change-acceptance
runtimeScope: shared
status: awaiting-acceptance
---

# Catalog virtual-list acceptance

[中文](../../../zh-cn/变更/验收/目录虚拟列表.md)

**Awaiting acceptance.** C08/C20 integrate Classic request cards and non-Douyin results. C08 also integrates the desktop Douyin result view in the application and the Windows child WebView. Current callers are [listed here](../../modules/ui/virtual-lists.md#current-consumers).

- For Classic requests, check full filtered order/group reordering, actions and return position. In non-Douyin results, verify demand-based loading, filters, retry, short/empty pages and no repeated requests.
- For the desktop Douyin result view, verify unfiltered first-viewport fill within existing page/time budgets, host/child scroll checkpoint, focus, dialogs, loaded/filtered counts, final page, return to the app and original controls. Check a filtered-page path separately.
- Retain the same viewport owner, style, keyboard/touch semantics and authorization of actions through the [source page session](../../modules/tauri/source-page-sessions.md). Record the engine, actual build and result.

Next: check a Classic GM catalog and the Windows host/child handoff when live inspection is requested. Further catalog paths are tracked [under future plans](../../plans/future/virtual-catalog-consumers.md).
