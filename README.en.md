---
documentType: project-overview
runtimeScope: repository
---

# Any Music

[简体中文](README.md) | English

A cross-platform workbench for discovering, organizing, playing and creating music.

Any Music brings music content from sources such as Bilibili, Douyin and NetEase Cloud Music into one workbench, with search and imports, favorites and playlists, playback queues, tags, segment composition and audio export. Built as a pnpm monorepo with Vue 3, TypeScript, Vite, Tampermonkey and Tauri 2 / Rust, it shares product logic across the userscript and native applications while implementing networking, accounts, storage and file saving separately.

> The project is not yet released. Development currently starts from source and local builds. The userscript and Tauri desktop app are the existing product entries; Android is in active development, and iOS is incomplete. Capabilities and verification scope differ by runtime.

Team development follows the [Git Flow policy](docs/en/cross-platform/architecture/git-flow.md); see [Contributing](CONTRIBUTING.md) before opening a PR.

## Features

- **Multiple music sources**: built-in Bilibili, Douyin and NetEase Cloud Music adapters provide search, supported link and listing imports, and on-demand pagination. Availability depends on the source, login state and runtime.
- **Library and playback**: favorites, playlists, Listen Later, playback queues and history, with one player for source tracks and custom compositions.
- **Tag management**: organize the library with tags, search, filters and sorting through an independent built-in plugin.
- **Segment composition**: manage material collections and drafts, trim and combine audio segments, reference nested custom tracks, and export MP3 / WAV.
- **Download management**: individual and batch downloads, concurrency control, retries, cancellation and history. Single tracks save as MP3; multi-track batches produce a ZIP with a result report.
- **Desktop accounts and proxies**: manage multiple accounts per platform with isolated credentials and connection environments, account checks, proxies and backup connections. Rust owns requests and credentials.
- **Plugins and themes**: built-in sources, tags, creation and themes use modular assembly. Desktop external plugins offer controlled installation, consent, rollback, commands and metadata catalogs.

The library stores stable source identities and composition recipes, resolving media when needed. Temporary media URLs, audio bytes and final save paths stay out of product snapshots. Userscript and Tauri storage are separate and do not synchronize automatically.

## Runtime support

| Runtime                       | Current capabilities                                                                                                                                                                                            | Boundaries                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Userscript / Tampermonkey** | Shared workbench through a floating launcher on web pages, with built-in Bilibili, Douyin and NetEase Cloud Music sources; hiding the panel preserves playback and downloads                                    | GM requests, browser login state and separate GM storage; one host account environment, with proxy support dependent on the browser and script manager; built-in plugins only                   |
| **Desktop / Tauri**           | Shared workbench, native saving, multiple accounts, isolated proxies and system-browser login verification                                                                                                      | Desktop verification currently centers on Windows; macOS / Linux remain unverified. External plugins require an exact admitted system and execution environment                                 |
| **Android / Tauri**           | Android project, signed APK/AAB builds, document saving and Keystore adapters; a reference debug device has verified Bilibili login, search, foreground playback, seeking, MP3 saving and native proxy requests | Requires Android API 26 and WebView 111+; optimized-release media/proxy, audio interruption, minimum-device and distribution-channel acceptance remain incomplete; no external plugin execution |
| **iOS / Tauri**               | Configuration and shared capability boundaries                                                                                                                                                                  | Native engineering, login, media and device acceptance remain incomplete; no external plugin execution                                                                                          |

A reference arm64 Android phone has also passed release-launch and lifecycle checks; this does not establish release acceptance for every feature. Mobile background playback is not currently guaranteed. See the [Tauri runtime](docs/en/desktop/runtime-architecture.md), [desktop plugin matrix](docs/en/cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md) and [mobile engineering record](docs/en/cross-platform/architecture/plugin-system-s16-mobile-delivery.md) for detailed scope.

## Getting started from source

Run all project commands from the repository root. On a new computer, prepare the common environment, then choose the userscript, desktop or Android workflow. Userscript-only builds do not require Rust, a JDK or the Android SDK.

### Prerequisites

- Git and Node.js **24.11+** to also meet the requirements of the repository's plugin author tools.
- pnpm **10.23.0**, matching `packageManager` in the root `package.json`.
- A browser with Tampermonkey for the userscript.

After installing Node.js, install the matching pnpm version and obtain the source. For an existing checkout, skip `git clone` and enter its root directory:

```powershell
npm install --global pnpm@10.23.0
git clone https://github.com/WindAndDream/any-music.git
cd any-music
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm privacy:setup
```

