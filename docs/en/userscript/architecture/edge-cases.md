---
documentType: architecture
runtimeScope: userscript
---

# Any Music Userscript Edge Cases

Chinese counterpart: [Any Music Userscript 边界情况](../../../zh-cn/用户脚本/架构/边界情况.md).

Scope: Userscript host-page injection. Desktop embedded WebViews do not inherit GM permissions, Shadow Host guards or floating-mount rules. Shared components follow the [cross-runtime UI contract](../../cross-platform/features/cross-platform-ui-and-interaction.md).

## 1. Purpose

The Any Music userscript injects the same floating panel into different websites. The target site's DOM structure, styles, routing behavior, keyboard shortcuts, and security policies are outside our control, so Shadow DOM must not be treated as a complete isolation boundary.

This document records the compatibility boundaries that require ongoing attention during cross-site injection. It also defines the handling principles and code ownership for each category. The current focus includes:

- Host placement, duplicate injection, and unexpected removal.
- Inherited styles and custom-property pollution across the Shadow DOM boundary.
- Dimensions based on the target page's root element, including `rem`.
- Conflicts between pointer events, keyboard events, focus, and page shortcuts.
- Tampermonkey sandboxing, CSP, Trusted Types, and permission configuration.

## 2. Isolation Boundaries at a Glance

| Boundary          | Typical risks                                                                      | Handling principle                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| DOM               | The page rebuilds `body`, removes the host, or executes the script more than once  | Mount under `document.documentElement`, create idempotently, and monitor host liveness                          |
| CSS               | Inherited properties and CSS custom properties enter the Shadow Tree               | Establish an explicit style baseline at a controlled root and prefix variables with `--am-*`                    |
| Dimensions        | `rem` changes with the target page's root font size                                | Prefer `px` or controlled, local `em` units                                                                     |
| Events            | Composed events cross the Shadow boundary and shortcuts also trigger page behavior | Respond only while the panel is in an interaction context and suppress only relevant events                     |
| Security policies | Execution contexts, CSP, and Trusted Types vary by browser and configuration       | Minimize permissions and dynamic injection, test target browsers directly, and do not rely on implicit bypasses |

## 3. Host Element and Mount Lifecycle

### 3.1 Mount Under `document.documentElement`

The floating panel's host should be a direct child of `<html>`, alongside `<body>`, rather than a child of the target site's application container.

This reduces two risks:

- Ancestors on the target site may set properties such as `transform`, `filter`, `perspective`, or `contain`. These can change the containing block of descendant elements with `position: fixed`, preventing the panel from remaining reliably positioned relative to the viewport.
- Some SPAs replace or clear the entire `<body>` during navigation. A host outside `<body>` is not removed together with the site's application DOM.

This strategy only reduces the likelihood of interference from the target page's layout. The site can still modify `<html>` directly, manipulate `<any-music-root>`, or interfere with the host using aggressive global styles and scripts.

### 3.2 Use a Low-Collision Tag and Mount Idempotently

Use `<any-music-root>` as the host element so that generic queries or bulk operations targeting ordinary `<div>` elements are less likely to select it accidentally.

A low-collision tag does not provide deduplication by itself. Before mounting, the script must still query for an existing host. If one is found, stop mounting to prevent hot reloads, duplicate installations, or abnormal execution from creating multiple application instances.

Do not rely on repeated calls to `customElements.define()` throwing an error to determine whether the application is mounted. The custom-element registry and the application's actual page instance represent different kinds of state; explicitly querying for the host is more direct.

### 3.3 Restore a Removed Host

The target site may accidentally remove the host during a top-level DOM update. After mounting, use a `MutationObserver` to watch the direct children of `document.documentElement`. If the current host leaves the document, append the same node again:

```ts
const observer = new MutationObserver(() => {
  if (!document.documentElement.contains(host)) {
    document.documentElement.append(host)
  }
})

observer.observe(document.documentElement, { childList: true })
```

During unmounting, disconnect the observer before unmounting the Vue application and removing the host. Otherwise, intentional removal will trigger automatic restoration.

If a site repeatedly removes the host at high frequency, do not expand the observation scope indefinitely or fight the site's scripts in a continuous DOM loop. Record it as a platform compatibility issue and consider a site-specific fallback or disablement policy.

