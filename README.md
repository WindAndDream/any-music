---
documentType: project-overview
runtimeScope: repository
---

# Any Music

简体中文 | [English](README.en.md)

聚合、整理、播放与创作音乐的跨平台工作台。

Any Music 将 Bilibili、抖音和网易云音乐等来源中的音乐内容接入统一工作台，提供搜索与导入、收藏与歌单、播放队列、标签管理、片段编排和音频导出。项目采用 pnpm monorepo，基于 Vue 3、TypeScript、Vite、Tampermonkey 和 Tauri 2 / Rust，在用户脚本与原生应用之间复用产品逻辑，并分别实现网络、账号、存储和文件保存。

> 项目尚未正式发布，目前以源码开发与本地构建为主。用户脚本和 Tauri 桌面端是现有产品入口；Android 持续开发中，iOS 尚未完成。各端能力与验证范围见下表。

多人开发遵循 [Git Flow 团队规范](docs/zh-cn/跨平台/架构/GitFlow团队规范.md)，提交 PR 前请阅读[贡献指南](CONTRIBUTING.md)。

## 功能概览

- **多来源工作台**：内置 Bilibili、抖音和网易云音乐来源，支持搜索、受支持链接与列表的导入、按需分页；具体可用范围取决于来源、登录状态与运行端。
- **音乐库与播放**：收藏、歌单、稍后听、播放队列和播放历史；普通来源播放与自定义歌曲共用播放器。
- **标签管理**：为音乐添加标签，通过搜索、筛选和排序整理资料库；标签功能由独立内置插件提供。
- **片段创作**：管理素材集合与草稿，裁剪、组合音频片段，支持嵌套引用自定义歌曲，并导出 MP3 / WAV。
- **下载管理**：单曲与批量下载、并发控制、重试、取消和下载历史；单曲保存为 MP3，多曲批次打包为 ZIP 并附带结果报告。
- **桌面账号与代理**：按平台管理多个账号，隔离登录凭据与连接环境，支持账号检查、代理及备用连接；实际请求与凭据由 Rust 管理。
- **插件与主题**：内置来源、标签、创作和主题采用模块化装配；桌面外置插件提供受控安装、授权、回滚、命令与元数据目录能力。

音乐库保存稳定的来源标识和创作配方，播放时再解析媒体。临时媒体地址、音频字节和最终保存路径不会写入产品快照。用户脚本与 Tauri 使用独立存储，不会自动同步数据。

## 运行端与支持范围

| 运行端                      | 当前能力                                                                                                                                  | 主要边界                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **用户脚本 / Tampermonkey** | 在网页中通过悬浮入口打开共享工作台，内置 Bilibili、抖音与网易云音乐来源；隐藏面板可继续播放和下载                                         | 使用 GM 请求、浏览器登录态和独立 GM 存储；单宿主账号环境，代理受浏览器与脚本管理器支持限制；仅支持内置插件                |
| **桌面 / Tauri**            | 共享工作台、原生保存、多账号、独立代理和系统浏览器登录验证                                                                                | 当前桌面验证主要覆盖 Windows；macOS / Linux 尚未验证。外置插件仅在通过准入的精确系统与执行环境组合中启用                  |
| **Android / Tauri**         | 已有 Android 工程、签名 APK/AAB、文档保存与 Keystore 适配；参考调试设备已验证 Bilibili 登录、搜索、前台播放、跳转、MP3 保存和原生代理请求 | 要求 Android API 26、WebView 111+；优化 Release 的媒体/代理、音频中断、最低设备及发布渠道验收尚未完成；不支持外置插件执行 |
| **iOS / Tauri**             | 保留配置与共享能力边界                                                                                                                    | 原生工程、登录、媒体及设备验收尚未完成；不支持外置插件执行                                                                |

Android 已有参考 arm64 真机的 Release 启动与生命周期检查，但这不代表全部功能已通过 Release 验收。移动端暂不提供后台播放保证。详细范围见 [Tauri 运行端](docs/zh-cn/桌面端/运行端架构.md)、[桌面插件支持矩阵](docs/zh-cn/跨平台/架构/插件系统重构S15工具与桌面交付.md)和[移动端工程记录](docs/zh-cn/跨平台/架构/插件系统重构S16手机交付.md)。

## 从源码开始

