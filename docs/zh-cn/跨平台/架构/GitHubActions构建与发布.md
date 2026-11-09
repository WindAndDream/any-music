---
documentType: development-guide
runtimeScope: repository
---

# GitHub Actions 构建与发布

英文对应页：[GitHub Actions Builds and Releases](../../../en/cross-platform/architecture/github-actions-release.md)。

仓库提供 Windows 全仓检查工作流，以及 Userscript、Windows x64、macOS arm64/x64、Linux x64、Android arm64/x64 的构建发布工作流。正式发布要求 Android 正式签名。iOS 有独立的模拟器构建检查。运行能力、插件执行准入和待验收事项由[桌面运行端指南](../../桌面端/运行端架构.md)与 [S16 矩阵](插件系统重构S16手机交付.md)维护。

## 工作流与产物

`.github/workflows/ci.yml` 在 PR 及 `main`、`develop`、`release/**`、`hotfix/**` 推送时运行，也供发布工作流复用。PR 额外运行 `Git Flow policy`，检查分支流向、标题和非 merge 提交格式；feature/fix 推送通过其 PR 验证，避免重复构建。Windows job 执行五项根检查、原生发布检查、Rust MSRV 和 cargo-deny。Node 由 `.node-version` 固定，pnpm 由 `packageManager` 固定，Rust 由 `rust-toolchain.toml` 固定；外部 Action 固定到已核对的 Commit SHA。

`.github/workflows/release.yml` 先解析一个确定的 Commit，复用 CI，再独立构建所有声明目标。`scripts/native-targets.json` 统一维护桌面 Runner、target、安装包类型，以及 Android 工具链和 versionCode。发布构建使用锁定的依赖图与明确的原生 features，不包含诊断 features。

目标为 `main` 的 PR 会自动基于 PR merge Commit 构建完整的未签名候选矩阵。只有全部预期构建和产物校验成功，`Release candidate checks` 才成功；依赖失败或跳过不能让此门禁通过。普通 feature/fix 合入 `develop` 的 PR 运行 CI，不逐个平台生成安装包。推送附注 `v*` Tag 后构建已签名 Android 产物，再进入受保护的发布 job。在 GitHub 页面手动创建 Release 不会触发此工作流。

Android job 先安装固定版本的 SDK 命令行工具，再安装声明的平台、build-tools 和 NDK，并额外为锁定的 Tauri Android 库安装 API 36。应用平台使用 Google 的包版本号（API 37 对应 `37.0`）。

| 目标              | 产物                | 签名                                      |
| ----------------- | ------------------- | ----------------------------------------- |
| Userscript        | `any-music.user.js` | 不适用                                    |
| Windows x64       | NSIS `*-setup.exe`  | 未签名                                    |
| macOS arm64/x64   | 各自的 `.dmg`       | 临时签名，无 Apple 公证                   |
| Linux x64         | `.AppImage`、`.deb` | 未签名                                    |
| Android arm64/x64 | 各自的 APK/AAB      | 候选未签名（`-unsigned`）；正式发布已签名 |

未签名 Android APK 需要签名后才能安装。已签名 APK/AAB 会执行既有的签名、签名者一致性、manifest、归档和对齐检查。按 ABI 分开的 AAB 仍需分发渠道验收；签名不代表已验证 Play 提交。缺少签名密钥时发布失败，不回退到 debug 签名或未签名模式。本地配置签名环境后，可用 `pnpm build:mobile:android aarch64 --release --signed` 构建 arm64 签名包。

## 接受贡献前配置 GitHub

保留 `main` 默认分支并创建 `develop`。在 **Settings → General → Pull Requests** 开启 merge commit，关闭 squash/rebase merge，并保持自动删除分支关闭。在 **Settings → Rules → Rulesets** 为 `main`、`develop`、`release/*` 激活分支保护：仅 PR、独立批准、新提交使旧批准失效、最近推送需他人批准、讨论全部解决、分支保持最新、禁止强推/删除、管理员不可绕过。各分支要求 `Privacy and secrets`、`Git Flow policy`、`Repository checks (Windows x64)`；仅 `main` 额外要求 `Release candidate checks`，候选工作流不覆盖目标为 `develop` 或 `release/*` 的 PR。首次运行 PR，让 GitHub 识别检查名称后再选择。不要启用线性历史。分支责任和首次导入约束见 [Git Flow](GitFlow团队规范.md)。

为 `v*` 分别建立创建权限与禁止修改/删除的标签规则：仅发布维护者可创建，修改和删除规则不允许绕过。在 **Settings → Actions → General** 允许所引用的 Action（`actions/*`、`pnpm/action-setup`、`Swatinem/rust-cache`、`android-actions/setup-android`），保留默认只读 token 权限和外部贡献者工作流运行审批。最终发布 job 显式申请自身写权限，无需 PAT 或工作流创建 PR 权限。在仓库安全设置中开启 dependency graph、Dependabot alerts、secret scanning 和 push protection，补充固定版本隐私门禁。

