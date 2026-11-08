## Problem and result

Describe the concrete problem, resulting behavior and related issue.

## Scope and commits

- Runtime: shared / userscript / tauri / repository
- Branch route and starting commit:
- Responsibility-based commit batches:
- Storage, public contract or migration impact:

## Validation

List commands and actual results for tests, typecheck, lint, format:check and build.
For native changes also list check:native, check:rust:msrv and check:rust:deny.
Link CI and external acceptance by commit, OS/architecture and toolchain.
State omitted live/browser/device checks and remaining limits explicitly.

## Review and synchronization

- [ ] Privacy and secret checks pass; author/committer metadata and captures are sanitized.
- [ ] Screenshots, logs and binary artifacts were checked for private data; privacy-policy changes received independent review.
- [ ] Correct Git Flow base/head; no unrelated feature changes during release freeze.
- [ ] Current CI passes and all conversations are resolved.
- [ ] An independent reviewer approves the current changes before merge.
- [ ] Release/hotfix: maintainer approval and tester acceptance name the candidate commit.
- [ ] Release/hotfix: back-merge destinations and branch cleanup owner are recorded.

Use Create a merge commit. Retain release/hotfix branches until every required back-merge is confirmed.
See [Git Flow policy](../docs/en/cross-platform/architecture/git-flow.md).
