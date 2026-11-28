---
documentType: change-acceptance
runtimeScope: shared
status: awaiting-acceptance
---

# Playback failure feedback and automatic skipping

[中文](../../../zh-cn/变更/验收/播放失败提示与自动跳过.md)

Classic routes terminal playback failures to the top notice. The inline player and minimal-card status rows and the AM-2002 message in the track actions dialog were removed. **无法播放时自动跳过** is on by default, and an explicit off choice is saved. With the setting on, a chain of failures attempts each candidate at most once.

- [x] Implement the shared queue behavior and Classic settings and feedback.
- [x] Before changing the default, pass the Userscript and Tauri production frontend builds, shared package Vitest suites and type checks, both application `test/platform` suites, and root lint.
- [x] After changing the default, pass the targeted music-workbench queue, controller and product storage Vitest suites (87 tests) and `pnpm --filter @any-music/music-workbench typecheck`. The cases cover the default-on setting, restoring an explicit off choice and stopping an all-failed queue.
- [ ] Check an unplayable song and an all-failed queue with the setting off and on in installed Userscript and Tauri builds. Reopen each app to confirm the saved value.

Next action is installed-app acceptance when live inspection is requested.