发布前在 **Settings → Environments** 创建以下环境。两者均选择 **Selected branches and tags**，只允许 **Tag** 类型的 `v*`，不添加分支规则。为 `release-publish` 配置发布审查者、禁止自我批准，并禁止管理员绕过保护；完整签名产物生成后才审批。禁止自我批准时，需要另一名审查者。若签名权限也需独立审批，可为 `release-signing` 配置审查者。

| 环境              | Secrets / 用途                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `release-signing` | `ANDROID_KEYSTORE_BASE64`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` |
| `release-publish` | 最终产物审批，使用 `GITHUB_TOKEN`，不需要签名密钥                                                |

`ANDROID_KEYSTORE_BASE64` 填私有 JKS 的单行 Base64 内容，不填文件路径；两个密码 Secret 分别解锁密钥库和私钥，alias Secret 指定正式密钥。使用 environment secrets，不放到整个仓库通用的 secrets。密钥仅在工具链安装完成后注入签名构建步骤。包装脚本在检出目录外的 `RUNNER_TEMP` 以私有权限恢复密钥，从子进程环境移除 Base64 值，并在构建成功或失败后删除文件。密钥与密码不进入产物或被跟踪的 Gradle 配置。

Windows 本地 Android 签名材料可保存在 `%USERPROFILE%\.android\any-music\release` 等私有目录，仅允许当前 Windows 账号访问。加密 JKS 和 Base64 导出均保存在 Git 外并安全备份；Base64 文件同样属于私钥材料。应用升级需保持相同签名身份。密码、本机绝对路径和私有文件不进入本文或 Git 历史。Windows 受信任代码签名需要相应机构签发的证书或服务；macOS Developer ID 签名/公证需要 Apple 签发的凭据，本地自签证书不能提供这些发布者信任链。

## 只构建，不发布

工作流合并到 GitHub 默认分支后，进入 **Actions → Release → Run workflow**，保持 `publish` 关闭。`ref` 可以填分支、Commit 或 Tag，留空时采用所选工作流分支。各目标产物和汇总后的 `distribution-assets` 保留 14 天，这条路径不需要 Git Tag。

所有 job 都构建解析后的同一个 Commit。只构建模式使用该 Commit 的产品版本命名和记录产物，即使对应 Tag 尚不存在；正式发布始终要求已存在且一致的产品 Tag，以及干净的源码检出。本地源码尚未提交时，产物会记录 `sourceDirty: true`，这些产物不能通过此工作流发布。

### 本地构建单个目标

在仓库根目录运行 `pnpm release:build --list` 查看目标和产物格式。传入一个目标 ID 后，产物会按 CI 的命名规则写入 `dist/release/<target>/`。

| 命令                               | 构建环境或工具链                                |
| ---------------------------------- | ----------------------------------------------- |
| `pnpm release:build userscript`    | 安装 Node 和 pnpm 的任意主机                    |
| `pnpm release:build windows-x64`   | Windows 和 x64 MSVC Rust 工具链                 |
| `pnpm release:build macos-arm64`   | Apple Silicon Mac、Xcode 和 arm64 Rust 工具链   |
| `pnpm release:build macos-x64`     | Intel Mac、Xcode 和 x64 Rust 工具链             |
| `pnpm release:build linux-x64`     | Linux x64、WebKitGTK 4.1 和 Tauri 打包依赖      |
| `pnpm release:build android-arm64` | Android SDK/NDK 和 `aarch64-linux-android` 目标 |
| `pnpm release:build android-x64`   | Android SDK/NDK 和 `x86_64-linux-android` 目标  |

Linux CI 使用 Ubuntu 22.04。本机需安装 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/#linux)、AppImage 打包工具 `patchelf`，以及原生密钥环所需的 `libkeyutils-dev` 和 `libdbus-1-dev`。在无法使用 FUSE 的容器中构建时，设置 `APPIMAGE_EXTRACT_AND_RUN=1`。[Android 环境配置](../../../../README.md#android-开发)列出了 SDK 组件和本地签名命令。

### 在 macOS 构建 iOS

在 **Actions → iOS build check → Run workflow** 选择 ref，即可构建未签名的 arm64 模拟器 `.app`，ZIP 产物独立保存在 Actions。在已安装 Xcode 和 iOS 模拟器运行时的 Apple Silicon Mac 上，以下命令会生成 Xcode 工程并构建应用，无需启动模拟器。

```sh
pnpm --filter @any-music/tauri tauri ios init
pnpm --filter @any-music/tauri tauri ios build --target aarch64-sim --no-sign -- --locked --no-default-features
```

真机分发需使用符合 [Apple 提交要求](https://developer.apple.com/news/upcoming-requirements/)的 Xcode 和 iOS SDK。为 `com.anymusic.app` 配置 Apple Developer 团队、分发证书和描述文件后，在仓库根目录运行 `pnpm build:mobile:ios`。命令以 App Store Connect 模式导出 arm64 IPA 到 `apps/tauri/src-tauri/gen/apple/build/arm64/`。iOS 尚无纳入维护的 Xcode 工程、签名构建证据或渠道验收，目前未进入 GitHub Release 矩阵。签名配置见 [Tauri iOS 签名指南](https://v2.tauri.app/distribute/sign/ios/)。

## 准备版本并发布

根 `package.json` 维护产品版本。发布准备命令同步两个应用包的版本、`tauri.conf.json`、应用 Cargo 版本及其根锁文件记录。SDK、协议和独立包版本分别管理。

```sh
pnpm release:prepare 0.1.1 2
pnpm check:release
```

第二个参数是 Android versionCode，取值为 1 到 2100000000 的整数。修改产品版本时必须增大此值，同一版本重新构建时可以沿用。在 `release/*` 或 `hotfix/*` 准备，按 [Git Flow 审批与验收](GitFlow团队规范.md) 合并到 `main` 后，获取已验收的发布 merge 提交，再创建、推送一致的附注 Tag：

```sh
git fetch origin --tags
git tag -a v0.1.1 origin/main -m "Release 0.1.1"
git push origin v0.1.1
```

初始版本已统一为 `0.1.0`，versionCode 为 `1`。测试版可使用 `0.1.1-beta.1`／`v0.1.1-beta.1`。构建元数据（`+suffix`）、带前导零的数值标识和大于 65535 的安装包版本分量会被拒绝。普通 Tag 发布正式版，测试版不会替换 GitHub 的 latest 正式版。

Android 的现有 Gradle 工程读取自动生成的 `app/tauri.properties`。每次 `build:mobile:android` 都从同一产品版本、versionCode、NDK 和 build-tools 版本重新生成该文件，文件由 Git 忽略；干净检出无需任何本机版本文件，Gradle 使用声明的 SDK 工具链。

手动发布必须打开 `publish`，在 `ref` 填写已存在的附注 `vVERSION` Tag，并在 **Use workflow from** 选择同一个 Tag。Tag 校验拒绝轻量标签，要求提交属于已获取的 `origin/main` 历史；发布前和公开 Release 前还会重新检查远端 main 的祖先关系。分支和任意 Commit 只适用于只构建模式。核对签名产物后，完成 `release-publish` 环境审批。

## 完整性与重试

各构建 job 只整理指定格式，并在 `artifact.json` 中记录目标、签名模式、产品版本、解析后的 Commit、文件大小与 SHA-256。汇总阶段拒绝缺失／额外目标、签名模式不符、过期版本、不同 Commit、额外文件和被改动的字节，生成包含工具链及全部产物信息的 `release-manifest.json`、`release-notes.md` 和 `SHA256SUMS`。只读汇总 job 上传 `distribution-assets`，独立受保护的发布 job 下载并重新验证这些原始字节。未签名候选产物不能正式发布。

只有最后的 job 获得 `contents: write`，使用普通 `GITHUB_TOKEN`，不需要个人访问令牌。它重新核对远程 Tag，创建 Draft、上传文件并核对文件名及大小，公开发布前再次核对 Tag。汇总失败不会创建 Release，上传失败则保留 Draft。临时故障可以重跑同次运行的失败 job；工作流或源码修复后需要选择修复后的工作流和源码发起新运行。重跑会替换该次运行的构建产物，只有属于同一 Commit 的 Draft 才能续传。脚本不会覆盖已经公开的 Release，应发布新版本。

同一 ref 的发布串行执行。成功的目标 job 会各自上传产物；汇总产物和发布要求所有目标都成功。CI 不启动产品、浏览器或模拟器。构建成功不会变更外置插件目标准入、开放移动执行、证明安装包关联，或替代账号／播放／设备实测。

官方参考：[GitHub Runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)、[部署环境](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)、[Tauri 分发](https://v2.tauri.app/distribute/)、[Android 签名](https://v2.tauri.app/distribute/sign/android/)、[Windows 签名](https://v2.tauri.app/distribute/sign/windows/)、[macOS 签名](https://v2.tauri.app/distribute/sign/macos/)、[GitHub CLI Release](https://cli.github.com/manual/gh_release)。
