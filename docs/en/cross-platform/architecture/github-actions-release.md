---
documentType: development-guide
runtimeScope: repository
---

# GitHub Actions Builds and Releases

Chinese counterpart: [GitHub Actions 构建与发布](../../../zh-cn/跨平台/架构/GitHubActions构建与发布.md).

The repository has a Windows quality workflow and a release workflow for Userscript, Windows x64, macOS arm64/x64, Linux x64 and Android arm64/x64. Android publication requires release signing. A separate build check produces an iOS simulator app. The [desktop runtime guide](../../desktop/runtime-architecture.md) and [S16 matrix](plugin-system-s16-mobile-delivery.md) own runtime capabilities, plugin-execution admission and remaining acceptance.

## Workflows and artifacts

`.github/workflows/ci.yml` runs on PRs and pushes to `main`, `develop`, `release/**` and `hotfix/**`, and is reusable by the release workflow. PRs also run `Git Flow policy` for branch routes, titles and non-merge commit messages; feature/fix pushes are validated by their PR to avoid duplicate builds. Its Windows job runs the five root checks, native release checks, Rust MSRV and cargo-deny. Node is pinned by `.node-version`, pnpm by `packageManager`, and Rust by `rust-toolchain.toml`. Actions are pinned to reviewed commit SHAs.

`.github/dependabot.yml` gives pnpm and Cargo security update PRs Conventional Commit titles and disables scheduled version update PRs for those ecosystems. Enable **Dependabot security updates** under repository settings to let GitHub open security PRs. Review the lockfile for remaining affected versions before merging an update.

`.github/workflows/release.yml` resolves one commit, reuses CI, then builds every declared target independently. `scripts/native-targets.json` owns desktop runners/targets/bundles, Android toolchain versions and Android versionCode. Release builds preserve the locked dependency graph and explicit native features; diagnostic features never enter the release combination.

PRs targeting `main` automatically build the full unsigned candidate matrix against the PR merge commit. `Release candidate checks` succeeds only when all expected builds and artifact verification succeed; a failed or skipped dependency cannot make that gate pass. Ordinary feature/fix PRs targeting `develop` run CI without building every installer. Annotated `v*` tag pushes build signed Android artifacts and enter the protected publication job. Creating a GitHub Release manually does not trigger this workflow.

Android jobs set up pinned SDK command-line tools before installing the declared platform, build-tools and NDK. They also install API 36 for the locked Tauri Android libraries. The app platform uses Google's package version (`37.0` for API 37).

| Target            | Output                 | Signing                                               |
| ----------------- | ---------------------- | ----------------------------------------------------- |
| Userscript        | `any-music.user.js`    | Not applicable                                        |
| Windows x64       | NSIS `*-setup.exe`     | Unsigned                                              |
| macOS arm64/x64   | Separate `.dmg` files  | Ad-hoc; no Apple notarization                         |
| Linux x64         | `.AppImage`, `.deb`    | Unsigned                                              |
| Android arm64/x64 | Separate APK/AAB pairs | Candidates unsigned (`-unsigned`); publication signed |

Unsigned Android APKs need signing before installation. Signed APK/AAB builds run the existing signature, signer consistency, manifest, archive and alignment verification. Per-ABI AABs still need distribution-channel acceptance; signing does not establish a validated Play submission. Missing signing secrets fail publication without a debug-key or unsigned fallback. For a local signed arm64 build, use `pnpm build:mobile:android aarch64 --release --signed` with the signing environment configured.

## Configure GitHub before accepting contributions

Keep `main` as the default branch and create `develop`. Under **Settings → General → Pull Requests**, enable merge commits, disable squash/rebase merges and keep automatic branch deletion off. Under **Settings → Rules → Rulesets**, activate PR-only protection for `main`, `develop` and `release/*`, with independent approval, stale approval dismissal, last-push approval, resolved conversations, up-to-date branches, no force pushes/deletion and no administrator bypass. Require `Privacy and secrets`, `Git Flow policy` and `Repository checks (Windows x64)` everywhere; require `Release candidate checks` additionally on `main` only. The candidate workflow does not run on `develop` or `release/*` PRs. Run initial PRs so GitHub discovers check names before selecting them. Do not enable linear history. See [Git Flow](git-flow.md) for ownership and bootstrap constraints.