Before contributing, configure your GitHub noreply email and read [Contributing](CONTRIBUTING.md) and [Privacy and Secret Handling](docs/en/cross-platform/architecture/privacy-and-secrets.md). Never commit real account data or credentials.

Keep `pnpm-lock.yaml` and `Cargo.lock`. Run `pnpm install --frozen-lockfile` after moving the checkout or pulling updates to recreate dependency links on the current computer; do not copy `node_modules` or build caches from the previous machine. Initial native builds also download Cargo, Gradle and Maven dependencies and need access to their repositories.

### Native prerequisites on Windows

Desktop and Android builds also require Rust and native compiler tools:

1. Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**, including MSVC and the Windows SDK.
2. Install Rust through [rustup](https://www.rust-lang.org/tools/install), using the MSVC toolchain on Windows. Install the pinned version and check components from the repository root:

   ```powershell
   rustup toolchain install 1.91.1 --profile minimal --component rustfmt --component clippy
   rustc --version
   cargo --version
   ```

3. Running the Windows desktop app also requires [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section). Account verification through the system browser needs installed Chrome / Edge.

Reopen the terminal, IDE or Codex after installation so processes load the new environment. `rust-toolchain.toml` selects Rust **1.91.1** for the repository without changing the global default. macOS / Linux require their respective [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/). iOS requires macOS / Xcode; this project's iOS engineering and acceptance remain incomplete.

### Userscript

```bash
pnpm dev:userscript       # Start development in dev mode; pnpm dev is equivalent
pnpm build:userscript     # Build only the userscript in prod mode
```

Import the output at `apps/userscript/dist/any-music.user.js` into Tampermonkey. Refresh a normal top-level HTTP(S) page and expand the floating launcher to open the workbench. Platform features that require authentication use the corresponding website's login state.

The development page uses GM doubles. To develop with real GM requests through Tampermonkey:

```powershell
pnpm setup:userscript
```

The command launches/reuses stable Chrome/Edge with a persistent profile and checks Tampermonkey installation, enablement and user-script permission. Missing Tampermonkey opens its official store for confirmation; the command also starts the local server and checks the development connection. Confirm installation of `server:Any Music` once, then retain `.local/userscript-browser/` to reuse it without repeated installation. Use `--browser edge` to select Edge or `--browser-only` to prepare only the browser. Disable the production script in the same profile to avoid duplicate launchers. Development and production scripts have separate storage. Build and install the production artifact for final permission and startup checks. See [Userscript Development](docs/en/userscript/development.md).

### Desktop app

```bash
pnpm dev:tauri            # Start the Tauri development app
pnpm build:tauri          # Build the prod native app without an installer
pnpm start:tauri          # Run the built app
pnpm bundle:tauri         # Generate installers for the current platform
```

`dev:tauri` starts both the frontend server and the native window; no separate frontend command is needed. The Windows production executable is `target/release/any-music-tauri.exe`, and installers are under `target/release/bundle/`. `start:tauri` runs the existing Release executable, so rebuild after source changes. `build:tauri:dev` produces Debug output and does not supply `start:tauri`.

Creating an installer does not establish signing, automatic-update or distribution acceptance; other operating systems still require their own build dependencies and verification. See the [desktop runtime](docs/en/desktop/runtime-architecture.md).

For automated candidate builds, signed Android publication and tag-triggered GitHub Releases, see [GitHub Actions Builds and Releases](docs/en/cross-platform/architecture/github-actions-release.md). Manual runs default to build-only mode.

### Android development

The following is the complete Windows setup. First finish the common environment and native prerequisites above.

#### 1. Install the Android toolchain

| Tool                           | Version or components used by the current project                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Full JDK                       | **17**, including `java`, `javac` and `keytool`                                                   |
| Android SDK Platform           | **37**, plus **36** for the locked Tauri Android libraries                                        |
| Android SDK Build-Tools        | **36.0.0**                                                                                        |
| Android NDK                    | **28.2.13676358** (r28c)                                                                          |
| Other SDK components           | Platform-Tools and Command-line Tools (latest)                                                    |
| Gradle / Android Gradle Plugin | **9.6.1 / 9.3.1**, downloaded through project configuration; no global Gradle installation needed |
| Rust Android targets           | `aarch64-linux-android` (phones), `x86_64-linux-android` (emulators)                              |

JDK 17 meets the current [AGP 9.3 build requirements](https://developer.android.com/build/releases/agp-9-3-0-release-notes#compatibility). The application's Java/Kotlin bytecode target of 1.8 does not mean JDK 8 should be installed. Use a standalone JDK or a compatible Android Studio JDK; `JAVA_HOME` must point to the actual JDK root.

Install the listed components through [Android Studio's SDK Manager](https://developer.android.com/studio/intro/update#sdk-manager), using **Show Package Details** to select exact versions. Alternatively, download Command-line Tools from the [Android download page](https://developer.android.com/studio#command-line-tools-only) and extract them into `<SDK>/cmdline-tools/latest/`, containing `bin/` and `lib/`.

#### 2. Configure local environment variables

This PowerShell example uses `software/programming/compiler` under the current user's directory. Adjust the paths to the actual installations; keep personal absolute paths out of the repository:

```powershell
$toolchainRoot = Join-Path $env:USERPROFILE 'software/programming/compiler'
$env:JAVA_HOME = Join-Path $toolchainRoot 'temurin-17'
$env:ANDROID_HOME = Join-Path $toolchainRoot 'android-sdk'
$env:NDK_HOME = Join-Path $env:ANDROID_HOME 'ndk/28.2.13676358'

# Persist user variables for newly started terminals, IDEs and Codex.
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

Saving environment variables does not update other running processes; check them in a newly opened terminal. See [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/#android) for the full prerequisite reference.

#### 3. Install SDK packages and Rust targets

If SDK Manager already installed the components, proceed to installing Rust targets. With newer Command-line Tools that include `android.exe`, these commands also install the SDK packages; follow any license prompts:

```powershell
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/android.exe" sdk --sdk="$env:ANDROID_HOME" install platforms/android-37.0 platforms/android-36 build-tools/36.0.0 ndk/28.2.13676358 platform-tools
rustup target add --toolchain 1.91.1 aarch64-linux-android x86_64-linux-android
```

Older Command-line Tools without `android.exe` use [sdkmanager](https://developer.android.com/tools/sdkmanager). Keep the two package identifier formats separate:

```powershell
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" --sdk_root="$env:ANDROID_HOME" "platforms;android-37" "platforms;android-36" "build-tools;36.0.0" "ndk;28.2.13676358" "platform-tools"
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" --sdk_root="$env:ANDROID_HOME" --licenses
```

Check the installations and paths before building:

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

Every `Test-Path` should return `True`. The Android Clippy check compiles native dependencies without starting an emulator or application.

#### 4. Build and locate artifacts

```powershell
pnpm build:mobile:android aarch64           # arm64 debug APK
pnpm build:mobile:android x86_64            # x86_64 debug APK
pnpm build:mobile:android aarch64 --release # Optimized APK / AAB build
```

The root script builds the frontend and Rust library, then packages through Gradle. It also recreates machine-local Gradle paths, Tauri/Wry Kotlin bridges and Tauri ProGuard rules from locked dependencies. The Android project is maintained in the repository: **use these root commands directly; do not run `tauri android init` or copy `generated/` files from another computer**. Running Gradle alone omits those preparation steps.

Artifact paths below are relative to `apps/tauri/src-tauri/gen/android/app/build/outputs/`:

| Build                      | Artifact path                                      |
| -------------------------- | -------------------------------------------------- |
| arm64 Debug APK            | `apk/arm64/debug/app-arm64-debug.apk`              |
| x86_64 Debug APK           | `apk/x86_64/debug/app-x86_64-debug.apk`            |
| arm64 unsigned Release APK | `apk/arm64/release/app-arm64-release-unsigned.apk` |
| arm64 signed Release APK   | `apk/arm64/release/app-arm64-release.apk`          |
| arm64 Release AAB          | `bundle/arm64Release/app-arm64-release.aab`        |

Debug APKs use automatic debug signing and can be installed for debugging. For release signing, provide `AM_ANDROID_KEYSTORE` (absolute private keystore path), `AM_ANDROID_STORE_PASSWORD`, `AM_ANDROID_KEY_ALIAS` and `AM_ANDROID_KEY_PASSWORD` in the current session, then run:

```powershell
pnpm build:mobile:android aarch64 --release --signed
pnpm check:mobile:release aarch64
```

Signed builds run artifact verification automatically; the second command repeats verification later. Preserve the same signing key for application upgrades and transfer the keystore and passwords separately outside the repository. Release output without `--signed` remains unsigned and is not an installable signed release package.

#### 5. Install on an Android device

Devices require **Android API 26+ and WebView 111+**. Enable USB debugging on a phone, connect it and approve debugging access. An emulator requires a separately created and started AVD with the matching architecture. Use `adb devices` to find the serial, then replace the example value in PowerShell:

```powershell
adb devices
$deviceSerial = 'YOUR_DEVICE_SERIAL'
adb -s $deviceSerial install -r apps/tauri/src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
adb -s $deviceSerial shell am start -W -n com.anymusic.app/.BootstrapActivity
```

For an x86_64 emulator, use its APK from the table instead. Replacement installs require the same signature as the installed application. On a signature conflict, check the package and installed version first; uninstalling clears that application's data. See the [mobile engineering record](docs/en/cross-platform/architecture/plugin-system-s16-mobile-delivery.md) for automated device tests, signature verification and current acceptance limits. Producing an APK does not verify device behavior, and local builds do not publish to app stores.

### Environment modes

The repository supports `dev`, `staging` and `prod`, configured in root `.env.<mode>` files:

| Purpose                | Commands                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| Userscript development | `pnpm dev:userscript:dev` / `pnpm dev:userscript:staging` / `pnpm dev:userscript:prod`       |
| Userscript-only build  | `pnpm build:userscript:dev` / `pnpm build:userscript:staging` / `pnpm build:userscript:prod` |
| Desktop-only build     | `pnpm build:tauri:dev` / `pnpm build:tauri:staging` / `pnpm build:tauri:prod`                |
| Repository-wide build  | `pnpm build:dev` / `pnpm build:staging` / `pnpm build:prod`                                  |

`pnpm dev` defaults to `dev`; `pnpm build` defaults to `prod`. Application code reads `import.meta.env.VITE_APP_ENV` (`'dev' | 'staging' | 'prod'`) and `VITE_APP_DEBUG` (`'true' | 'false'`). All `VITE_` values enter client output, so environment files must contain no secrets.

### Moving to another computer and troubleshooting

Synchronize source, `pnpm-lock.yaml`, `Cargo.lock`, build scripts and documentation, then repeat environment setup, dependency installation and the target build on the new computer. Build workflow fixes also need to be committed and synchronized for another checkout to use them.

| Content                                                                                                                         | Migration method                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Source, maintained Android code, configuration and lockfiles                                                                    | Synchronize through Git                                                           |
| Node, pnpm, Rust, JDK, SDK/NDK, C++ tools and environment variables                                                             | Install and configure on each computer                                            |
| `node_modules`, `target/`, Gradle caches, `generated/`, `tauri.settings.gradle`, `tauri.build.gradle.kts`, `proguard-tauri.pro` | Keep ignored; recreate through dependency installation or the root build script   |
| `local.properties`, private signing keys and passwords                                                                          | Use actual local paths; transfer signing material securely outside the repository |

| Symptom                                                             | Check and resolution                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Java missing, or `JAVA_HOME` / `ANDROID_HOME` / `NDK_HOME` required | Check installations and variables, then reopen the terminal, IDE or Codex. Install a full JDK and point `JAVA_HOME` to its root, not `bin`                    |
| SDK path still refers to the old computer                           | Check `sdk.dir` in the ignored `apps/tauri/src-tauri/gen/android/local.properties`; remove the stale override or use the current path                         |
| Kotlin cannot resolve `TauriActivity` or other bridge classes       | Synchronize the latest build scripts and run `pnpm build:mobile:android aarch64`; ignored bridge files are expected                                           |
| pnpm entry, dependency links or paths fail                          | Check the pnpm version and rerun `pnpm install --frozen-lockfile`. The root Android script supports both Node and standalone `.exe` pnpm entries              |
| Gradle/Maven downloads fail with TLS or network errors              | Check local network, proxy and certificate settings, then retry the same build. Keep downloaded caches and certificate verification enabled                   |
| Initial compilation exhausts laptop memory                          | Set `$env:CARGO_BUILD_JOBS = '4'` in the current PowerShell session to limit Rust parallelism, then build. Configure Gradle memory separately for the machine |

Changing AMD/NVIDIA GPUs does not require APK build configuration changes. Emulator graphics, drivers and hardware acceleration are separate runtime settings; follow the [Android emulator acceleration guide](https://developer.android.com/studio/run/emulator-acceleration).

## Repository structure

```text
apps/
  userscript/                 # Tampermonkey entry, GM networking/storage, page bridges
  tauri/                      # Desktop / mobile app, IPC and Rust native adapters
packages/
  music-workbench/            # Shared workbench, playback, library and downloads
  ui/                         # Controlled Vue components, panels and styles
  core/                       # Music models, business rules and platform ports
  audio-composition/          # Recipes, timelines, prefetch and optional browser codecs
  account-pool/               # Account selection and leases
  network-routing/            # Request competition, cancellation and proxy health
  plugin-source-*/            # Bilibili / Douyin / NetEase protocols, pagination and media resolution
  plugin-tag-management/      # Built-in tagging
  plugin-music-creation/      # Built-in materials and composition
  plugin-center/              # Plugin identity, lifecycle and contributions
  plugin-ui-vue/              # Plugin UI rendering and trusted theme assembly
  plugin-sdk/                 # Public DTOs, protocol and Schema
  plugin-vm/                  # Fixed QuickJS execution kernel
  plugin-sandbox-browser/     # Worker resources and restricted execution sessions
  plugin-cli/                 # Plugin builds, packaging, signing and DEV tools
  plugin-testkit/             # Same-VM plugin testing
crates/                       # Rust plugin protocol, policy, authority, network and packages
scripts/                      # Build, boundary checks and verification tools
docs/                         # Chinese/English design, development and acceptance records
```

Applications inject networking, storage, login, media and saving capabilities; shared packages never depend on applications. Userscript source requests use `GM_xmlhttpRequest`, while desktop invokes Rust native capabilities through IPC. See [Project Architecture](docs/en/cross-platform/architecture/project-architecture.md) and [Reusable Package Boundaries](docs/en/cross-platform/architecture/reusable-package-boundaries.md) for dependency rules.

## Plugin development

Built-in source, tag and creation plugins ship with the application. External `.amplugin` packages require native verification, explicit consent and target admission before installation or execution in supported desktop environments.

- [CLI](packages/plugin-cli/README.md): templates, checks, fixed builds, packaging, signing and isolated DEV sessions.
- [SDK](packages/plugin-sdk/README.md): plugin declarations, versioned protocols and controlled capability interfaces.
- [testkit](packages/plugin-testkit/README.md): plugin tests using the same VM as the product.

SDK / CLI / testkit are currently **0.1.0**, locally packable and not registry-published. Existing templates cover metadata catalogs, tag suggestions and text exports; **external catalogs do not yet support media resolution, playback or downloads**. Userscript and mobile external-plugin policies are both `none`. A marketplace, automatic updates and broader platform support are outside current delivery. See [implementation progress](docs/en/cross-platform/architecture/plugin-system-refactoring-steps.md).

## Checks and contributions

Before committing, run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Root tests and type checks include Rust checks, and repository-wide builds include Tauri, so the native toolchain is required. For a scoped change, start with `pnpm --filter <package-name> test` and the corresponding type check.

Native implementation changes additionally require:

```bash
rustup toolchain install 1.90.0 --profile minimal
cargo install cargo-deny --locked
pnpm check:native
pnpm check:rust:msrv
pnpm check:rust:deny
```

The first two commands prepare a new environment for full native checks: MSRV checks need a separate Rust 1.90.0 toolchain, and dependency checks need `cargo-deny`. Android changes also require `pnpm check:mobile:boundaries`, `pnpm check:mobile:android` and the corresponding target build.

See [AGENTS.md](AGENTS.md) and [Development Workflow](docs/en/cross-platform/architecture/development-workflow.md) for contribution conventions. Automated checks, website observations, actual GM requests, Rust requests and device acceptance are recorded separately and do not substitute for one another.

## Documentation

| Topic                    | Entry points                                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All documentation        | [English index](docs/en/README.md) · [中文索引](docs/zh-cn/文档索引.md)                                                                                                                                              |
| Runtime development      | [Userscript](docs/en/userscript/development.md) · [Desktop](docs/en/desktop/development.md)                                                                                                                          |
| Architecture and modules | [Project Architecture](docs/en/cross-platform/architecture/project-architecture.md) · [Reusable Package Boundaries](docs/en/cross-platform/architecture/reusable-package-boundaries.md)                              |
| Product and interaction  | [Library and Custom Tracks](docs/en/cross-platform/features/local-library-and-custom-plugins.md) · [Cross-Platform UI](docs/en/cross-platform/features/cross-platform-ui-and-interaction.md)                         |
| Source protocols         | [Music Source Plugin Architecture](docs/en/cross-platform/architecture/music-source-plugin-architecture.md)                                                                                                          |
| Current delivery scope   | [Desktop Plugin Matrix](docs/en/cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md) · [Mobile Engineering Record](docs/en/cross-platform/architecture/plugin-system-s16-mobile-delivery.md) |
