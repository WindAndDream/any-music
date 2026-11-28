---
documentType: change-steps
runtimeScope: shared
status: awaiting-acceptance
---

# Discover grid focus in production

[中文](../../../zh-cn/变更/验收/发现页网格焦点.md)

Fix the freeze when opening Track Actions, the blank Discover directory on return, and the slow first entry into a Bilibili result list in Windows v0.2.0. Provide the local production build and launch commands.

- [x] Reproduce registration churn on a fresh row snapshot with a production-style Vue template ref.
- [x] Audit the other Classic sections and preserve grid cell and table row registrations until their inputs change.
- [x] Run shared UI and Classic tests and typechecks, then build both production artifacts.

The grid cell and table row group compare template ref values in their registration watches. The grid regression counted two interaction registrations before the fix and one after it. The table regression counted five removed listeners before the fix and zero after it. A new interaction generation still renews the registration.

Discover uses the shared grid in Windows and Userscript production, including the Windows Douyin result WebView. Listen Later, Favorites, Playlists, Downloads and Playback History use that grid through the development profile and render full lists in production. The shared table has no current product consumer. The source audit found no other instance of the same registration cycle in the Classic sections.

- `pnpm --filter @any-music/ui test --maxWorkers=2` passed 1106 tests. `pnpm --filter @any-music/theme-default test --maxWorkers=2` passed 576 tests.
- `pnpm --filter @any-music/ui --filter @any-music/theme-default typecheck`, `pnpm build:tauri` and `pnpm build:userscript` passed.
- Tauri catalog WebView and document mask tests passed 9 cases. Userscript bootstrap and built-in theme tests passed 7 cases. The emitted production grid contains the corrected watcher in the main Windows frontend, Windows child catalog script and Userscript.

Next: after the production build, run `pnpm start:tauri`. Search Bilibili, open the results, open and close Track Actions, and return to the Discover directory. Live checks on the rebuilt executable and installed Userscript remain open.
