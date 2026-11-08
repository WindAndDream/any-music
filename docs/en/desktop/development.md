---
documentType: architecture
runtimeScope: tauri
---

# Desktop Development

Chinese counterpart: [桌面端开发规范](../../zh-cn/桌面端/开发规范.md). Applies to `apps/tauri`. Read the application guide, then `src-tauri/AGENTS.md` and [Backend Engineering](backend-engineering.md) for native changes. This page establishes runtime boundaries; the backend guide defines version, async, cache and quality conventions.

## Data access and call chain

`music-workbench / plugin-source-* → apps/tauri/src/platform/native-http.ts → invoke('http_request') → src-tauri/src/network/http.rs → Rust HTTP client`.

- The renderer maps ports, selects public account identities and composes business behavior. Rust owns actual requests, account CookieStores, proxies and credentials. Request IDs map cancellation to cancel_request; ignoring a frontend result alone must not leave native reads running.
- Ordinary `http_request` returns a raw IPC frame: a four-byte big-endian metadata length, at most 1 MiB of UTF-8 JSON metadata (`status`, `statusText`, `headers`, `responseType`), then the unchanged body. Byte responses use a renderer buffer view; text responses retain lossy UTF-8 decoding and a leading BOM. The existing body budget remains separate from metadata. Cancellation takes precedence over late native success or failure, and every settled request detaches its renderer subscription.
- Shared built-in sources use `credentials: 'include'`; Rust binds account credentials. Declarative sources use `omit` without injected account cookies. Do not substitute WebView fetch/cookies, GM shims or host-page authentication for business transport.
- Douyin login, session checks, search, watch history/personal likes/collected videos/collected mixes, mix works and work detail use native-owned account CDP sessions through `douyin-browser-catalog.ts -> douyin_catalog_request -> douyin_browser`, injected as a portable source port. Official pages generate requests/signatures. Rust checks origin/type/listing/keyword/cursor or work identity and preserves cancellation/size budgets. Import iterators lazily open their own targets and read only matching GET-query or POST-form cursors; stopping, failure and cancellation close those targets. Each detail read creates a fresh target and waits for the matching API before closing it. The page load event does not establish media-detail completion; React Flight documents are a fallback only when the read budget expires without an API response. Parsing remains portable. Authentication, verification and permission failures are not replayed through local signing. Other listing imports, collected-music detail and media bytes retain native HTTP; browser detail success does not establish media-stream acceptance.
- Production Douyin account browsing belongs to Rust accounts/login, browser/douyin_browser, browser/cdp and browser/process. Bilibili retains native authentication. Older douyin_login/douyin_passport modules under accounts retain protocol tests. Keep portable source protocols in plugin-source-* rather than duplicating DTOs, pagination or mappings to put everything in Rust.
- Keep commands, capabilities, account lifecycles and local media permissions in apps/tauri. Remote verification pages receive no application IPC permissions.

## Accounts, media and storage

S06 renderer `any-music:tauri:product:v2` and native v2 mirrors recover by committed generation and same-generation revision, awaiting agreement before mounting. Only current schema-2 mirrors are accepted. A synchronous renderer guard covers generation reads/commits, rejects reentry and compares the persisted mirror with the writer's expected value; startup rechecks it around native saves before publishing a local snapshot. Native saves serialize version/revision checks and atomic replacement and reject downgrade. Retained renderer snapshots support current-format recovery and are not portable exports. Unknown versions remain read-only; persistence failure stops subsequent saves. See the [data ownership](../cross-platform/architecture/plugin-data-ownership.md).

- Desktop composition owns accounts and separate proxies, using portable account-pool/network-routing algorithms. The renderer handles public identity/state without persisting cookies, CDP credentials or proxy secrets.
- Preserve account ownership across API calls, pages, playback and downloads. Register remote media as random in-memory Rust loopback grants; native playback, Range and complete reads use the same account environment. Cancellation, disablement and environment changes clean up old tasks/grants.
- Stable product data uses desktop snapshots and native product.json mirroring; credentials use dedicated encrypted native storage. Do not access `any-music:userscript:*` or persist cookies, ephemeral media URLs, bytes or final disk paths in product snapshots.
- Mount one embedded complete-theme workbench and retain native file-save commands. T11 activates shared/SFC/selected-theme CSS values in the stable internal theme Shadow surface; protected host slots use separate host-only resources. Native host CSS is imported normally. Outer host-page Shadow injection, floating launchers, @grant/@connect and GM proxy remain userscript rules.
- Product system-browser verification and dedicated test-browser capture are different flows. Preserve explicit enablement boundaries for existing login experiments and do not present experimental observations as production native acceptance. See [runtime architecture](runtime-architecture.md) for authentication/mobile limits.

## Native command permissions and executors

src/ipc.rs is the single registry; build.rs derives AppManifest from it. The registry includes native download admission and separate S03/S15 relays; tests check exact command and permission coverage. Product capability matches only the main WebView; each executor receives its own relay with native window/document/session/context/deadline/sequence binding. S03 prototype evidence does not replace S15 production-resource/target acceptance. Unknown targets stay closed; see the [S15 matrix](../cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md).

