---
documentType: change-acceptance
runtimeScope: shared
status: awaiting-acceptance
---

# Refine the song actions dialog

[中文](../../../zh-cn/变更/验收/歌曲操作弹窗.md)

Each name in the title area occupies one line and ends with an ellipsis when it overflows.

- [x] `pnpm --filter @any-music/theme-default test CatalogTrackActionsDialog DownloadTrackActionsDialog` passed 20 tests, including the full-name preview.
- [x] `pnpm --filter @any-music/theme-default typecheck` and `node scripts/check-package-boundaries.mjs` passed.
- [x] `pnpm build:userscript` and `pnpm --filter @any-music/tauri build:frontend` passed.
- [ ] In installed Userscript and Tauri builds, verify the two-row layout, name order, single-line ellipsis, icon hover and reduced motion, touch, keyboard dismissal and focus return in Discover and Downloads.

## Summary layout and verification

In Classic Discover and Downloads, put the song name above a row with artwork on the left and song information on the right. Show the custom name first when present, with the original directly beneath it. Hover animates only the eye icon.

- [x] `pnpm --filter @any-music/theme-default test` passed 578 tests, including original and custom names and the full-name preview.
- [x] `pnpm --filter @any-music/ui test` passed 1,106 tests. `pnpm --filter @any-music/theme-default --filter @any-music/ui typecheck` and `node scripts/check-package-boundaries.mjs` passed.
- [x] `pnpm build:userscript` and `pnpm --filter @any-music/tauri build:frontend` passed.
- [x] `pnpm lint`, the scoped `oxfmt --check` and `git diff --check` passed.

## Earlier verification

Classic Downloads removed the separate status section. Both dialogs offer a full-name preview with a bold heading and regular-weight song text.

- [x] `pnpm --filter @any-music/theme-default test` passed 578 tests after fixing the missing page-local entries. The 40 focused dialog tests passed again after the spacing and hover changes.
- [x] `pnpm --filter @any-music/theme-default typecheck` and `node scripts/check-package-boundaries.mjs` passed.
- [x] `pnpm build:userscript` and `pnpm --filter @any-music/tauri build:frontend` passed.
- [x] After the font-weight adjustment, both frontend builds and all 20 focused preview and download dialog tests passed.
