---
documentType: change-acceptance
runtimeScope: shared
status: awaiting-acceptance
---

# Shorten the Discover favorite button label

[中文](../../../zh-cn/变更/验收/发现页喜欢按钮文案.md)

The Classic Discover track-page button shows `喜欢 N 首`. Its accessible name still identifies the loaded tracks.

- [x] `pnpm --filter @any-music/theme-default test test/components/music-sources/ClassicCatalog.test.ts` passed all 20 tests, including the batch favorite action.
- [x] The Classic typecheck, shared package boundary check, Userscript build and Tauri frontend build passed.
- [ ] Verify the label in the installed app.
