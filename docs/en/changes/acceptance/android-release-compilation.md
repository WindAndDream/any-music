---
documentType: change-steps
runtimeScope: tauri
status: awaiting-acceptance
---

# Restore Android release compilation

[中文](../../../zh-cn/变更/验收/Android发布编译.md)

Unblock release PR #34 and detect desktop API leaks into Android before the next release. The [failed candidate build](https://github.com/WindAndDream/any-music/actions/runs/46036941839) reported `E0599` from embedded account WebView lifecycle and geometry on Android arm64 and x64.

- [x] Compile child WebView closing, geometry and focus operations for desktop only. Keep catalog ownership validation on Windows and in tests.
- [x] Run the existing Android arm64 native check as part of required repository CI. Both Android ABIs remain in the release packaging matrix.
- [x] Reproduce `E0599` locally and verify the fix with `pnpm check:mobile:android`. `pnpm check:mobile:boundaries` and `actionlint` also passed.
- [x] Build unsigned APKs and AABs with `pnpm build:mobile:android x86_64 --release` and `pnpm build:mobile:android aarch64 --release` on Windows x64 using NDK 30.0.16248370 and OpenJDK 25.0.3. `pnpm test`, `pnpm check:native`, `pnpm check:rust:msrv` and `pnpm check:rust:deny` passed.
- [ ] Verify required Android CI and the refreshed release candidate. Installed runs and signed release verification remain release acceptance items.

Next step is to verify the required Android check on the release-fix PR. After merge, PR #34 must rebuild its updated candidate.
