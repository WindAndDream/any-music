# Production Userscript

This package composes runtime capabilities. Shared panels belong to `packages/ui` and source protocols to `packages/plugin-source-*`. Read the root guide, then use the boundaries below.

This guide applies only to Tampermonkey. Read [Userscript Development](../../docs/en/userscript/development.md) and use `$any-music-userscript-runtime` for platform integration. GM, host-page and single-account rules do not apply to desktop Rust.

- `main.ts` retains only document-start bridges, keyboard boundaries and the framework-free launcher. Vue, Pinia, styles, storage and feature state load through `bootstrap-userscript-app.ts` on first expansion. Hiding preserves playback/downloads; actual disposal cleans up sessions.
- `App.vue` composes music-workbench's player/library/download/business state. `features/music-sources` creates runtime sources; `platform` binds GM HTTP, stable storage, cookies and page bridges. Source DTOs/signatures must not move back here.
- `GM_*` appears only in `src/platform`. Preserve `*://*/*` and `@noframes` metadata; separate background signing/capture from visible-launcher eligibility. Keep exact `@connect` domains in sync with built-in APIs/media.
- Requests go through `platform/http`. Convert proxy configuration only there; passwords stay in this script's GM storage, outside logs, error snapshots and domain models.
- Use `GM_xmlhttpRequest`; its fetch option remains manager transport. Built-ins include credentials; the runtime constructs only build-known sources. Matching the host domain does not authorize page fetch. Do not add desktop CookieStore, IPC or media grants.
- Production storage uses `any-music:userscript:*`. Inject inline shared styles into Shadow Root without polluting the host.
- Only development `index.html` loads `platform/dev` GM doubles; production must not import them. Browser inspection follows the root explicit-request rule.
- For explicitly requested real-GM iteration, run `pnpm setup:userscript` from the repository root. Reuse its persistent browser profile and debugging endpoint instead of launching a temporary extension-disabled browser. The command checks live Tampermonkey enablement, user-script permission and the development connection; first-time store/script installation requires browser confirmation. Follow [the local-server workflow](../../docs/en/userscript/development.md#iterate-in-tampermonkey-with-the-local-server) on `gm-dev.html` or an actual source host. Keep development/production evidence separate; do not rebuild and paste a production bundle after each edit. Ordinary automated tests must not launch this environment.

Start with `pnpm --filter @any-music/userscript test` and `pnpm --filter @any-music/userscript typecheck`. Build consumers after public style/export changes; complete root checks before committing.

- tag/creation metadata and separate `/vue` loaders come from the features/plugins build directory. Bind existing generation storage only; no GM/IPC, accounts or private repository access.
- built-ins use lightweight plugin-source-bilibili / plugin-source-douyin metadata and lazy /runtime assembly. Provider IDs stay stable and separate from music.sources module/contribution IDs. Disablement/invalidation cancels listings/resolution/media; restoration never replays old tasks. Zero usable sources must not block core views.

- The product is unreleased: implement the current architecture directly. Do not add compatibility packages, previous product-schema readers, source JSON importers, archive UI or duplicate IPC aliases. Current plugin upgrade/rollback and crash recovery remain supported.

- features/plugins/built-in-theme-directory owns metadata only; built-in-themes preloads the classic fallback and dynamically imports Studio Vue/styles. The sole MusicSourceWorkbench owns one controller/audio above the complete ThemeHost. Shared/SFC/theme CSS resources are activated transactionally inside its stable Shadow surface; protected slots receive host-only CSS. Build audits record actual static execution graphs.