所有项目命令均在仓库根目录执行。新电脑先完成公共环境准备，再选择用户脚本、桌面或 Android 流程；仅构建用户脚本无需安装 Rust、JDK 或 Android SDK。

### 准备环境

- Git 和 Node.js **24.11+**，统一覆盖仓库内插件作者工具的版本要求。
- pnpm **10.23.0**，与根 `package.json` 的 `packageManager` 一致。
- 用户脚本需要浏览器及 Tampermonkey。

安装 Node.js 后，安装匹配版本的 pnpm 并获取源码；已有仓库时跳过 `git clone`，进入现有仓库根目录：

```powershell
npm install --global pnpm@10.23.0
git clone https://github.com/WindAndDream/any-music.git
cd any-music
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm privacy:setup
```

提交前配置 GitHub noreply 邮箱，阅读[贡献指南](CONTRIBUTING.md)和[隐私与密钥规范](docs/zh-cn/跨平台/架构/隐私与密钥规范.md)，不能提交真实账号数据或凭据。

保留 `pnpm-lock.yaml` 和 `Cargo.lock`。迁移或拉取更新后重新执行 `pnpm install --frozen-lockfile`，在当前电脑重建依赖链接；不要从旧电脑复制 `node_modules` 或构建缓存。首次原生构建还会下载 Cargo、Gradle 和 Maven 依赖，需要可访问相应依赖仓库。

### 原生应用前置条件（Windows）

桌面和 Android 构建还需要 Rust 及本机编译工具：

1. 安装 [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，选择 **Desktop development with C++（使用 C++ 的桌面开发）**，包含 MSVC 与 Windows SDK。
2. 通过 [rustup](https://www.rust-lang.org/tools/install) 安装 Rust，Windows 使用 MSVC 工具链；在仓库根目录安装固定版本及检查组件：

   ```powershell
   rustup toolchain install 1.91.1 --profile minimal --component rustfmt --component clippy
   rustc --version
   cargo --version
   ```

3. 运行 Windows 桌面应用还需要 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section)；账号的系统浏览器验证需要已安装的 Chrome / Edge。

安装完成后重新打开终端、IDE 或 Codex，让进程加载新的环境变量。仓库通过 `rust-toolchain.toml` 选择 Rust **1.91.1**，无需修改全局默认版本。macOS / Linux 使用各自的 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)；iOS 需要 macOS / Xcode，当前项目的 iOS 工程与验收仍未完成。

### 用户脚本

```bash
pnpm dev                  # 启动用户脚本的 dev 环境
pnpm build:userscript     # 仅构建 prod 环境用户脚本
```

构建产物位于 `apps/userscript/dist/any-music.user.js`，可通过 Tampermonkey 导入安装。安装后刷新普通 HTTP(S) 顶层页面，通过悬浮入口展开工作台。需要登录的平台功能依赖相应网站的登录状态。

开发页面中的 GM 替身用于开发调试。需要在 Tampermonkey 中联调真实 GM 请求时：

```powershell
pnpm setup:userscript
```

命令启动／复用正式版 Chrome/Edge 的固定配置，检查篡改猴是否已安装、启用且允许用户脚本；缺失时打开官方商店等待确认安装，并启动本地服务、检查开发连接。首次在浏览器确认安装 `server:Any Music`，以后保留 `.local/userscript-browser/` 即可复用，无需反复安装。可用 `--browser edge` 选择 Edge，或用 `--browser-only` 只准备浏览器。在同一配置中停用生产脚本，避免重复入口。开发脚本与生产脚本存储独立；最终仍需构建并安装生产产物验证权限与启动。详见[用户脚本开发规范](docs/zh-cn/用户脚本/开发规范.md)。

### 桌面应用

```bash
pnpm dev:tauri            # 启动 Tauri 开发应用
pnpm build:tauri          # 构建 prod 原生应用，不生成安装包
pnpm start:tauri          # 启动已构建的应用
pnpm bundle:tauri         # 生成当前平台的安装包
```

`dev:tauri` 会自动启动前端服务和原生窗口，无需再单独启动前端。Windows 生产可执行文件位于 `target/release/any-music-tauri.exe`，安装包位于 `target/release/bundle/`；`start:tauri` 使用已有的 Release 可执行文件，源码变更后先重新构建。`build:tauri:dev` 生成 Debug 产物，不用于 `start:tauri`。

