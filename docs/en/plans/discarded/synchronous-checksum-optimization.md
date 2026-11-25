---
documentType: discarded-plan
runtimeScope: shared
status: discarded
---

# Synchronous checksum allocation experiment

[中文](../../../zh-cn/计划/废弃/同步校验和优化.md)

**Discarded and reverted.** This experiment reduced temporary checksum allocations inside the synchronous generation writer. Alternating compact10k complete commits showed overlapping latencies and a higher candidate median. The original writer was restored. The durable record preserves the measured scope and outcome. [Comparison](../../../baselines/virtual-lists/2026-11-06-c00-window-ingress/storage-review.json).

Revisit allocation-only work if a new profile attributes material complete-commit cost to it and matched full-write comparisons show a repeatable benefit. [Nonblocking persistence](../future/nonblocking-library-persistence.md) owns the remaining scheduling problem.