## 4. Shadow DOM Style Boundaries

### 4.1 What Shadow DOM Isolates

Shadow DOM prevents most ordinary selectors from the target site from directly matching nodes inside the panel. It also prevents component selectors from accidentally affecting page content. Shared UI styles must be injected into the Shadow Root; styles injected into the page's `<head>` cannot normally style components inside the Shadow Tree.

Shadow DOM does not isolate every style input. The following values still require explicit control:

- Inherited properties such as `color`, `font-family`, `font-size`, and `line-height`.
- CSS custom properties inherited from `<html>`, a page container, or the Shadow Host.
- The effect of `color-scheme` on native form controls and scrollbars.
- Units such as `rem` that remain relative to the outer document.

### 4.2 Establish an Explicit Host Baseline

`apps/userscript/src/styles/host.scss` owns platform styles at the isolation boundary. It should reset inherited values in `:host` and declare a deterministic display environment:

```scss
:host {
  all: initial;
  color-scheme: light;
  font-size: 16px;
  line-height: normal;
}
```

`all: initial` does not reset CSS custom properties, so this rule alone cannot prevent variable pollution.

Elements inside the Shadow Root should also consistently use `border-box` so that the target site's box-model conventions cannot affect component size calculations.

### 4.3 Declare Every Design Variable Explicitly

CSS custom properties can cross into the Shadow Tree through inheritance. A target site may declare generic variables such as `--primary-color` or `--spacing` on `:root` or another ancestor. If a component references the same variable without providing a local value, it will accidentally consume the page's design system.

Any Music follows these rules:

- Prefix custom properties with `--am-*`.
- Provide defaults for every shared design variable on `.am-root`.
- Components may read only variables that are part of the Any Music design system; they must not depend directly on variables from the target site.
- Implement theme switching by changing controlled variables on `.am-root`, not by modifying the target site's `:root`.

## 5. Dimensions, Positioning, and Stacking

### 5.1 Avoid `rem`

`rem` is always calculated relative to the outer document's `<html>` font size; Shadow DOM does not change that reference. Different sites may set their root font size to `10px`, `62.5%`, `16px`, or a responsive value, causing the same panel styles to scale unpredictably.

Shared components should follow these rules:

- Prefer `px` for fixed dimensions, corner radii, spacing, and borders.
- When a value should scale with component text, use `em` based on a controlled parent font size.
- Do not introduce styling solutions that generate large amounts of `rem` by default. When one is necessary, verify in the build output that its units have been converted or isolated.
- Do not correct panel dimensions by changing the page's `<html>` font size, because doing so would break the target site's layout.

### 5.2 Define Positioning and Stacking Contexts Explicitly

When the panel floats above the page, the userscript host styles own `position: fixed`, viewport offsets, and `z-index`. Shared UI components do not determine platform-specific positioning.

Use a project-wide constant for `z-index`, selecting a value high enough to cover common page overlays. Even a very high value cannot guarantee that the panel appears above browser-native UI, fullscreen elements, or `<dialog>` and `popover` elements in the Top Layer. Accept these platform limitations or design an explicit fallback.

## 6. Events, Shortcuts, and Focus

Some events with the `composed` characteristic can cross the Shadow Tree boundary and continue propagating through the page. Video and music sites also commonly register global shortcuts such as Space and the arrow keys on `document` or `window`, so handling click-through alone is insufficient.

Keyboard interactions should follow these rules:

- Respond to panel shortcuts only when focus is inside the panel or another explicitly defined activation condition is met.
- Call `preventDefault()` and `stopPropagation()` only for keys that the panel has consumed and that would conflict with page behavior.
- Preserve normal text input behavior in inputs, text areas, and editable elements.
- For keys such as `Escape` and `Tab`, account for closing overlays, focus trapping, and restoring focus.
- Do not unconditionally intercept all keyboard or pointer events on `window`, because doing so can break basic target-site interactions.

For dragging, resizing, and hover menus, also test cleanup when the pointer leaves the Shadow Host, the window loses focus, or the component unmounts. This prevents stale global listeners and incorrect drag state.

## 7. Tampermonkey Sandbox and Security Policies