## Skills and verification

- Use `$any-music-tauri-runtime` for IPC, HTTP, accounts, media and native integration; add the shared source/UI skill where appropriate.
- Start with application test (frontend and Rust) and typecheck (Vue/TS, Rust formatting and zero-warning Clippy for all targets). Native changes also run check:native for all-target compilation. Use root `pnpm build:tauri` and complete root delivery checks.
- Launch the application/browser only after explicit runtime-inspection authorization. Distinguish website observations, Rust automated tests, actual native HTTP/account checks and desktop playback acceptance; report missing evidence for each layer.

S09: sources load through independent plugin-source-* /runtime entries. Operation and account leases can both cancel the same Rust HTTP request; CDP/account routing stay native. Built-in source adapters own account-bound media grants and idempotent release; host preparation accepts only their loopback URLs and rejects unbound URLs. IPC doubles do not establish live Rust networking or desktop playback acceptance.

## Native plugin contracts

Runtime composition follows [plugin policy](../cross-platform/architecture/plugin-runtime-policy.md). Use [native authority](../cross-platform/architecture/native-plugin-authority.md), [anonymous networking](../cross-platform/architecture/plugin-networking.md) and [package recovery](../cross-platform/architecture/plugin-packages.md) for concrete contracts. [Desktop delivery](../cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md) owns native consent, DEV and exact-target admission. Renderer projections/buttons create no grants, and native installation rejects unadmitted targets. Built-in account transport and source-owned [gateway authentication](source-authentication.md) remain separate from anonymous guest networking.

## S16 mobile engineering

Native runtime_capabilities selects mobile form and platform-specific ACLs. Android supplies bounded content-URI/package previews, controlled document saving and Keystore; its preview-only host port exposes no execution/DEV controls. Both mobile external policies remain none. Mobile excludes desktop executor/DEV resources and cancels transient native work on suspension. Android requires API 26 and product WebView 111+, with a native update message for obsolete engines. Use pnpm build:mobile:android aarch64 or x86_64 for debug APKs; --release adds APK/AAB and --signed requires explicit signing environment variables. Signed artifacts run check:mobile:release automatically. check:mobile:android is offline Clippy; accept:mobile:android --serial emulator-N is explicitly authorized live instrumentation on a dedicated running emulator. accept:mobile:android:device --serial DEVICE_SERIAL uses an independent temporary debug host/UID for the same native adapters while preserving an already installed verified release. A reference arm64 phone has release-launch evidence; minimum-device, plugin-execution and channel exits remain incomplete; iOS needs macOS/Xcode. See [S16 evidence and remaining exits](../cross-platform/architecture/plugin-system-s16-mobile-delivery.md).

### Windows Android toolchain and migration

For the executable setup, environment-variable, build and device-install sequence, follow [Android development in the README](../../../README.en.md#android-development).

Install a full JDK and Android SDK before building. The maintained project uses Gradle 9.6.1, Android Gradle Plugin 9.3.1, platform 37 and Build-Tools 36.0.0. Match the JDK 21 and NDK 30.0.16248370 versions in `scripts/native-targets.json`. The NDK supplies the API 26 cross-compilers. Install Rust's `aarch64-linux-android` target for phones and `x86_64-linux-android` for emulator builds under the pinned toolchain.

With current Android Command-line Tools, install SDK packages using `android sdk install platforms/android-37.0 platforms/android-36 build-tools/36.0.0 ndk/30.0.16248370 platform-tools`. Platform 36 is also used by the locked Tauri Android libraries; Gradle can install it automatically when the SDK licenses are accepted. The current Windows `sdkmanager.bat` delegates to Android CLI; use slash-separated package identifiers with this CLI. Older SDK Manager installations use semicolon-separated identifiers. Point the CLI at the intended SDK with `--sdk=PATH`.

Set user environment variables to the actual installation directories: `JAVA_HOME` is the JDK root, `ANDROID_HOME` is the SDK root, and `NDK_HOME` is its `ndk/30.0.16248370` directory. Add the JDK's `bin`, SDK's `platform-tools` and `cmdline-tools/latest/bin` directories to user `Path`, then reopen the terminal or IDE. These paths belong to the machine environment, not tracked project files. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#android).

After moving the checkout, run `pnpm install --frozen-lockfile` if dependency links still reference the old location. The Android build script supports pnpm's Node and standalone executable entries, recreates ignored Gradle paths from the locked Cargo graph, and generates the Tauri/Wry Kotlin bridges and Tauri ProGuard rules from the locked dependencies. Keep the maintained Android project instead of regenerating it with `tauri android init`. An obsolete ignored `local.properties` can still override the SDK location, so check its `sdk.dir` when Gradle reports an SDK path error. Android compilation uses the CPU and does not require configuration changes for an AMD/NVIDIA GPU swap. Emulator graphics and hardware acceleration require separate runtime inspection; producing an APK does not exercise them.
