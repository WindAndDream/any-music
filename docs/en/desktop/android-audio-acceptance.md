---
documentType: runtime-acceptance
runtimeScope: tauri
---

# Android audio interruptions and playback acceptance

Chinese counterpart: [Android 音频中断与播放验收](../../zh-cn/桌面端/Android音频中断与播放验收.md).

## Playback ownership

Android uses the stable workbench media element for ordinary tracks and compiled custom leaves. The runtime injects `playbackEnvironment.preferMediaElement`; it does not construct a second AudioManager focus owner beside WebView. Leaves still use the existing bounded descriptor window, native account-bound loopback/Range transport, cancellation and final complete-render fallback. This path does not claim gapless Web Audio scheduling.

The WebView provider handles focus loss/gain and ducking of that media element. A settled custom leaf's pause clears its play intent; an internal source replacement retains intent. A system resume of the same leaf updates the actual playing state. Permanent focus loss requires explicit playback again. Provider-specific behavior needs live evidence; a successful `play()` or a playing icon alone is insufficient.

The private Kotlin adapter observes `ACTION_AUDIO_BECOMING_NOISY`, Activity stop and non-normal AudioManager modes. API 31+ uses the mode listener; API 26–30 checks the mode every 500 ms only while resumed. A foreground heartbeat synchronizes new documents, emitting an event only when their state changes; the renderer blocks playback until the first native state arrives. Late plugin registration initializes from the Activity's actual lifecycle so cold startup does not require backgrounding once. These hints contain no device identity, phone number or credentials and grant no native authority. There are no phone/Bluetooth runtime permissions, private Chromium APIs or new renderer IPC commands.

Background, communication mode and output-disconnect interruptions cancel the playback generation, pending resolution/compatibility reads, custom prefetch and held media grants. The UI retains only the logical position and stable track/recipe. Late metadata, time, error and ended events cannot restart playback, replace its progress or advance the queue. Becoming foreground/available does not replay work; an explicit play resolves fresh media and resumes at that position. Selecting a track while blocked performs no media request. Downloads and task replay retain their separate suspension rules.

Natural completion clears ordinary play intent. An interrupted position at the end restarts from zero, and a completed segmented custom track reloads its first leaf on the first explicit play. This avoids immediately hitting the last leaf's end again. Regression tests cover cancellation, stale grants/events, blocked selection, native-leaf selection and each replay path.

## Device and scenario matrix

Record the exact signed APK hash, Android API, WebView provider/version, ABI, audio route, media/system volume and OEM audio settings with each run. The current batch is recorded separately from T13 in [2026-10-26 audio evidence](../../baselines/android-audio/2026-10-26.json), including the preceding day's complete-playback baseline.

| Scenario                                     | Required evidence                                                                     | Current scope                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Ordinary source complete playback            | Descriptor/native bytes, progress from start to natural end, no AM-7001 at EOF        | Reference arm64 signed release; exact hashes in the record         |
| Custom leaves                                | Native media at both leaf boundaries, seek/pause, completion and cancellation         | Two 30-second leaves complete; final EOF replay fixed and checked  |
| Transient focus                              | Real competing UID granted focus; synchronized product pause and regain               | Passed on the final custom-media path with a separate native probe |
| Permanent focus                              | Product pauses and does not restart when the competitor releases focus                | Passed on ordinary media; no automatic replay                      |
| Ducking                                      | Actual focus stack, product output attenuation and restoration, unchanged user volume | Focus negotiation passed; attenuation amplitude remains unmeasured |
| Communication mode                           | Product stops, late work stays cancelled and availability requires explicit play      | Passed native mode probe; not a telephone call                     |
| Home/resume                                  | Output stops, position retained, no task replay and fresh play succeeds               | Passed reference arm64 release run                                 |
| Incoming/active telephone and VoIP calls     | Real ringing/answer/hang-up, refusal to resume into an active call, device routing    | Deferred: no second call device                                    |
| Bluetooth A2DP/SCO and wired/USB devices     | Connection, actual output route, unplug/disconnect, controls and call routing         | Deferred: no available headset                                     |
| Other sources, minimum devices and providers | Separate signed-release runs, transport and all preceding scenarios per combination   | Pending; no inheritance from this phone                            |

The Xiaomi reference phone initially has the system option `允许多声音同时发声` (allow simultaneous audio) enabled and reports `mIgnrMusicFocusReq=true`. This is an explicit OEM mixing policy. Standard focus checks temporarily disable it, verify the native flag becomes false and restore the original setting afterward. OEM-policy samples and standard-focus samples remain separate; the app does not override the user's setting.

## Repeating the focus probe

With explicit live-inspection authorization, build the separate probe using `AM_ANDROID_ADAPTER_TEST=1`, `AM_ANDROID_AUDIO_PROBE=1`, `AM_ANDROID_SIGNED_BUILD=0` and Gradle `:app:assembleArm64Debug -x :app:rustBuildArm64Debug`. It uses `com.anymusic.audioprobe`, no product JNI library or network permission, and never replaces or reads product data. Preserve any already installed test host instead of silently removing it. Only this probe targets API 34 so that its background receiver may request focus while the API-37-targeting product remains the top/resumed app; the ordinary adapter-test and production targets stay at 37.

The probe-only `AudioFocusProbeReceiver` accepts fixed `focus` values `transient`, `gain`, `duck` or `communication`, requests real OS focus and releases it after eight seconds. Trigger it with an explicit `am broadcast -n com.anymusic.audioprobe/com.anymusic.app.AudioFocusProbeReceiver --es focus transient`. It starts no Activity. The communication case uses silent native output and an owned `MODE_IN_COMMUNICATION` request, then removes both; it is a VoIP-mode simulation, not real telephony evidence. Capture native focus/output and product UI before, during and after it, and require started native product output before triggering each case. An accepted probe request alone does not prove audible ducking. Remove only this test-owned host afterward. The earlier Activity-based experiment mixed background cancellation with focus and is excluded from focus acceptance.

The production release verifier rejects probe components in the compiled manifest. Production source sets never include their implementation. Physical headphones and real calls cannot be replaced by this probe or synthetic noisy broadcasts.

Official references: [Android audio focus](https://developer.android.com/media/optimize/audio-focus), [audio output changes](https://developer.android.com/media/platform/output), and [Chromium's AudioFocusDelegate](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/AudioFocusDelegate.java). Source inspection explains ownership; exact provider/device acceptance remains separate.