### 7.1 Follow the Principle of Least Privilege

`@grant` declares the `GM_*` capabilities the script actually uses. `@grant none` disables the Tampermonkey sandbox. Specific grants make their corresponding APIs available, but a non-empty `@grant` must not be treated as a guarantee that CSP or Trusted Types will be bypassed automatically across every browser, Tampermonkey configuration, and execution context.

Permission configuration must meet these requirements:

- Keep `grant` synchronized with the APIs actually called under `apps/userscript/src/platform`.
- Remove permissions that are no longer used; do not request fake permissions merely to switch sandbox modes.
- `connect` may be broad during development, but narrow it to the actual music-service domains before release.
- Use `unsafeWindow` only when access to the page's JavaScript objects is genuinely required, and isolate the related adapter code.
- When the execution world must be controlled, evaluate the behavior of `@sandbox`, the target browser, and the Tampermonkey version separately.

### 7.2 Reduce CSP and Trusted Types Risk

Page security policies may restrict script execution, resource loading, dynamic HTML, or style injection. The exact behavior depends on the execution context. Prefer predictable DOM APIs:

- Use `textContent` to insert styles and plain text; do not assemble untrusted content with `innerHTML`.
- Do not create HTML directly from target-site strings. If rich text is required, define a separate sanitization strategy first.
- Evaluate page policies, cross-origin rules, and userscript permissions separately for external fonts, images, scripts, and music resources.
- Third-party `<img>` requests normally carry the current host page as the Referer. Render cross-source artwork with `referrerpolicy="no-referrer"` and verify each source CDN's hotlink behavior.
- Bundle userscript runtime dependencies by default so every page or SPA entry does not request a CDN. If `@require` is necessary, pin an exact version and verify offline, update, and cache semantics.
- Test strict-CSP pages in both Chromium and Firefox instead of extrapolating from a single test site.

## 8. Code Ownership

| Capability                                                              | Location                                    | Rationale                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Create the Shadow Root, guard the host, and perform complete unmounting | `apps/userscript/src/platform/dom`          | Specific to the page-injection environment                 |
| Reset the Shadow Host, fix its position, and define platform stacking   | `apps/userscript/src/styles/host.scss`      | Manages the boundary between the panel and the target page |
| Design variables and shared component styles                            | `packages/ui/src/styles` and component SFCs | Reusable by the userscript and a future Tauri application  |
| Focus and internal component interaction                                | `packages/ui`                               | Exposes application contracts through props and events     |
| Tampermonkey permissions and match patterns                             | `apps/userscript/vite.config.ts`            | Kept in sync with actual platform-adapter capabilities     |
| Music playback and shortcut semantics                                   | `packages/core`                             | Contains no DOM listeners or `GM_*` implementations        |

Do not make `packages/ui` manipulate the outer page DOM to solve cross-site compatibility issues, and do not make `packages/core` aware of Shadow DOM or Tampermonkey.

## 9. Compatibility Verification Checklist

Before release, verify at least these scenarios:

1. Running the script more than once results in exactly one `<any-music-root>` and one Vue application instance.
2. The panel remains present and interactive after `<body>` is cleared or replaced.
3. After the host is removed manually, the observer restores the same instance; after an intentional unmount, it does not restore it.
4. The panel remains visually stable when the page defines extreme root font sizes, fonts, line heights, and identically named CSS variables.
5. When the page enables a dark `color-scheme`, the panel's form controls and scrollbars still match its own theme.
6. The panel remains positioned relative to the viewport as expected when page ancestors use `transform`, `filter`, or `contain`.
7. Space, the arrow keys, `Escape`, and `Tab` behave correctly both inside and outside the panel.
8. Interrupted dragging, window blur, and component unmounting leave no global event listeners behind.
9. SPA navigation does not require duplicate initialization, and both page features and panel state remain functional.
10. Mounting, style injection, and required cross-origin requests work on strict-CSP pages in Chromium and Firefox.
11. Cross-source artwork loads on Bilibili, Douyin, and unrelated host pages without Referer-based 403 responses, with a stable placeholder on failure.

When adding a cross-site capability, first add its failure modes to this checklist, then decide whether the platform adapter, shared UI, or business layer should handle them.
