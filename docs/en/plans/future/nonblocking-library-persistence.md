---
documentType: future-plan
runtimeScope: shared
status: proposed
---

# Nonblocking library persistence

[中文](../../../zh-cn/计划/未来/非阻塞资料库持久化.md)

**Proposed (S00).** Complete product generations still perform O(N) work. Compact 10k-item measurements associate visible stalls with persistence even when only bounded rows are mounted. The [checksum allocation experiment](../discarded/synchronous-checksum-optimization.md) was reverted.

First define async preparation and a serialized commit port for the workbench and both runtime adapters. Detach candidate data, validate complete staged/read-back data and budgets, retain canonical checksums and crash recovery, and recheck revision/session on return from a yield. Specify ordering, cancellation, flushing, disposal and error propagation. Keep yields outside the current synchronous lock; decide any storage format changes independently.

Acceptance needs complete-commit and preference-write regressions, crash/interleaving/stale-writer tests in both runtimes, and matched comparisons of total time and uninterrupted main-thread work. Keep persistence stalls in end-to-end sidebar/list results.
