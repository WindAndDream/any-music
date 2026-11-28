---
documentType: change-steps
runtimeScope: repository
status: awaiting-acceptance
---

# Release 0.2.0

[中文](../../../zh-cn/变更/验收/发布0-2-0.md)

Release the integrated changes from `origin/develop` at `066852a` through `main`. This minor release includes embedded Douyin account and Discover workflows, collection filter history, virtualized lists and automatic skipping of unavailable tracks.

The macOS app now requires macOS 14 or later.

- [x] Synchronize the Userscript and Tauri product versions and set Android `versionCode` to `4`. `pnpm check:release` passed for the prepared manifests.
- [x] Pass local verification on Windows x64 with Node 24.22.1, pnpm 10.23.0 and Rust 1.91.1. Passed `pnpm privacy:setup`, `pnpm check:privacy`, `pnpm check:privacy:history`, `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm build` (including `pnpm typecheck`), `pnpm check:native`, `pnpm check:rust:msrv` and `pnpm check:rust:deny`.
- [ ] Verify [release PR #34](https://github.com/WindAndDream/any-music/pull/34) after the [Android compilation fix](android-release-compilation.md) enters the release branch. Record candidate CI and acceptance.
- [ ] Merge into `main`, publish its annotated `v0.2.0` tag, verify the GitHub Release and back-merge `main` into `develop`.

Next step is to verify the release PR with the candidate build matrix and record the maintainer's and tester's acceptance for its commit. Installed runtime and device checks remain open.
