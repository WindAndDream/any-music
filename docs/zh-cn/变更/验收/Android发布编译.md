---
documentType: change-steps
runtimeScope: tauri
status: awaiting-acceptance
---

# 恢复 Android 发布编译

[English](../../../en/changes/acceptance/android-release-compilation.md)

解除发布 PR #34 的阻塞，并在下次发版前发现 Android 引用桌面专用 API 的问题。[失败的候选构建](https://github.com/WindAndDream/any-music/actions/runs/46036941839)中，Android arm64 和 x64 都因内嵌账号 WebView 的生命周期及布局操作报出 `E0599`。

- [x] 子 WebView 的关闭、布局和焦点操作仅在桌面端编译，Windows 及测试保留目录页面归属校验。
- [x] 将现有 Android arm64 原生检查纳入仓库必需 CI，两个 Android ABI 继续进入发布打包矩阵。
- [x] 本地复现 `E0599` 后通过 `pnpm check:mobile:android` 验证修复。`pnpm check:mobile:boundaries` 和 `actionlint` 也已通过。
- [x] 在 Windows x64 上使用 NDK 30.0.16248370 和 OpenJDK 25.0.3，执行 `pnpm build:mobile:android x86_64 --release` 和 `pnpm build:mobile:android aarch64 --release`，生成未签名的 APK 和 AAB。`pnpm test`、`pnpm check:native`、`pnpm check:rust:msrv` 和 `pnpm check:rust:deny` 均通过。
- [ ] 验证必需 Android CI 及更新后的发布候选版本。已安装版本实测和签名发布验证仍属于发布验收范围。

下一步在发布修复 PR 中验证必需的 Android 检查。修复合入后，#34 必须重新构建更新后的候选版本。
