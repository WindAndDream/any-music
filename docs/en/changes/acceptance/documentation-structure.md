---
documentType: change-acceptance
runtimeScope: repository
status: passed
---

# Documentation structure acceptance

[中文](../../../zh-cn/变更/验收/文档体系.md)

**Passed for repository documentation.** Both language indexes route to current module contracts, active steps, regular and temporary acceptance, future proposals and discarded alternatives. The [documentation workflow](../../guides/documentation-workflow.md) and root and package guides use the new paths.

- Checked maintained Markdown links and anchors, reciprocal counterparts, index reachability and status directories. `pnpm format:check`, `git diff --check`, `pnpm check:privacy` and `pnpm check:privacy:history` pass.
- Earlier completed theme migration outputs without current references were removed. Retained baseline bytes and source capture metadata were verified. Runtime code and pending device, browser and exact-target acceptance are outside this documentation acceptance.
