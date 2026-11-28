---
documentType: change-steps
runtimeScope: repository
status: awaiting-acceptance
---

# Release 0.2.1

[中文](../../../zh-cn/变更/验收/发布0-2-1.md)

Prepare a patch release from `hotfix/catalog-grid-focus` for the [Discover grid focus fix](catalog-grid-focus.md).

- [x] Synchronize the product versions with `pnpm release:prepare 0.2.1 5` and verify them with `pnpm check:release`.
- [x] Pass the local pre-commit gates on Windows x64.
- [ ] Verify the candidate matrix in the hotfix PR into `main` and record independent review and runtime acceptance for its commit.
- [ ] Publish the annotated `v0.2.1` tag from the accepted merge commit, verify the GitHub Release and back-merge to `develop`.

Local checks passed for `pnpm privacy:setup`, `pnpm check:privacy`, `pnpm check:privacy:history`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm check:native`, `pnpm check:rust:msrv` and `pnpm check:rust:deny`. The production build used Node 24.22.1, pnpm 10.23.0 and Rust 1.91.1. A retry succeeded after Windows denied replacement of the previous executable. The rebuilt executable reports 0.2.1.

Record the candidate commit, independent approval and the Windows Bilibili Track Actions and return flow before tagging.
