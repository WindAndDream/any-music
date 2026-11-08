---
documentType: development-guide
runtimeScope: shared
---

# Independent Theme Development

Chinese counterpart: [独立主题开发指南](../../../zh-cn/跨平台/架构/独立主题开发指南.md). The production contract is `@any-music/ui/theme`; [theme acceptance](independent-theme-ui-migration-plan.md) tracks remaining T13 live cases.

## Add a third build-owned theme

1. Create `packages/theme-paper` with an English `AGENTS.md`, package-local `test/`, Vue typecheck and Vitest scripts. Use `@any-music/theme-paper` and `workspace:*` for UI/core dependencies. Its only package entry paths are `.` → `./src/index.ts`, `/vue` → `./src/vue.ts`, and `/styles` → `./src/styles/index.scss`. Depend on public UI contracts/primitives and core types only.
2. Export a lightweight `descriptor` from `src/index.ts`. Use stable ID `paper`, a title, `contractVersion: 1`, `settingsSchemaVersion: 1`, and supported `desktop`/`mobile` forms. IDs use lowercase letters/digits separated by single hyphens, begin with a letter and have at most 64 characters. `host` is reserved for protected build resources. Metadata must not execute Vue, styles, business factories or plugin implementations.
3. Implement a Composition API root and export `definition satisfies UiThemeDefinition` from `/vue`. Supply all 13 `UI_THEME_REQUIRED_VIEWS`; supply `tags`/`composer` when enabled host capabilities require them. Each view consumes readonly feature state, status/availability and named actions. Keep root components focused on composition. Build an independent page structure; do not import another theme or depend on its classes. Do not introduce per-theme business branches.
4. Scope the stylesheet to `:where(.am-theme-paper)` and use shared `--am-*` tokens. Reuse neutral primitives/headless editing from `ui`, `ui/catalog` and `ui/library`, and reusable item renderers from `card-styles/vue`. Card renderers emit intents; dialogs and business operations remain separate. Specialist editors expose host-bound neutral controls; their plugins retain drafts, recipes and namespaces. Account identity/login, native installation/consent, storage recovery and media stay in host slots/siblings.
5. In each participating application's `features/plugins/built-in-theme-directory.ts`, import the new metadata. Add an explicit lazy registration in `built-in-themes.ts` that imports `/vue`, `/styles?inline` and `virtual:any-music-theme-styles/paper`, then combines those CSS values with `protectedStyles`. Preserve the explicit classic fallback. Pass the same metadata directory as the third argument of `createWorkbenchModuleDirectory`; runtime `uiThemes` and `themes` must describe the same build registrations. Never read loaders from stored data.
6. The shared style collector and package/plugin/mobile checks automatically discover `theme-*` packages. The module adapter registers one `theme.paper/root` contribution at `theme.root`; it has no row/list/navigation substitutions. Add package behavior/coverage/style tests, application loader tests and cross-theme workbench fixtures using test-only theme dependencies. Check third-theme loading, failure/retry, disabled modules and protected host continuity.
7. Run target tests/typechecks, boundary fixtures and all five root gates: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`. Inspect both actual build audits and byte sizes. Optional theme code must remain outside the startup execution graph; Userscript may still physically contain it in its single file. Browser/application/emulator checks require an explicit request in the current task.

## Ownership and switching

Build-owned descriptors may set `unavailableReason` to block startup and selection before module allocation or lazy loading. Studio currently uses this development gate: a saved Studio preference starts Classic instead, and selecting Studio shows its configured message through the shared top notice without changing the theme or saving that selection. The picker stays open. Remove the metadata gate only when the theme is ready; display labels alone never authorize startup.

`MusicSourceWorkbench` owns the sole business controller and audio node. `createWorkbenchThemeFeatures` projects it into the contract; `plugin-ui-vue/trusted` validates coverage, allocates one root, activates scoped resources and restores semantic focus/scroll. Theme replacement does not create repositories, sources, downloads, media or editor sessions. Stable host editing cells retain unfinished inputs; explicit operations own resets.

Use `data-am-scroll-key="workspace"` for the main content region across themes. If container queries move scrolling between nested elements, mark both with that same semantic key. The host captures their maximum offset on each axis and clamps restoration to each destination's scroll range, so a non-scrolling wrapper cannot hide the active container's position. Distinct independently scrolling regions use distinct keys.

The current implementation has no `UiPresentation`, per-row dispatcher, classic-wrapping Studio implementation, partial loader entry or extraction `chrome`/`catalog`/`library` maps. Legitimate semantic plugin contributions remain available: navigation, feature views, secondary track actions/details, batch actions and filters. They do not choose another theme's page or grant native authority.

Preferences continue to use the runtime-isolated `ui-theme:v1` business key, with selected UI theme independent of light/dark/system appearance. Only a successful current render selection persists. Fallback/recovery, failed imports and storage failures use the existing transaction; no data conversion or compatibility reader is needed.

The settings projection carries `themeError` from that same host session. Both theme settings must display it, including a successful fallback after a failed selection and preference read/write failures. The Tauri build gives only build-owned optional theme module entries retry URLs: successful imports retain one cached promise, while rejected imports release it and use a fresh URL on the next explicit attempt to avoid WebView's failed-module cache. The preloaded Classic root, source loaders and static startup graph remain outside this transform.

Nested dialogs must escape suspended/inert panel ancestors, not merely their scrolling content. Classic owns its modal, operator and toolbar targets in its root; page and ordinary settings overlays use those targets. Protected account dialogs receive an independent host Shadow overlay outside the replaceable theme, with host-only CSS and the same resolved appearance. Use data-am-theme on am-root for light/dark token selection.
