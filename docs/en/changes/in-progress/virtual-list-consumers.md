---
documentType: change-steps
runtimeScope: shared
status: paused
---

# Studio queue and playlist list integration

[中文](../../../zh-cn/变更/修改中/虚拟列表接入.md)

**Paused.** The next unfinished batch is Studio Listen Later (C04) and playlist track detail (C05). Reuse the measured table and styled grid from Studio Favorites. [Current consumers](../../modules/ui/virtual-lists.md) and [implemented batches awaiting acceptance](../acceptance/README.md) have their own records.

- [ ] Inspect `StudioCollection` queue and playlist paths, current tests, and the proven Favorites adapter.
- [ ] Bind the existing scroll owner and semantic return/focus. Preserve queue insert/remove/reorder and the full filtered order. In playlist detail, measure track/detail/action rows as one unit and preserve scoped selection, confirmations and return state.
- [ ] Verify bounded mounting, immutable updates, full-collection actions and focus/keyboard differences in owning tests. Then record each implemented runtime's acceptance scenarios and remaining gates.

Next: open the Studio queue path and confirm its scroll root, order and focus contracts. Other consumer families are in [future plans](../../plans/future/README.md#virtual-list-consumers).
