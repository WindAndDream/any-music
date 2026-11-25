---
documentType: future-plan
runtimeScope: tauri
status: proposed
---

# iOS 原生交付

[English](../../../en/plans/future/ios-native-delivery.md)

**提案。** 当前应用有 iOS 配置和受限 IPC。构建与设备验收需要 macOS／Xcode 及合适的真机。见[移动端能力](../../板块/桌面与移动端/移动端能力.md)。

1. 使用锁定工具链生成和构建真实应用。验证 WKWebView 启动、私有状态、安全区和生命周期。
2. 实现有作用域的文件／分享、保存目标、Keychain 及可用的账号／代理／媒体适配器。请求遵循能力，保留取消、稳定记录和凭证隔离。
3. 签名真机产物验证经典／工作台的输入与恢复、播放下载中断、最低设备预算和系统对话框。渠道验收与设备记录分开。

外置包安装、DEV 和执行由独立的[移动插件计划](移动端外置插件.md)决定。