构建安装包不代表已完成签名、自动更新或分发验收；其他操作系统仍需各自的构建依赖与验证。详见[桌面运行端](docs/zh-cn/桌面端/运行端架构.md)。

各平台构建命令、iOS 构建检查、Android 签名与 Tag 触发的 GitHub Release 见[GitHub Actions 构建与发布](docs/zh-cn/跨平台/架构/GitHubActions构建与发布.md)。手动运行默认只构建。

### Android 开发

以下是 Windows 新环境的完整流程；先完成上面的公共环境与原生前置条件。

#### 1. 安装 Android 工具链

| 工具                           | 当前工程使用的版本或组件                                          |
| ------------------------------ | ----------------------------------------------------------------- |
| 完整 JDK                       | **21**（与 CI 一致），包含 `java`、`javac` 和 `keytool`           |
| Android SDK Platform           | **37**，另装 **36** 供锁定的 Tauri Android 库使用                 |
| Android SDK Build-Tools        | **36.0.0**                                                        |
| Android NDK                    | **30.0.16248370**                                                 |
| 其他 SDK 组件                  | Platform-Tools、Command-line Tools（latest）                      |
| Gradle / Android Gradle Plugin | **9.6.1 / 9.3.1**，由工程配置自动下载，无需全局安装 Gradle        |
| Rust Android 目标              | `aarch64-linux-android`（手机）、`x86_64-linux-android`（模拟器） |

