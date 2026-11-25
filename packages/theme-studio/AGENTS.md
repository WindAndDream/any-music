# Studio theme

- Shared renderer presentation only. Follow the [theme guide](../../docs/en/modules/ui/themes.md) and `any-music-ui-delivery`.
- Consume public UI contracts/primitives, core types and controlled card-styles renderers. Never import another theme, workbench, applications, plugin implementations, native APIs or repositories.
- Metadata `.` stays free of Vue/styles; `/vue` exports the controlled root and its views; `/styles` contains only `.am-theme-studio` rules. Do not depend on classic DOM/classes or DefaultTrackRow.
- Own independent horizontal navigation, request rail/results table and player console, plus all required and optional views: library, downloads, ordinary settings/dialogs and theme-owned tag/creation page layouts. Both forms pass complete-theme admission; application loaders now supply the complete root/styles on demand, with Classic as the explicit preloaded fallback.
- Specialist pages consume host-bound renderless editors and named neutral controls. The plugins retain rules, sessions, namespaces, pending input and recipes. Never embed a classic page or copy its business state.
- Settings reuse UI's headless editing cells/validation. Collection filters pass explicit feature-scoped editing owners to the neutral range editor. Keep async confirmation callbacks bound to their originating presentation, selection and request ID; replacement must not replay them.
- Host projections and named operations own search/import drafts, selection, pagination, media, persistence and disposal. Mounting or unmounting views must never submit, resolve, cancel or write them. Protected identity/settings/recovery/media remain host-owned.
- Tests mirror src in test/. Cross-theme action and real-controller tests belong to workbench with test-only dependencies. Node rendering does not establish real focus/layout or runtime acceptance. Follow the root no-launch and verification policy.
- The normal `dev` profile uses virtual rendering for Favorites. Staging and production use the full renderer pending runtime acceptance. Full and virtual surfaces share Studio row/card slots. Table/grid geometry and bounded interaction ports come from public UI primitives. Queue and playlist coverage follows the [virtual-list plan](../../docs/en/changes/in-progress/virtual-list-consumers.md).

See [Independent Theme Development](../../docs/en/modules/ui/themes.md) for new build-owned themes and current entry/style/allocation rules.
