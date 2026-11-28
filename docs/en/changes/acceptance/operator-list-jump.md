---
documentType: change-steps
runtimeScope: shared
status: awaiting-acceptance
---

# Keep lists steady when toggling the operator

[中文](../../../zh-cn/变更/验收/操作器列表跳动.md)

Keep the Listen Later list still when its operator opens or closes, including repeated toggles. Check the other Classic collections that use the same operator in Userscript and Tauri.

- [x] Trace the shared footer sizing and operator consumers.
- [x] Reserve the operator's minimum space in the player area before opening. Keep the same content viewport height on every toggle.
- [x] Run the Classic layout regression and build both frontend consumers.
- [x] Reproduce the remaining jump in the Tauri development app after scrolling.
- [x] Keep virtual measurements across operator toggles, test affected consumers, and repeat the live interaction.

The Windows Tauri development app reproduced a 147 CSS px upward jump after scrolling, with a stable content viewport and footer. The selection-mode key invalidated measured heights across the virtual grid. Listen Later, Favorites, playlist details, platform overviews, Playback History, Downloads, and both Discover list levels now preserve their measurements during toggles.

Listen Later, Favorites, My Playlists overview and details, Playback History, Downloads, Discover lists and results, Tag Management, and Plugin Center all use this footer.

Windows Tauri development checks with a 174-song queue covered the top, middle and bottom at 1280 and 510 CSS px, including 12 rapid toggles after scrolling. Frame samples showed zero movement in the scroll offset and the sampled card during the toggles. Escape closed the operator and restored focus. Favorites, Playback History, Discover music lists, and Plugin Center passed toggles after scrolling. Downloads, My Playlists overview, and Tag Management passed basic toggles with the available data.

The new queue regression reproduced a 176 px scroll-offset change before the fix. After the fix, `pnpm --filter @any-music/theme-default test` passed all 576 tests and the package typecheck passed. `pnpm build:userscript:dev` and `pnpm build:userscript` passed.

`pnpm build:tauri` produced the Windows release executable. Twelve toggles in that executable at desktop and narrow widths kept the scroll offset and the sampled card position steady. The root lint and format checks passed.

Pending runtime checks cover installed Userscript, long download and playlist lists, and platform groups.