使用 JDK 21 与发布 CI 保持一致。`JAVA_HOME` 指向 JDK 根目录。见 [AGP 9.3 兼容性表](https://developer.android.com/build/releases/agp-9-3-0-release-notes#compatibility)。

通过 [Android Studio 的 SDK Manager](https://developer.android.com/studio/intro/update#sdk-manager) 安装表中组件，勾选 **Show Package Details** 选择具体版本；也可从 [Android 下载页](https://developer.android.com/studio#command-line-tools-only) 获取 Command-line Tools，解压为 `<SDK>/cmdline-tools/latest/`，确保其中包含 `bin/` 和 `lib/`。

#### 2. 配置本机环境变量

以下 PowerShell 示例使用当前用户目录下的 `software/programming/compiler`；按实际安装位置调整路径，不要把个人绝对路径写入仓库：

```powershell
$toolchainRoot = Join-Path $env:USERPROFILE 'software/programming/compiler'
$env:JAVA_HOME = Join-Path $toolchainRoot 'temurin-21'
$env:ANDROID_HOME = Join-Path $toolchainRoot 'android-sdk'
$env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk/30.0.16248370'

# 同时保存到用户环境，供下次启动的终端、IDE 和 Codex 使用。
foreach ($variableName in @('JAVA_HOME', 'ANDROID_HOME', 'NDK_HOME')) {
    [Environment]::SetEnvironmentVariable($variableName, (Get-Item "Env:$variableName").Value, 'User')
}
$androidPathEntries = @(
    (Join-Path $env:JAVA_HOME 'bin')
    (Join-Path $env:ANDROID_HOME 'platform-tools')
    (Join-Path $env:ANDROID_HOME 'cmdline-tools/latest/bin')
)
$existingUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$updatedUserPath = (($androidPathEntries + ($existingUserPath -split ';')) |
    Where-Object { $_ } | Select-Object -Unique) -join ';'
[Environment]::SetEnvironmentVariable('Path', $updatedUserPath, 'User')
$env:Path = ($androidPathEntries -join ';') + ';' + $env:Path
```

环境变量的保存不会更新已经运行的其他进程，后续在新开的终端中核对。完整前置说明见 [Tauri Android 环境准备](https://v2.tauri.app/start/prerequisites/#android)。

#### 3. 补齐 SDK 包和 Rust 目标

通过 SDK Manager 安装完组件后可直接安装 Rust 目标。使用带有 `android.exe` 的新版 Command-line Tools 时，也可用下面的命令安装 SDK 包，并按提示处理许可：

```powershell
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/android.exe" sdk --sdk="$env:ANDROID_HOME" install platforms/android-37.0 platforms/android-36 build-tools/36.0.0 ndk/30.0.16248370 platform-tools
rustup target add --toolchain 1.91.1 aarch64-linux-android x86_64-linux-android
```

旧版 Command-line Tools 没有 `android.exe` 时，使用其 [sdkmanager](https://developer.android.com/tools/sdkmanager)，不要混用两种包标识格式：

```powershell
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" --sdk_root="$env:ANDROID_HOME" "platforms;android-37.0" "platforms;android-36" "build-tools;36.0.0" "ndk;30.0.16248370" "platform-tools"
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" --sdk_root="$env:ANDROID_HOME" --licenses
```

确认安装和路径有效，再开始构建：

```powershell
& "$env:JAVA_HOME/bin/java.exe" -version
& "$env:JAVA_HOME/bin/javac.exe" -version
rustup target list --toolchain 1.91.1 --installed
Test-Path "$env:ANDROID_HOME/platforms/android-37*/android.jar"
Test-Path "$env:ANDROID_HOME/platforms/android-36/android.jar"
Test-Path "$env:ANDROID_HOME/build-tools/36.0.0/aapt2.exe"
Test-Path "$env:NDK_HOME/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android26-clang.cmd"
pnpm check:mobile:boundaries
pnpm check:mobile:android
```

`Test-Path` 应全部返回 `True`。Android Clippy 检查会编译原生依赖，但不启动模拟器或应用。

#### 4. 构建与查找产物

```powershell
pnpm build:mobile:android aarch64           # arm64 调试 APK
pnpm build:mobile:android x86_64            # x86_64 调试 APK
pnpm build:mobile:android aarch64 --release # 优化构建 APK / AAB
```

根脚本依次构建前端、Rust 原生库并调用 Gradle 打包，同时从锁定依赖重建本机 Gradle 路径、Tauri/Wry Kotlin 桥接和 Tauri ProGuard 规则。仓库已维护 Android 工程，**直接使用这些根命令，无需运行 `tauri android init`，也无需从旧电脑补传 `generated/` 文件**。单独执行 Gradle 不包含这些准备步骤。

产物以 `apps/tauri/src-tauri/gen/android/app/build/outputs/` 为根目录：

| 构建                     | 产物相对路径                                       |
| ------------------------ | -------------------------------------------------- |
| arm64 Debug APK          | `apk/arm64/debug/app-arm64-debug.apk`              |
| x86_64 Debug APK         | `apk/x86_64/debug/app-x86_64-debug.apk`            |
| arm64 未签名 Release APK | `apk/arm64/release/app-arm64-release-unsigned.apk` |
| arm64 签名 Release APK   | `apk/arm64/release/app-arm64-release.apk`          |
| arm64 Release AAB        | `bundle/arm64Release/app-arm64-release.aab`        |

Debug APK 自动使用调试签名，可用于调试安装。正式签名需在当前会话中提供 `AM_ANDROID_KEYSTORE`（私有密钥库绝对路径）、`AM_ANDROID_STORE_PASSWORD`、`AM_ANDROID_KEY_ALIAS`、`AM_ANDROID_KEY_PASSWORD`，再运行：

```powershell
pnpm build:mobile:android aarch64 --release --signed
pnpm check:mobile:release aarch64
```

签名构建会自动执行产物校验；第二条命令用于之后重新校验。妥善保管同一签名密钥供应用升级使用，密钥库与密码在仓库外单独迁移。未加 `--signed` 的 Release 产物仍为未签名状态，不能当作可安装的签名发布包。

#### 5. 安装到 Android 设备

设备需要 **Android API 26+、WebView 111+**。手机启用 USB 调试，连接并确认调试授权；模拟器需另外创建并启动匹配架构的 AVD。先用 `adb devices` 获取序列号，再在 PowerShell 中替换下面的示例值：

```powershell
adb devices
$deviceSerial = 'YOUR_DEVICE_SERIAL'
adb -s $deviceSerial install -r apps/tauri/src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
adb -s $deviceSerial shell am start -W -n com.anymusic.app/.BootstrapActivity
```

x86_64 模拟器改用上表对应的 APK。覆盖安装需要与已有应用的签名一致；如出现签名冲突，先确认安装包和设备上的版本，卸载会清除该应用数据。自动化设备测试、签名校验细节和现有验收边界见[移动端工程记录](docs/zh-cn/跨平台/架构/插件系统重构S16手机交付.md)。生成 APK 不验证真机功能，本地构建也不会发布到应用商店。

### 环境模式

支持 `dev`、`staging`、`prod` 三种模式，配置位于根目录 `.env.<mode>`：

| 用途           | 命令                                                                                    |
| -------------- | --------------------------------------------------------------------------------------- |
| 用户脚本开发   | `pnpm dev` / `pnpm dev:staging` / `pnpm dev:prod`                                       |
| 仅构建用户脚本 | `pnpm build:userscript:dev` / `pnpm build:userscript:staging` / `pnpm build:userscript` |
| 仅构建桌面端   | `pnpm build:tauri:dev` / `pnpm build:tauri:staging` / `pnpm build:tauri`                |
| 全仓库构建     | `pnpm build:dev` / `pnpm build:staging` / `pnpm build`                                  |

`pnpm dev` 默认使用 `dev`，`pnpm build` 默认使用 `prod`。业务代码通过 `import.meta.env.VITE_APP_ENV`（`'dev' | 'staging' | 'prod'`）与 `VITE_APP_DEBUG`（`'true' | 'false'`）读取环境。所有 `VITE_` 值会进入客户端产物，环境文件中不要保存密钥。

### 迁移到另一台电脑与常见问题

同步源码、`pnpm-lock.yaml`、`Cargo.lock`、构建脚本和文档，再在新电脑重复环境准备、依赖安装和目标构建。构建流程的修复也需要提交并同步，另一台电脑才能使用。

| 内容                                                                                                                          | 迁移方式                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 源码、Android 工程中的维护代码、配置和锁文件                                                                                  | 通过 Git 同步                              |
| Node、pnpm、Rust、JDK、SDK/NDK、C++ 工具与环境变量                                                                            | 在每台电脑安装并配置                       |
| `node_modules`、`target/`、Gradle 缓存、`generated/`、`tauri.settings.gradle`、`tauri.build.gradle.kts`、`proguard-tauri.pro` | 保持忽略，由安装或根构建脚本重新生成       |
| `local.properties`、私有签名密钥与密码                                                                                        | 使用本机实际路径；签名材料在仓库外安全迁移 |

| 现象                                                              | 排查与处理                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 找不到 Java，或提示缺少 `JAVA_HOME` / `ANDROID_HOME` / `NDK_HOME` | 核对安装目录和环境变量，重新打开终端、IDE 或 Codex；JDK 需完整安装，`JAVA_HOME` 不指向 `bin`                         |
| SDK 路径仍指向旧电脑                                              | 检查被忽略的 `apps/tauri/src-tauri/gen/android/local.properties` 中 `sdk.dir`，移除旧覆盖值或改成本机路径            |
| Kotlin 提示找不到 `TauriActivity` 等桥接类                        | 同步最新构建脚本，再执行 `pnpm build:mobile:android aarch64`；桥接文件被忽略是预期行为                               |
| pnpm 入口、依赖链接或路径异常                                     | 确认 pnpm 版本并重新执行 `pnpm install --frozen-lockfile`；根 Android 脚本支持 pnpm 的 Node 和独立 `.exe` 入口       |
| Gradle/Maven 下载出现 TLS 或网络错误                              | 检查本机网络、代理和证书设置后重试相同构建命令；保留已下载缓存，保持证书验证开启                                     |
| 笔记本首次编译内存不足                                            | 在当前 PowerShell 会话设置 `$env:CARGO_BUILD_JOBS = '4'` 限制 Rust 并行任务，再执行构建；Gradle 内存另按本机资源配置 |

AMD/NVIDIA 显卡更换无需修改 APK 编译配置。模拟器图形、驱动和硬件加速是单独的运行环境配置，按 [Android 模拟器说明](https://developer.android.com/studio/run/emulator-acceleration)处理。

## 项目结构

```text
apps/
  userscript/                 # Tampermonkey 入口、GM 网络与存储、页面桥接
  tauri/                      # 桌面 / 移动应用、IPC 与 Rust 原生适配
packages/
  music-workbench/            # 共享工作台、播放、音乐库和下载编排
  ui/                         # 受控 Vue 组件、面板与样式
  core/                       # 音乐模型、业务规则和平台接口
  audio-composition/          # 片段配方、时间线、预取与可选浏览器编解码
  account-pool/               # 账号选择与租约
  network-routing/            # 请求竞争、取消和代理健康状态
  plugin-source-*/            # Bilibili / 抖音 / 网易云协议、分页与媒体解析
  plugin-tag-management/      # 内置标签功能
  plugin-music-creation/      # 内置素材与创作功能
  plugin-center/              # 插件身份、生命周期与贡献管理
  plugin-ui-vue/              # 插件界面渲染与可信主题装配
  plugin-sdk/                 # 公共 DTO、协议与 Schema
  plugin-vm/                  # 固定 QuickJS 执行内核
  plugin-sandbox-browser/     # Worker 资源与受限执行会话
  plugin-cli/                 # 插件构建、打包、签名与 DEV 工具
  plugin-testkit/             # 同 VM 插件测试工具
crates/                       # Rust 插件协议、策略、权限、网络和包校验
scripts/                      # 构建、边界检查与验证工具
docs/                         # 中英文设计、开发文档与验收记录
```

应用注入网络、存储、登录、媒体和保存能力；共享包不依赖应用。用户脚本通过 `GM_xmlhttpRequest` 访问来源，桌面通过 IPC 调用 Rust 原生能力。具体依赖方向见[项目架构](docs/zh-cn/跨平台/架构/项目架构.md)与[可复用包边界](docs/zh-cn/跨平台/架构/可复用包边界.md)。

## 插件开发

内置来源、标签与创作插件随应用构建装配。外置 `.amplugin` 包通过原生校验、明确授权及目标准入后，才能在受支持的桌面环境中安装或执行。

- [CLI](packages/plugin-cli/README.md)：模板创建、检查、固定构建、打包、签名和隔离 DEV 调试。
- [SDK](packages/plugin-sdk/README.md)：插件声明、版本化协议与受控能力接口。
- [testkit](packages/plugin-testkit/README.md)：在与产品一致的 VM 中运行插件测试。

SDK / CLI / testkit 当前版本为 **0.1.0**，可本地打包，尚未发布到包注册表。现有模板覆盖元数据目录、标签建议与文本导出；**外置目录尚不支持媒体解析、播放或下载**。用户脚本与移动端的外置插件策略均为 `none`。插件市场、自动更新及更广的平台支持不属于当前已交付能力，详见[插件实现进度](docs/zh-cn/跨平台/架构/插件系统重构实施步骤.md)。

## 检查与贡献

提交前运行：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

根测试与类型检查包含 Rust 检查，全仓库构建也包含 Tauri，因此需要准备原生工具链。仅修改某个模块时，可先运行 `pnpm --filter <包名> test` 与对应类型检查。

涉及原生实现时，额外运行：

```bash
rustup toolchain install 1.90.0 --profile minimal
cargo install cargo-deny --locked
pnpm check:native
pnpm check:rust:msrv
pnpm check:rust:deny
```

前两条仅在新环境准备完整原生检查时执行；MSRV 检查需要独立的 Rust 1.90.0，依赖检查需要 `cargo-deny`。Android 改动另执行 `pnpm check:mobile:boundaries`、`pnpm check:mobile:android` 和对应目标构建。

开发约定见 [AGENTS.md](AGENTS.md) 和[开发工作流](docs/zh-cn/跨平台/架构/开发工作流.md)。自动化检查、网站接口观察、实际 GM 请求、Rust 请求和真机验收分别记录，不能互相替代。

## 文档导航

| 内容         | 入口                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 全部文档     | [中文索引](docs/zh-cn/文档索引.md) · [English index](docs/en/README.md)                                                                         |
| 运行端开发   | [用户脚本](docs/zh-cn/用户脚本/开发规范.md) · [桌面端](docs/zh-cn/桌面端/开发规范.md)                                                           |
| 架构与模块   | [项目架构](docs/zh-cn/跨平台/架构/项目架构.md) · [可复用包边界](docs/zh-cn/跨平台/架构/可复用包边界.md)                                         |
| 产品与交互   | [音乐库与自定义歌曲](docs/zh-cn/跨平台/功能设计/本地资料库与自定义插件.md) · [跨端界面与交互](docs/zh-cn/跨平台/功能设计/跨端界面与交互规范.md) |
| 来源协议     | [音乐源插件架构](docs/zh-cn/跨平台/架构/音乐源插件架构.md)                                                                                      |
| 当前交付范围 | [桌面插件矩阵](docs/zh-cn/跨平台/架构/插件系统重构S15工具与桌面交付.md) · [移动端工程记录](docs/zh-cn/跨平台/架构/插件系统重构S16手机交付.md)   |
