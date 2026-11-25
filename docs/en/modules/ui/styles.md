---
documentType: module-contract
runtimeScope: shared
---

# UI styles and component boundaries

[中文](../../../zh-cn/板块/界面/视觉样式.md)

Classic, Studio and controlled UI share the token and component contracts below. `packages/card-styles` supplies reusable track/playlist skin metadata and controlled renderers. Action dialogs, playback, and writes stay with their feature owners.

## 2. Design Principles

- Put music and meaningful actions first. Use spacing, typography, surface color, and restrained shadow for hierarchy; do not add decoration without information or interaction value.
- Keep domain terms, navigation IDs, theme tokens, state semantics, and outcomes consistent across runtimes. Follow platform layout and input conventions instead of demanding pixel identity.
- Make loading, empty, unavailable, expired, validation, partial-success, and retry states understandable without relying on color alone.
- Use the controlled `AppIcon` catalog and accessible control names. Do not substitute Emoji, Unicode glyphs, or text characters for product icons.
- Render third-party artwork through the runtime's remote-image boundary with no Referer and a stable fallback.

## 3. Color and Tokens

Components consume `--am-*` semantic variables rather than copying hex values.

| Meaning                            | Light               | Dark                |
| ---------------------------------- | ------------------- | ------------------- |
| Page background                    | `#F7F6F2`           | `#121116`           |
| Cards, lists, navigation, overlays | `#FFFFFF`           | `#1E1C24`           |
| Primary text                       | `#1A1A1F`           | `#F3F0EA`           |
| Secondary text                     | primary text at 60% | primary text at 60% |
| Borders and dividers               | primary text at 12% | primary text at 12% |
| Primary interaction                | `#002FA7`           | `#6B93E8`           |
| Favorite/playback accent           | `#E8A33D`           | `#F0B15A`           |
| Large brand field                  | `#002FA7`           | `#002FA7`           |
| Artwork-stat caption background    | dark gray at 74%    | dark gray at 78%    |

| State       | Light foreground / container | Dark foreground / container |
| ----------- | ---------------------------- | --------------------------- |
| Success     | `#2F8F5B` / `#E4F5EA`        | `#6FCB98` / `#1B3226`       |
| Warning     | `#B54708` / `#FCEEE3`        | `#FDBA74` / `#3A2414`       |
| Danger      | `#C4302B` / `#FBE9E8`        | `#F2837D` / `#3A1917`       |
| Information | `#1D7A8C` / `#E4F3F5`        | `#6FD0E0` / `#172E32`       |

The shared style entry also owns typography, spacing, radii, shadows, control dimensions, layers, focus rings, and motion durations. Add a token only when it has product-level meaning or at least two real consumers. Modern functions such as `color-mix()` are welcome with a static or `@supports` fallback.

### 3.1 Corner Radii

The product shell, global settings, Music Lists, and search/track lists use restrained corners that remain softly rounded. Choose radii by purpose; wider cards and mobile layouts do not need larger corners. Spacing, surfaces, and borders provide the main hierarchy.

| Purpose                                                               | Token                 | Radius |
| --------------------------------------------------------------------- | --------------------- | ------ |
| Status labels, counts, artwork captions, and compact tags             | `--am-radius-detail`  | 4px    |
| Ordinary buttons, inputs, selects, and segmented buttons              | `--am-radius-control` | 6px    |
| Artwork, list rows, and option rows                                   | `--am-radius-sm`      | 8px    |
| Music-list/track cards, settings groups, and segmented-control frames | `--am-radius-card`    | 10px   |
| Embedded panels and empty states                                      | `--am-radius-panel`   | 12px   |
| Product shell, dialogs, and sheet frames                              | `--am-radius-overlay` | 14px   |

Nested elements use smaller corners than their frame; edge-aligned buttons follow the frame boundary. Ordinary text buttons and status labels avoid pill shapes. Switch tracks, sliders, circular playback buttons, drag handles, and small dots retain their functional circles or capsules. Full-screen surfaces, inner rows of continuous lists, and existing underlined inputs keep square corners. Radius changes never shrink hit targets or clip keyboard focus rings.

These roles cover the designed pages and shared shell/overlay infrastructure, including plugin-center cards, controls and badges. Favorites, playlists, the library, creation and downloads retain their existing size tokens until their own design pass. Shared track cards and artwork receive local list styles so other business pages are not restyled; later designs can adopt these roles where appropriate.

### 3.2 Scrollbars

All visible scrollbars inside `.am-root`, including new scroll regions, use the shared `@any-music/ui/styles` defaults. Chromium/WebKit uses a 6px rail with a rounded 4px visible thumb, transparent track, and no arrow buttons. The thumb uses primary text at 20% opacity and increases to 36% on hover or drag, following the light/dark theme through `--am-color-scrollbar-thumb` and `--am-color-scrollbar-thumb-hover`. `--am-size-scrollbar` owns the rail thickness.

Browsers without scrollbar pseudo-elements use standard thin scrollbars and increase thumb contrast when the scroll region is hovered. Keep these branches separate: standard non-auto scrollbar properties override Chromium pseudo-element styling. New components inherit the shared defaults without local scrollbar sizing or colors. Existing intentionally hidden rails retain their behavior; forced-color mode uses native scrollbars. Styles stay within the product root and never restyle a Userscript host page.

## 8. Component and Bundle Boundaries

Themes are independent complete-root packages selected at `theme.root`; partial row/list/navigation dispatch and cross-theme overrides have been removed. Classic rows/page skins stay in theme-default, Studio owns its own structure, and UI retains neutral summary/grid/media controls and fixed host forms. Creation owns neutral timeline styles. Add build-owned themes using [Independent Theme Development](themes.md); metadata, lazy style resources and module registration share the same directory.

- Classic product presentation is maintained in `packages/theme-default`; `packages/ui` maintains runtime-neutral icons, navigation/shell primitives, controlled contracts, headless interactions, remote-image policy, tokens and protected host panels, without GM, Tauri, or source-private state. After plugin extraction, generic components/host panels remain in ui while tag/creation specialist views already belong to their plugins. Runtimes consume one shared view contract instead of copying application templates; see section 10 for the target boundary.
- Each apps/* package maps its runtime controllers to shared props/emits. Shared business state, playback and cross-view async orchestration belong to music-workbench. Userscript GM/DOM/page bridges stay in application platform; Tauri IPC stays in platform and native HTTP/accounts/credentials in src-tauri.
- Runtime differences are explicit ports: a repository persists shell preferences, a controlled prop enables userscript hide/show, a named slot injects proxy settings, and the player slot binds the runtime media pipeline. Shared components never choose GM or Tauri behavior through environment detection.
- Shared components use named, tree-shakeable exports. Heavy editing, download, and plugin pages use retryable component-subpath imports, while media encoding and complete-media reads remain behind runtime-owned user-action boundaries.
- Responsive visibility and artifact inclusion are separate concerns. CSS controls layout; runtime entries, named exports, and dynamic imports control bundle contents. Verify a future mobile dependency graph and output sizes instead of inferring them from folders.
