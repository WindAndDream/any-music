---
documentType: development-guide
runtimeScope: tauri
---

# Android build and validation procedures

[中文](../../zh-cn/开发指南/Android验证.md)

Runtime support is listed in [mobile capabilities](../modules/tauri/mobile.md). Track release and audio status in [acceptance](../changes/acceptance/README.md).

## Repeatable Android release and emulator checks

Use these commands from the root; build commands do not authorize live inspection:

```sh
pnpm build:mobile:android aarch64 --release
pnpm build:mobile:android aarch64 --release --signed
pnpm check:mobile:release aarch64
pnpm build:mobile:android x86_64
pnpm accept:mobile:android --serial emulator-5580
pnpm accept:mobile:android:device --serial DEVICE_SERIAL
```

Signing requires all four environment variables: `AM_ANDROID_KEYSTORE` (absolute path), `AM_ANDROID_STORE_PASSWORD`, `AM_ANDROID_KEY_ALIAS`, and `AM_ANDROID_KEY_PASSWORD`. Passwords are never CLI arguments or generated tracked Gradle files. Incomplete inputs fail before building. There is no debug-signing fallback. Unsigned mode remains explicit even if signing credentials are present. Preserve the chosen private key for updates; local validation keys do not establish a production publisher or Play identity.

Signed builds automatically run the release verifier. It checks APK signature and a single non-debug signer, matching cryptographically verified signatures for every AAB payload, actual manifest package/minimum/target SDK, non-debuggable/non-test/no-backup/no-cleartext settings, absence of the test provider, APK ZIP 16 KiB alignment and every bundled ELF's ABI/LOAD alignment. It reads archives without extraction and writes public hashes/certificate metadata to `release-verification.json` beside the APK. Build alignment does not prove execution on a 16 KiB device.

The live harness requires an explicitly selected, already running x86_64 emulator and an existing debug build. It refuses physical/default devices and an already installed test package, rebuilds the matched app/instrumentation APKs, installs without removing the product, requires successful JUnit completion, reports skipped cases, records device/WebView/page-size/artifact evidence and removes only its test APK/forwarding. It never wipes an AVD or seeds grants. Native-only tests cover adapters and the engine floor. External debug-WebView inspection covers real mount/capabilities, denied desktop/private-bridge IPC, private-target rejection, background/resume and force-stop/process-restart retention of all active core/host/namespaces/archives. It compares canonical business data, excluding mirror revisions and obsolete generations. Unsupported engines instead exercise the native update message and explicitly report `bootstrapOnly`, without claiming workbench checks. Reports remain under ignored `.codex-tmp/s16-accept/`.

The separate physical harness requires an explicit arm64 device, an already installed verified local release with exactly matching APK bytes. It uses the same native adapter sources in temporary `com.anymusic.adaptertest`/`.test` packages with an independent UID, no launcher/network/native JNI library, verifies their compiled identities before installing, initializes only its test-owned fixture provider, then removes only those packages. It does not replace or instrument the user's release, expose release debugging or weaken its R8 rules. Keystore metadata from this host measures device protection of the tested adapter, not the product's existing key. Its adapter-only manifest queries only the fixture provider, following [Android package visibility](https://developer.android.com/training/package-visibility/declaring). USB installation must be permitted by the device. After a prompt timeout, --prepared reuses the already built APKs while repeating identity/release checks; it does not skip instrumentation. Direct optimized-release instrumentation failed before tests on missing runner-only `androidx.tracing.Trace`; it is not recorded as passing release instrumentation.

Forcing repeated Activity destruction/recreation inside one instrumented process exposed a native `pthread_mutex_lock` on a destroyed mutex. That path remains unaccepted, independently of the passing normal background/process-restart checks. The harness drives the product from outside its process so instrumentation cleanup does not repeatedly tear down the Tauri event loop; this does not fix or claim acceptance of forced Activity recreation.

The API 35 software-rendered release emulator also exposed Wry 0.57.0 `main_pipe.rs:421` panicking on `GetUrl`'s canceled reply during its slow first cold startup. A subsequent process startup displayed the workbench; the physical phone's first Activity launch reported 503 ms and a subsequent screenshot confirmed the workbench. The failing cold-start environment remains unaccepted. Origin checks and release security settings are preserved; a successful warm launch does not close this failure.

## Repeating the focus probe

With explicit live-inspection authorization, build the separate probe using `AM_ANDROID_ADAPTER_TEST=1`, `AM_ANDROID_AUDIO_PROBE=1`, `AM_ANDROID_SIGNED_BUILD=0` and Gradle `:app:assembleArm64Debug -x :app:rustBuildArm64Debug`. It uses `com.anymusic.audioprobe`, no product JNI library or network permission, and never replaces or reads product data. Preserve any already installed test host instead of silently removing it. Only this probe targets API 34 so that its background receiver may request focus while the API-37-targeting product remains the top/resumed app; the ordinary adapter-test and production targets stay at 37.

The probe-only `AudioFocusProbeReceiver` accepts fixed `focus` values `transient`, `gain`, `duck` or `communication`, requests real OS focus and releases it after eight seconds. Trigger it with an explicit `am broadcast -n com.anymusic.audioprobe/com.anymusic.app.AudioFocusProbeReceiver --es focus transient`. It starts no Activity. The communication case uses silent native output and an owned `MODE_IN_COMMUNICATION` request, then removes both; it is a VoIP-mode simulation, not real telephony evidence. Capture native focus/output and product UI before, during and after it, and require started native product output before triggering each case. An accepted probe request alone does not prove audible ducking. Remove only this test-owned host afterward. The earlier Activity-based experiment mixed background cancellation with focus and is excluded from focus acceptance.

The production release verifier rejects probe components in the compiled manifest. Production source sets never include their implementation. Physical headphones and real calls cannot be replaced by this probe or synthetic noisy broadcasts.

Official references: [Android audio focus](https://developer.android.com/media/optimize/audio-focus), [audio output changes](https://developer.android.com/media/platform/output), and [Chromium's AudioFocusDelegate](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/AudioFocusDelegate.java). Source inspection explains ownership; exact provider/device acceptance remains separate.
