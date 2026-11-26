---
documentType: change-steps
runtimeScope: shared
status: paused
---

# Grid and sidebar performance

[中文](../../../zh-cn/变更/修改中/网格与侧栏性能.md)

**Paused.** C00/O00–O02 still have open runtime regressions. O01 skips complete geometry reconstruction for equivalent measurement updates; width batching and subscription reuse are implemented. Genuine row height/spatial changes still rebuild O(N) geometry. The installed GM small-list sidebar regression and native high-velocity cost remain unresolved.

- [ ] Reproduce GM sidebar reversal at 80 items and native fast scroll with real height changes when inspection is requested. Compare ordinary speed, fast scrolling and stress separately; fix the viewport, styles, build, dataset and motion settings before comparing.
- [ ] Attribute costs to input/layout, measurement/observer work, full-row geometry, rendering or storage. Use existing profiles to target demonstrated hotspots. Keep height changes, correct anchoring, drag/landing and rapid reversal intact.
- [ ] Run focused regressions and remeasure the affected scenarios. Report remaining misses with their build/runtime scope. Overall storage responsiveness depends on [separate persistence work](../../plans/future/nonblocking-library-persistence.md).

Next: reuse the [GM report](../../../baselines/virtual-lists/2026-11-06-c00-revalidation/userscript-review.json), [native report](../../../baselines/virtual-lists/2026-11-06-c00-revalidation/native-review.json), [window-ingress follow-up](../../../baselines/virtual-lists/2026-11-06-c00-window-ingress/native-review.json) and [O01 comparison](../../../baselines/virtual-lists/2026-11-07-o01-row-equivalence/verification.json) to select matched runs.
