---
documentType: future-plan
runtimeScope: repository
status: proposed
---

# Resume the scoped architecture review

[中文](../../../zh-cn/计划/未来/架构分板块复查.md)

**Proposed follow-up.** The October B00–B21 review covered a subset of the repository. Its [scope and findings](../../../baselines/refactoring-audit/2026-10-21-b00-e0884a5/summary.json) and [closing report](../../../baselines/refactoring-audit/2026-10-21-b00-e0884a5/B21-summary.en.md) give the recorded coverage, pending candidates and dated evidence. Unreviewed candidates are open questions. New code is checked separately. Historical records keep their captured paths. The current reference for B19 is [mobile capabilities](../../modules/tauri/mobile.md).

If the review is resumed, start with B06 Userscript generation storage. Read its [runtime guide](../../modules/userscript/development.md) and [data ownership](../../modules/plugins/data-ownership.md), then trace one current write/recovery chain with focused fixtures. Record actual ownership and behavior, the smallest justified repair, and the verification scope. Other boards can be selected independently from the ledger. Use the [change workflow](../../guides/documentation-workflow.md) for selected work.
