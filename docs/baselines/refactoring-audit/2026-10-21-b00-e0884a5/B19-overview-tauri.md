---
documentType: audit-handoff
runtimeScope: tauri
---

# B19 移动能力边界排查交接

2026-10-21 初审，2026-10-22 完成 B19-A01 描述修复。基线 `a693165205be0bc321764768d796d7c842f7a446` 及报告中的工作区文件哈希。已完成 Android 能力/ACL 子批次，另记 iOS 配置拒绝边界；B19 整体未完成。本轮仅修改 Android 能力描述。

| 范围                        | 重构状态 / 结论            | 当前证据                                                  |
| --------------------------- | -------------------------- | --------------------------------------------------------- |
| Android 能力、ACL、启动门槛 | `conformant / pass-scoped` | B19-A01 已修复；本轮边界检查及 2 项测试通过，初审证据保留 |
| iOS 配置拒绝边界            | `conformant / pass-scoped` | 本地权限及不可用能力声明符合；只有离线与宿主测试          |
| iOS 实际适配与交付          | `unreviewed / blocked`     | 无真实工程、适配器及 macOS/Xcode 验收证据                 |

Android 已核对 API 26、WebView 111 原生启动检查、精确主 WebView 权限、预览端口和移动 `none` 策略。**B19-A01（P3，已修复）**：`main-android.json:3` 现明确包含账号代理及账号绑定媒体，与 `mobile.toml:15-34` 一致。修复前后除 `description` 外的 JSON 内容深度相等，有效权限、平台及 WebView 选择器保持一致。

本轮验证：移动边界检查及 2 项现有 Node 拒绝路径测试通过。初审的 2 项 Node、7 项前端、3 项宿主原生测试与 Android arm64 Clippy 证据保留为历史；原生首轮缺文件失败及重试通过日志也保留。本轮为描述修正，未新增测试，未运行原生构建或设备实测；没有新的 APK/AAB/iOS 产物或 live 证据。

保存/Keystore、生命周期、账号/代理/媒体、签名、最低设备/渠道仍待查。S16 已记录的 x86_64 Release 冷启动与强制 Activity 重建失败未复现、未关闭。下一批唯一入口：`B19-android-document-save-keystore`。

详细证据：[Android 修复验证](B19-android-capabilities-acl-tauri-fix.json)、[Android 初审报告](B19-android-capabilities-acl-tauri.json)、[iOS 边界报告](B19-ios-capability-boundary-tauri.json)、[初审基线与哈希](B19-mobile-capability-boundaries-tauri-baseline.json)、[S16 当前矩阵](../../../en/cross-platform/architecture/plugin-system-s16-mobile-delivery.md)。
