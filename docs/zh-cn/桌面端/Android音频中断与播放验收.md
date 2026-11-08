---
documentType: runtime-acceptance
runtimeScope: tauri
---

# Android 音频中断与播放验收

英文对应文档：[Android audio interruptions and playback acceptance](../../en/desktop/android-audio-acceptance.md)。

## 播放职责

Android 普通歌曲与编译后的自定义叶子共用稳定工作台的媒体元素。运行端注入 `playbackEnvironment.preferMediaElement`，不会在 WebView 之外另外申请一个 AudioManager 焦点持有者。叶子仍使用现有有界描述预取窗口、原生账号绑定的回环／Range 传输、取消与最终完整渲染兜底。该路径不承诺 Web Audio 的无缝调度。

WebView 提供方负责媒体元素的焦点丢失／恢复与压低音量。已就绪的自定义叶子收到暂停时清除播放意图，内部换源暂停则保留意图；系统恢复同一叶子后同步实际播放状态。永久焦点丢失后需要明确重新播放。提供方差异需要现场证据，`play()` 成功或“播放中”图标都不足以单独证明实际输出。

私有 Kotlin 适配器观察 `ACTION_AUDIO_BECOMING_NOISY`、Activity 停止与 AudioManager 的非普通音频模式。API 31+ 使用模式监听；API 26–30 仅在前台每 500 毫秒检查一次。前台心跳同步新文档，仅在其状态变化时触发事件；渲染器在首次原生状态到达前阻止播放。插件晚注册时根据 Activity 的实际生命周期初始化，冷启动无需先退后台再进入。提示不携带设备身份、电话号码或凭证，不授予原生权限；没有新增电话／蓝牙运行时权限、Chromium 私有接口或渲染器 IPC 命令。

后台、通信音频模式与输出断开会取消播放代次、未完成的解析／兼容读取、自定义预取并释放媒体授权。界面只保留逻辑进度与稳定歌曲／配方。迟到的元数据、时间、错误与结束事件不能重启播放、覆盖进度或推进队列。返回前台／恢复可用不会重放工作；明确点击播放才重新解析媒体并从保留位置继续。受阻期间选择歌曲不会发出媒体请求。下载和任务重放仍遵循独立的挂起规则。

普通歌曲自然结束后清除播放意图。中断进度已到末尾时从零重播；分段自定义歌曲完整结束后，首次明确播放就重新加载首个叶子，避免立刻再次触及最后一个叶子的结束位置。回归测试覆盖取消、迟到授权／事件、受阻选曲、原生叶子选择及各条重播路径。

## 设备与场景矩阵

每轮记录准确签名 APK 哈希、Android API、WebView 提供方／版本、ABI、音频路由、媒体／系统音量与 OEM 音频设置。本轮证据与 T13 分开，见 [2026-10-26 音频记录](../../baselines/android-audio/2026-10-26.json)，其中保留前一天的完整播放基线。

| 场景                            | 必需证据                                               | 当前范围                                         |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| 普通来源完整播放                | 描述／原生字节、从开头到自然结束的进度、结尾无 AM-7001 | 参考 arm64 签名优化版；准确哈希见记录            |
| 自定义叶子                      | 两个片段边界的原生媒体、跳转／暂停、结束与取消         | 两个 30 秒叶子完整结束；最终结束重播已修复并复验 |
| 短暂焦点丢失                    | 另一 UID 获得真实焦点，产品同步暂停／恢复              | 最终自定义媒体通道配合独立原生探针通过           |
| 永久焦点丢失                    | 产品暂停，竞争方释放后不自行重启                       | 普通媒体通过，不自行重播                         |
| 压低音量                        | 真实焦点栈、产品输出衰减／恢复、用户音量不变           | 焦点协商通过；实际衰减幅度未测量                 |
| 通信音频模式                    | 产品停止、旧工作保持取消、恢复可用后需明确播放         | 原生模式探针通过，不等同电话                     |
| HOME／恢复                      | 输出停止、保留进度、不重放任务，明确播放可恢复         | 参考 arm64 优化版通过                            |
| 真实来电／通话及 VoIP           | 响铃／接听／挂断、通话期间不误恢复、设备路由           | 后移：没有第二台通话设备                         |
| 蓝牙 A2DP／SCO 与有线／USB 设备 | 连接、实际输出路由、拔出／断连、控制与通话路由         | 后移：没有可用耳机                               |
| 其他来源、最低设备与提供方      | 每种组合独立的签名优化版传输及上述场景                 | 待验收，不继承此手机结果                         |

参考小米手机最初开启系统选项“允许多声音同时发声”，原生报告 `mIgnrMusicFocusReq=true`，这是明确的 OEM 混音策略。标准焦点检查临时关闭该项，确认原生标志为 false，结束后恢复原设置。OEM 策略与标准焦点样本分别记录，应用不覆盖用户的系统选择。

## 重复焦点探针

获得明确现场检查授权后，以 `AM_ANDROID_ADAPTER_TEST=1`、`AM_ANDROID_AUDIO_PROBE=1`、`AM_ANDROID_SIGNED_BUILD=0` 和 Gradle `:app:assembleArm64Debug -x :app:rustBuildArm64Debug` 构建独立探针。它使用 `com.anymusic.audioprobe`，没有产品 JNI 库或网络权限，不替换／读取产品数据。若已有测试宿主，应保留并明确处理，不能静默卸载。只有探针以 API 34 为目标，便于其后台接收器申请焦点，同时正式 API-37 目标应用始终保持前台／恢复状态；普通适配器测试与生产目标仍为 37。

仅探针构建包含 `AudioFocusProbeReceiver`，接受固定 `focus` 值 `transient`、`gain`、`duck` 或 `communication`，申请真实系统焦点并在八秒后释放。通过明确命令 `am broadcast -n com.anymusic.audioprobe/com.anymusic.app.AudioFocusProbeReceiver --es focus transient` 触发，不启动 Activity。通信场景使用静音原生输出并申请自身的 `MODE_IN_COMMUNICATION`，结束时撤回二者；它模拟 VoIP 音频模式，不能证明真实电话行为。需同时捕获前／中／后的原生焦点／输出与产品界面，每项触发前确认产品确有原生输出；探针申请成功不能单独证明实际音量压低。结束后只卸载本轮测试宿主。早先 Activity 实验混入后台取消，不计入焦点验收。

正式优化版校验器拒绝已编译清单中的探针组件，生产源码集不会包含其实现。物理耳机与真实电话不能用该探针或人工 noisy 广播替代。

官方参考：[Android 音频焦点](https://developer.android.com/media/optimize/audio-focus)、[音频输出变化](https://developer.android.com/media/platform/output)及 [Chromium AudioFocusDelegate](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/AudioFocusDelegate.java)。源码解释职责，不替代准确提供方／设备的现场验收。
