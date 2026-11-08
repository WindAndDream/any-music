---
documentType: maintenance-guide
runtimeScope: repository
---

# Documentation Lifecycle and Agent Instructions

Chinese counterpart: [文档生命周期与代理约束](../../../zh-cn/跨平台/架构/文档生命周期与代理约束.md). Explicit user instructions and applicable repository guides take precedence.

## Find the authoritative owner

Start at the [documentation index](../../README.md), select the runtime/task and read relevant sections plus the nearest `AGENTS.md` and required skill. Indexes route readers to owners. Current guides own implemented contracts, delivery matrices own capability/target admission, and active plans own remaining tasks and acceptance. Source/tests establish implementation; live evidence applies only to its recorded build/device/scenario. Distinguish website, installed GM and Rust evidence; update `captureDate` only after a real recapture.

## Maintain current content

- Edit the existing owner before creating a page. New pages require a distinct durable responsibility or actionable unfinished work. Avoid duplicate plans, chronological status appendices and speculative compatibility instructions.
- Declare `documentType` and `runtimeScope`; preserve platform-contract metadata. Update both locales, counterparts, indexes, incoming links and changed anchors together. Keep identifiers and literal UI/source text exact.
- State current contracts and open limitations directly. Plans identify goal, owner/runtime, remaining actions and acceptance; remove completed steps as they become redundant. Correct obsolete facts in place.
- Report command results directly in the task handoff; do not save routine output or intermediate attempts to local log files unless explicitly requested. Durable evidence records only necessary method, build/artifact identity, result and limits; tests/builds do not establish unexecuted live acceptance.

## Remove completed and superseded material

Once useful decisions and invariants are in their current owner, delete completed checklists, superseded designs, migration inventories, duplicate handoffs and unused files. Do not create an archive or permanent completion record by default. An old design remains only if it specifies a still-needed unimplemented contract; label that scope explicitly.

Retain evidence only while it supports a current admission/security/recovery claim, an unresolved issue, an open acceptance comparison or a reproducibility requirement. Remove redundant pass counts, old command summaries and completed implementation narration from guides. Preserve pending gates; a documentation cleanup cannot accept a build or close an unexecuted case.

Before deleting a file, inspect incoming references and unique content, migrate needed contracts/open work, and update both locales and indexes. Do not discard modified/untracked work merely because of its age. Inspect baseline consumers before pruning raw evidence; Git history does not preserve uncommitted artifacts.

## Agent workflow and validation

Identify runtime and owner → inspect relevant implementation/constraints → update current facts → retain open gates and needed evidence → delete obsolete content → check affected paths, links, anchors and formatting. Use repository checks appropriate to the change. Browser/application/emulator inspection requires an explicit request in the current task. Report actual deletions, verification and remaining limits without treating historical evidence as a current workspace pass.
