---
documentType: change-acceptance
runtimeScope: tauri
status: awaiting-acceptance
---

# Android audio and playback acceptance

[中文](../../../zh-cn/变更/验收/Android音频中断与播放.md)

**Awaiting acceptance.** The [playback contract](../../modules/tauri/android-playback.md) is implemented. Recheck unmeasured ducking, actual calls and physical routes next, when live device inspection is requested. Use the [validation guide](../../guides/android-validation.md#repeating-the-focus-probe).

## Device and scenario matrix

Record the exact signed APK hash, Android API, WebView provider/version, ABI, audio route, media/system volume and OEM audio settings with each run. The current batch is recorded separately from T13 in [2026-10-26 audio evidence](../../../baselines/android-audio/2026-10-26.json), including the preceding day's complete-playback baseline.

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
