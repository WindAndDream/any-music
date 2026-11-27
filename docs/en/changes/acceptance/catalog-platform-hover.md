---
documentType: change-acceptance
runtimeScope: shared
status: awaiting-acceptance
---

# Align the mobile catalog platform highlight

[中文](../../../zh-cn/变更/验收/移动端目录平台悬停.md)

The Classic Discover track-page highlight follows the visible platform label. Screenshot feedback led to 4px of padding above and below the text and 8px on each side. The platform text keeps its alignment and the details button retains its 44px minimum height.

- [x] `pnpm --filter @any-music/theme-default test` passed all 573 tests, including the padded hover style regression.
- [x] `pnpm --filter @any-music/theme-default typecheck` and `node scripts/check-package-boundaries.mjs` passed.
- [x] `pnpm build:userscript` and `pnpm --filter @any-music/tauri build:frontend` passed.
- [ ] Check the updated highlight for `抖音` and a longer platform name in the mobile layout, then open the list details.
