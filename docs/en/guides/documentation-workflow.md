---
documentType: maintenance-guide
runtimeScope: repository
---

# Documentation and change workflow

[中文](../../zh-cn/开发指南/文档变更流程.md)

## Find the relevant file

Start in the [documentation index](../README.md). Read the relevant module section, nearest `AGENTS.md`, implementation and tests. Use the matching status entry only when checking or resuming work. Expand to other modules when a real dependency or affected contract calls for it. The system overview maps ownership, the modules describe current behavior, and delivery matrices and scoped evidence determine which targets/cases have passed. If these disagree with the checked-out implementation, identify the difference and update the owner in the same change. Carry the user's latest intent into the task record.

## Start and resume a change

Before adding, changing or removing code or configuration, create a step document under [In progress](../changes/in-progress/README.md) and link it in the index. Use one descriptive filename in both workflow stages, with a counterpart in the other language. Record the goal in the user's terms, affected runtime/module, steps and how to verify the result. Documentation-only work can use the same format when coordination warrants it.

**Keep small fixes small. A few lines and one targeted check are enough for a small change. Avoid defensive overengineering and speculative validation.** Scale steps and checks to actual risk and user intent. Group related edits in one record. Split large work at independent ownership, implementation or acceptance boundaries. Start the implementation in the same task unless a real dependency blocks it.

Use `documentType`, `runtimeScope` (`repository`, `shared`, `userscript` or `tauri`) and the status below. This is a minimum step document for a small fix:

```md
---
documentType: change-steps
runtimeScope: userscript
status: in-progress
---

# Restore the launcher shortcut

[中文](relative-counterpart-path.md)

Make the configured shortcut open the launcher after a host-page reload.

- [ ] Correct the launcher listener lifetime.
- [ ] Run the focused shortcut regression.

Next: inspect the listener registered at startup.
```

Keep the first screen current. Check off completed steps, state what remains and give a concrete next action when pausing or handing off. Record a blocker only when it affects that action. Use `paused` when work is set aside. When the user changes direction, revise the goal and steps in place, or move a useful superseded option to [Discarded plans](../plans/discarded/README.md). For parallel work, each independent change holds its own steps and affected contracts.

## Accept and close

| Status and home                                                                          | How to use it                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `in-progress` / `paused` · [In progress](../changes/in-progress/README.md)               | Implementation or correction remains. Keep the current diff scope and next action discoverable.                                                                                                                                                                                  |
| `awaiting-acceptance` · [Acceptance](../changes/acceptance/README.md)                    | Move the step record here when implementation is ready for review. Check common affected scenarios. Record actual result for each relevant runtime/scope. Failed or unrun required cases stay open.                                                                              |
| `passed` · [Acceptance](../changes/acceptance/README.md)                                 | Mark the agreed acceptance scope passed when its checks pass. Update the current module contracts and relevant matrix. Keep a compact record only if the decision or evidence will still be used.                                                                                |
| `temporary-accepted` · [Temporary acceptance](../changes/temporary-acceptance/README.md) | Move here only with explicit user approval to proceed with an incomplete or unpassed scope. Record the decision/date, approved release or use scope, gaps, affected scenarios, and exactly what to recheck. Move back to acceptance for retesting, or to in progress for repair. |
| `proposed` · [Future plans](../plans/future/README.md)                                   | A possible direction. When selected, turn the next useful tranche into steps in the active index and link remaining ideas if needed.                                                                                                                                             |
| `discarded` · [Discarded plans](../plans/discarded/README.md)                            | Retain a useful alternative, its reason for rejection, and what would make it worth revisiting. Reactivate it through a new step or a moved record.                                                                                                                              |

One change has one current record and one status index per locale. Move it and update inbound links in the same edit. Acceptance may be split into independently checkable units with their own scopes. When the user narrows acceptance criteria, record the agreed scope and the checks actually run. Temporary approval leaves the named gaps open. Native capabilities and target admission still follow their owning contracts.

Match evidence to the build, runtime and scenario. Keep source website captures, installed GM, and Rust separate. Run live browser/application/device checks only on explicit request in the current task. Use repository checks appropriate to the change and follow pre-commit gates when committing. Report routine results in the task handoff. Keep durable evidence and original identities only when they support an open case, current admission/security/recovery or a reproducible comparison.

## Update both locales and the current owner

Update implemented behavior and known limitations in the affected module as part of the same change. Link the pending acceptance if the code is present and its runtime checks are open. Keep the overview and indexes small. Preserve exact identifiers, UI strings and external fields. Keep platform contracts' `documentType`, `platform` and actual `captureDate`. Follow [language and reporting rules](development-workflow.md).

Before closeout, verify changed links, anchors, bilingual counterparts and formatting. Remove completed steps and redundant reports once their durable decisions and relevant evidence are in the owning files. Inspect incoming links and code/check consumers before deleting a record or baseline. Keep useful discarded alternatives separate from pass records.
