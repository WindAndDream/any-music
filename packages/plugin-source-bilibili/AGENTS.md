# Built-in Bilibili source

- Shared source plugin owning metadata, URL preflight, protocols, signing, DTOs, mapping and lazy pagination. Tests mirror `src/` under `test/`.
- Root exports lightweight descriptors and music.sources contributions; implementation loads through `/runtime`. Preserve provider ID bilibili and stored track IDs; module ID is source.bilibili.
- Consume only public core/plugin-center contracts. No workbench/apps, Vue, GM, Tauri or host fetch. Inject HTTP, account, signing and page capabilities; trusted ports never enter the external SDK.
- Built-in HTTP explicitly includes credentials. Preserve per-page consumption, early close, cancellation, highest-quality defaults and idempotent release.
- Use `$music-source-adapter`. Browser/application inspection requires explicit user direction; never update captureDate without a live recapture.
