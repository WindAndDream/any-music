---
documentType: development-guide
runtimeScope: tauri
---

# Android 构建与验证

[English](../../en/guides/android-validation.md)

运行端能力见[移动端能力](../板块/桌面与移动端/移动端能力.md)，发布和音频状态见[修改内容验收](../变更/验收/文档索引.md)。

## 可重复 Android 发布与模拟器检查

从根目录运行；构建命令不授权实际应用检查：

```sh
pnpm build:mobile:android aarch64 --release
pnpm build:mobile:android aarch64 --release --signed
pnpm check:mobile:release aarch64
pnpm build:mobile:android x86_64
pnpm accept:mobile:android --serial emulator-5580
pnpm accept:mobile:android:device --serial DEVICE_SERIAL
```

签名要求同时提供 `AM_ANDROID_KEYSTORE`（绝对路径）、`AM_ANDROID_STORE_PASSWORD`、`AM_ANDROID_KEY_ALIAS`、`AM_ANDROID_KEY_PASSWORD`。密码不进入命令参数或被跟踪的 Gradle 文件；输入不全在构建前失败，不回退到 debug 签名。即使环境中有签名变量，未请求签名仍保持无签名模式。升级需保留所选私钥；本地验证签名不代表正式发布者或 Play 身份。

签名构建自动校验 APK 签名和单个非 debug 签名者、AAB 每项有效载荷的完整签名且与 APK 一致、真实 manifest 包名/最低与目标 SDK、非调试/非测试/禁备份/禁明文设置、无测试 provider、APK ZIP 16 KiB 对齐以及每个 ELF 的 ABI/LOAD 对齐。读取归档不解压，公开哈希/证书元数据写入 APK 旁的 `release-verification.json`。构建对齐不能证明在 16 KiB 设备运行正常。

实际验收脚本要求明确指定已经运行的专用 x86_64 模拟器和已有 debug 构建，拒绝默认/实体设备及已安装的测试包。脚本重建配对的应用/测试 APK，不删除产品数据，以 JUnit 完成结果判定通过，单列跳过项，记录设备/WebView/页大小/产物证据，并只清理自建测试 APK/调试转发；不清空 AVD，不注入 grant。纯原生测试覆盖适配与引擎边界；独立进程的 debug WebView 检查覆盖真实挂载/能力、桌面及私有桥接 IPC 拒绝、私网拒绝、前后台和强杀进程重启后全部活动 core/host/namespaces/archives 数据保留。比对规范化业务数据，排除镜像修订号与过期代次。旧引擎改验原生更新提示并明确报告 `bootstrapOnly`，不宣称工作台通过。报告位于忽略的 `.codex-tmp/s16-accept/`。

独立真机脚本要求明确指定 arm64 设备、已安装且字节完全匹配的已校验本地 Release。它在独立 UID 的临时 `com.anymusic.adaptertest`/`.test` 内运行同一份原生适配器源码，不含启动入口/网络权限/原生 JNI 库，安装前核对真实包身份，先初始化自有测试 provider，结束只移除这两个包。不替换或仪器化用户的 Release，不开启 Release 调试或放松 R8 规则；测试宿主的 Keystore 元数据说明被测适配器在该设备的保护能力，不代表产品已有密钥。仅测试宿主按 [Android 包可见性](https://developer.android.com/training/package-visibility/declaring) 声明查询自己的夹具 provider。手机必须允许 USB 安装；弹窗超时后可用 --prepared 重用已构建 APK，仍重复身份/Release 校验且不跳过仪器测试。直接对优化 Release 运行仪器测试曾因缺少 runner 专用 `androidx.tracing.Trace` 在测试前退出，不计为 Release 仪器测试通过。

同一仪器进程反复强制销毁/重建 Activity 时，暴露原生 `pthread_mutex_lock` 访问已销毁互斥锁的问题。该路径仍未验收，与通过的正常前后台/进程重启检查分别记录。脚本从产品进程外驱动检查，避免仪器框架清理反复拆除 Tauri 事件循环；这不修复或代表强制 Activity 重建已通过。

API 35 软件渲染 Release 模拟器在较慢的首次冷启动中还触发 Wry 0.57.0 `main_pipe.rs:421`：`GetUrl` 回复已取消后发送导致 panic。再次启动进程可显示工作台，实体手机的 Release 首次 Activity 启动报告 503 ms，之后截图确认工作台显示；失败环境的冷启动仍未验收。保留来源校验及 Release 安全设置，暖启动成功不能关闭该失败。

## 重复焦点探针

获得明确现场检查授权后，以 `AM_ANDROID_ADAPTER_TEST=1`、`AM_ANDROID_AUDIO_PROBE=1`、`AM_ANDROID_SIGNED_BUILD=0` 和 Gradle `:app:assembleArm64Debug -x :app:rustBuildArm64Debug` 构建独立探针。它使用 `com.anymusic.audioprobe`，没有产品 JNI 库或网络权限，不替换／读取产品数据。若已有测试宿主，应保留并明确处理，不能静默卸载。只有探针以 API 34 为目标，便于其后台接收器申请焦点，同时正式 API-37 目标应用始终保持前台／恢复状态；普通适配器测试与生产目标仍为 37。

仅探针构建包含 `AudioFocusProbeReceiver`，接受固定 `focus` 值 `transient`、`gain`、`duck` 或 `communication`，申请真实系统焦点并在八秒后释放。通过明确命令 `am broadcast -n com.anymusic.audioprobe/com.anymusic.app.AudioFocusProbeReceiver --es focus transient` 触发，不启动 Activity。通信场景使用静音原生输出并申请自身的 `MODE_IN_COMMUNICATION`，结束时撤回二者；它模拟 VoIP 音频模式，不能证明真实电话行为。需同时捕获前／中／后的原生焦点／输出与产品界面，每项触发前确认产品确有原生输出；探针申请成功不能单独证明实际音量压低。结束后只卸载本轮测试宿主。早先 Activity 实验混入后台取消，不计入焦点验收。

正式优化版校验器拒绝已编译清单中的探针组件，生产源码集不会包含其实现。物理耳机与真实电话不能用该探针或人工 noisy 广播替代。

官方参考：[Android 音频焦点](https://developer.android.com/media/optimize/audio-focus)、[音频输出变化](https://developer.android.com/media/platform/output)及 [Chromium AudioFocusDelegate](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/AudioFocusDelegate.java)。源码解释职责，不替代准确提供方／设备的现场验收。
