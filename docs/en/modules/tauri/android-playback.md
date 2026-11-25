---
documentType: module-contract
runtimeScope: tauri
---

# Android playback and audio interruptions

[中文](../../../zh-cn/板块/桌面与移动端/Android播放.md)

The workbench owns playback and the native adapter reports Activity and audio route state. Device coverage is tracked in [Android audio acceptance](../../changes/acceptance/android-audio.md).

## Playback ownership

Android uses the stable workbench media element for ordinary tracks and compiled custom leaves. The runtime injects `playbackEnvironment.preferMediaElement`; it does not construct a second AudioManager focus owner beside WebView. Leaves still use the existing bounded descriptor window, native account-bound loopback/Range transport, cancellation and final complete-render fallback. This path does not claim gapless Web Audio scheduling.

The WebView provider handles focus loss/gain and ducking of that media element. A settled custom leaf's pause clears its play intent; an internal source replacement retains intent. A system resume of the same leaf updates the actual playing state. Permanent focus loss requires explicit playback again. Provider-specific behavior needs live evidence; a successful `play()` or a playing icon alone is insufficient.

The private Kotlin adapter observes `ACTION_AUDIO_BECOMING_NOISY`, Activity stop and non-normal AudioManager modes. API 31+ uses the mode listener; API 26–30 checks the mode every 500 ms only while resumed. A foreground heartbeat synchronizes new documents, emitting an event only when their state changes; the renderer blocks playback until the first native state arrives. Late plugin registration initializes from the Activity's actual lifecycle so cold startup does not require backgrounding once. These hints contain no device identity, phone number or credentials and grant no native authority. There are no phone/Bluetooth runtime permissions, private Chromium APIs or new renderer IPC commands.

Background, communication mode and output-disconnect interruptions cancel the playback generation, pending resolution/compatibility reads, custom prefetch and held media grants. The UI retains only the logical position and stable track/recipe. Late metadata, time, error and ended events cannot restart playback, replace its progress or advance the queue. Becoming foreground/available does not replay work; an explicit play resolves fresh media and resumes at that position. Selecting a track while blocked performs no media request. Downloads and task replay retain their separate suspension rules.

Natural completion clears ordinary play intent. An interrupted position at the end restarts from zero, and a completed segmented custom track reloads its first leaf on the first explicit play. This avoids immediately hitting the last leaf's end again. Regression tests cover cancellation, stale grants/events, blocked selection, native-leaf selection and each replay path.