Create separate tag rulesets for `v*`: restrict creation to release maintainers, and independently prohibit updates/deletion without bypass. Under **Settings → Actions → General**, enable the referenced actions (`actions/*`, `pnpm/action-setup`, `Swatinem/rust-cache`, `android-actions/setup-android`), retain default read-only token permissions and external-contributor workflow approval. The final job explicitly requests its own write permission; no PAT or workflow-created PR permission is needed. Enable dependency graph, Dependabot alerts, secret scanning and push protection in repository security settings. These complement the pinned privacy gate.

Create these environments under **Settings → Environments** before publishing. For both, select **Selected branches and tags**, allow only **Tag** pattern `v*`, and configure no branch patterns. Configure `release-publish` with a required release reviewer, prevent self-review and disable administrator bypass of protection rules; approval happens after the complete signed distribution is available in Actions. A separate reviewer is necessary when self-review is disabled. `release-signing` can also require review if signing authority needs an independent approval.

| Environment       | Secrets / purpose                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `release-signing` | `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |
| `release-publish` | Final artifact approval; uses `GITHUB_TOKEN` and needs no signing secrets                        |

`ANDROID_KEYSTORE_BASE64` is the single-line Base64 encoding of the private JKS, not the keystore path. The two password secrets unlock the store and private key; the alias secret selects the release key. Keep these as environment secrets rather than repository-wide secrets. They are supplied only to the signed build step, after toolchain setup. The wrapper restores the key with private file permissions under `RUNNER_TEMP`, outside the checkout, removes the encoded value from the child environment and deletes the decoded file after success or failure. Keys and passwords never enter artifacts or generated tracked Gradle configuration.

For local Android key custody on Windows, use a private directory such as `%USERPROFILE%\.android\any-music\release`, restricted to the owning Windows account. Keep the encrypted JKS and its Base64 export outside Git and back them up securely; the Base64 export is also private key material. Preserve the same signing identity for application upgrades. Passwords, local absolute paths and private files never belong in this guide or Git history. Windows trusted code signing requires an appropriate issued certificate/service; macOS Developer ID signing/notarization requires Apple-issued credentials. Generating a local self-signed certificate does not provide those publisher trust chains.

## Try a build without publishing

After the workflow is on GitHub's default branch, open **Actions → Release → Run workflow**. Leave `publish` disabled. `ref` can be a branch, commit or tag; an empty value uses the selected workflow ref. Every target and the aggregate `distribution-assets` artifact is retained for 14 days. A Git tag is unnecessary for this build-only path.

All jobs build the resolved commit. Build-only artifacts use that commit's product version for filenames and metadata, even when no matching tag exists. Publishing always requires the existing exact product tag and a clean source checkout. Local staging records `sourceDirty: true` when source changes are uncommitted; those artifacts cannot be published by this workflow.

### Build a single target locally

Run `pnpm release:build --list` from the repository root to list the targets and formats. Pass one target ID to stage the same assets as CI under `dist/release/<target>/`.

| Command                            | Build host or toolchain                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `pnpm release:build userscript`    | Any host with Node and pnpm                                   |
| `pnpm release:build windows-x64`   | Windows with the x64 MSVC Rust toolchain                      |
| `pnpm release:build macos-arm64`   | Apple Silicon Mac with Xcode and the arm64 Rust toolchain     |
| `pnpm release:build macos-x64`     | Intel Mac with Xcode and the x64 Rust toolchain               |
| `pnpm release:build linux-x64`     | Linux x64 with WebKitGTK 4.1 and Tauri packaging dependencies |
| `pnpm release:build android-arm64` | Android SDK/NDK and the `aarch64-linux-android` Rust target   |
| `pnpm release:build android-x64`   | Android SDK/NDK and the `x86_64-linux-android` Rust target    |

On Linux, CI builds on Ubuntu 22.04. Install the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/#linux), `patchelf` for AppImage packaging, and `libkeyutils-dev` and `libdbus-1-dev` for the native keyring. Set `APPIMAGE_EXTRACT_AND_RUN=1` when building in a container without FUSE access. The [Android setup guide](../../../../README.en.md#android-development) lists the SDK packages and local signing commands.

### Build for iOS on macOS

Run **Actions → iOS build check → Run workflow** to build an unsigned arm64 simulator `.app` from the selected ref. Its ZIP is a separate Actions artifact. On an Apple Silicon Mac with Xcode and the iOS simulator runtime installed, these commands generate the Xcode project and build the app without starting a simulator.

```sh
pnpm --filter @any-music/tauri tauri ios init
pnpm --filter @any-music/tauri tauri ios build --target aarch64-sim --no-sign -- --locked --no-default-features
```

For a device build, use Xcode and an iOS SDK that meet [Apple's submission requirements](https://developer.apple.com/news/upcoming-requirements/). Configure an Apple Developer team, distribution certificate and provisioning profile for `com.anymusic.app`, then run `pnpm build:mobile:ios` from the repository root. This invokes the App Store Connect export for arm64 and places the IPA under `apps/tauri/src-tauri/gen/apple/build/arm64/`. iOS has no maintained Xcode project, signed build evidence or channel acceptance yet and remains outside the GitHub Release matrix. See [Tauri iOS code signing](https://v2.tauri.app/distribute/sign/ios/).

## Prepare and publish a version

The root `package.json` owns the product version. The release preparation command synchronizes both application package manifests, `tauri.conf.json`, the application Cargo version and its root lockfile entry. SDK, protocol and independent package versions are managed separately.

```sh
pnpm release:prepare 0.1.1 2
pnpm check:release
```

The second argument is a positive Android versionCode, at most 2100000000. A changed product version requires a larger code; rebuilding the same version can keep its code. Prepare on `release/*` or `hotfix/*` and complete the [Git Flow approval and acceptance](git-flow.md) before merging to `main`. Fetch the accepted release merge commit, then create and push its matching annotated tag:

```sh
git fetch origin --tags
git tag -a v0.1.1 origin/main -m "Release 0.1.1"
git push origin v0.1.1
```

The initial application version is already synchronized to `0.1.0` with versionCode `1`. Use `0.1.1-beta.1`/`v0.1.1-beta.1` for a prerelease. Build metadata (`+suffix`), leading-zero numeric identifiers and installer components above 65535 are rejected. Normal tags publish stable releases; prereleases never replace GitHub's latest stable release.

The maintained Android Gradle project reads generated `app/tauri.properties`. `build:mobile:android` recreates it from the same product version, versionCode, NDK and build-tools versions on every build; it is ignored by Git. No machine-local version file is needed in a clean checkout, and Gradle uses the declared SDK toolchain.

Manual publishing requires `publish: true`, the existing annotated `vVERSION` tag in `ref`, and the same tag selected under **Use workflow from**. Tag validation rejects lightweight tags and requires the commit to belong to fetched `origin/main` history; publishing rechecks remote main ancestry before creating a draft and before exposing it. Branches and arbitrary commits can only use build-only mode. Complete the `release-publish` environment review after checking the signed artifacts.

## Completeness and retry

Each build stages only its expected formats and records target, signing mode, product version, peeled commit, size and SHA-256 in `artifact.json`. Collection rejects missing/extra targets, signing-mode mismatches, stale versions, different commits, unexpected files and modified bytes. It produces `release-manifest.json`, `release-notes.md` and `SHA256SUMS`, with toolchain metadata and all expected assets. The read-only assembly job uploads `distribution-assets`; the separately protected publication job downloads and verifies those exact bytes. Unsigned candidate distributions cannot be published.

Only the final job has `contents: write`, using the ordinary `GITHUB_TOKEN`; no personal access token is required. It rechecks the remote tag, creates a draft, uploads assets and checks their names and sizes, then rechecks the tag before publishing. Failed collection never creates a release; failed uploads retain a draft. For transient failures, retry failed jobs of the same run. A workflow or source fix needs a new run that selects the corrected workflow and source. Build artifacts are replaced within a rerun, and only a draft for the exact commit may be resumed. Already published releases are never overwritten by these scripts; publish a new version instead.

Same-ref releases are serialized. Successful target jobs upload their own artifacts; the combined artifact and publishing require every target to succeed. CI does not launch the product, browsers or emulators. Build success does not change external-plugin target admission, enable mobile execution, prove installer associations or replace live account/playback/device checks.

Official references: [GitHub runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [Tauri distribution](https://v2.tauri.app/distribute/), [Android signing](https://v2.tauri.app/distribute/sign/android/), [Windows signing](https://v2.tauri.app/distribute/sign/windows/), [macOS signing](https://v2.tauri.app/distribute/sign/macos/), [GitHub CLI releases](https://cli.github.com/manual/gh_release).
