---
documentType: architecture
runtimeScope: shared
---

# Reusable Package Boundaries

`music-workbench` is shared production composition for the userscript and Tauri, depending on core/ui/audio-composition/plugin-center, with trusted adapters additionally consuming plugin-sdk, and injecting HTTP/storage/login/media/file-save ports. It imports no apps, GM, Node, Tauri or Electron; renderer media remains lazy. Account composition now belongs to `apps/tauri`; the userscript retains one host account/proxy. See [Tauri Runtime](../modules/tauri/runtime.md).

Chinese counterpart: [可复用包边界](../../zh-cn/系统架构/可复用包边界.md).

The project uses pnpm workspaces, catalogs and recursive scripts for audio, plugins, sources, account and routing packages. Business packages remain private TypeScript source consumed by application builds. SDK/CLI/testkit 0.1.0 are locally packable and passed standalone acceptance; registry publication has not occurred.

## Dynamic presentation boundary

Workbench additionally depends on `plugin-ui-vue`, which depends only on ui, plugin-sdk and Vue. Its root renders bounded DTOs; `/trusted` assembles build-owned themes and the view outlet; `/directory` stays free of Vue/styles. ui defines controlled presentation/contribution injection without importing SDK or the plugin framework. The registry still stores descriptors rather than components/business instances. Both apps inject the lightweight theme directory.

## Packages and entry points

`account-pool` owns public account identity/policies/leases; `network-routing` owns bounded request competition/passive proxy health. `account-pool -> network-routing`; the latter has no internal dependencies. Neither includes DOM, Node, GM, credentials or music models; runtimes inject clocks/transport. Tauri integrates persisted default accounts and isolated proxies; proxy groups remain unavailable. See [Desktop Accounts and Proxies](../modules/tauri/accounts.md#accounts-and-verification).

| Package / entry                                                                                   | Responsibility                                                                                          | Dependencies and runtime limits                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audio-composition`                                                                               | Recursive recipes, timeline lookup, bounded chunks, window selection and concurrent prefetch            | No internal packages, DOM, Vue or codecs in the root entry; integer milliseconds                                                                        |
| `audio-composition/browser`                                                                       | Decode, trim, normalize to 48 kHz stereo and encode sequential MP3/WAV output                           | Existing Mediabunny dependencies; injected `loadSource`; no network, library or filesystem access                                                       |
| `plugin-center`                                                                                   | Generic identity/built-in protection, lifecycle, static contributions, dependencies and pure allocation | Catalog still requires only `{ descriptor: { id, name } }`; separate internal module contracts; no music models, Vue, networking or storage in the root |
| `plugin-center/music-sources`                                                                     | Music-source state, availability checks, media routing and lazy loading                                 | Core contracts; injected custom plugin factory; subscription-based state updates                                                                        |
| `plugin-source-bilibili`, `plugin-source-douyin`, `plugin-source-netease`                         | Lightweight descriptors, URL preflight and music.sources metadata                                       | Public core/plugin-center contracts; no eager /runtime                                                                                                  |
| `plugin-source-bilibili/runtime`, `plugin-source-douyin/runtime`, `plugin-source-netease/runtime` | APIs, signatures, DTOs, mapping, pagination and media resolution                                        | Core contracts and injected HTTP; no GM or Tauri binding                                                                                                |
| `plugin-source-douyin/browser`                                                                    | Browser device-state provider                                                                           | Explicit optional browser entry; the protocol class does not automatically read the host page                                                           |
| `plugin-source-douyin/contracts`                                                                  | Page-signing, cookie-state and page-fallback contracts                                                  | Types only; each host implements its capabilities                                                                                                       |

`core -> audio-composition`; `ui -> core/audio-composition`; `plugin-source-* -> core/plugin-center`. The music adapter in `plugin-center` depends on `core`. Applications compose the packages. Shared packages never import applications. Small helpers remain with their owning modules until stable reuse justifies extraction.

## Reusing audio composition

```ts
import { compileSegmentRecipe } from '@any-music/audio-composition'

const segments = compileSegmentRecipe([{ sourceTrackId: 'voice', startMs: 0, endMs: 2000 }], {
  resolveTrack: () => ({ durationMs: 3000 }),
  resolveCustomTrack: () => undefined,
})

const { exportAudioSegments } = await import('@any-music/audio-composition/browser')
const file = await exportAudioSegments({
  title: 'Composition',
  format: 'wav',
  segments,
  loadSource: async (id, { signal }) => readApplicationAsset(id, signal),
})
```

The consumer implements `readApplicationAsset`, returning `{ bytes: Uint8Array }` and honoring cancellation. IDs may represent voice clips, effects or local assets. Encoding is for explicit export or the final playback compatibility fallback; complete output is retained in memory and is unsuitable for ordinary playback startup. Streaming playback continues using bounded timeline windows, concurrent prefetch and an application-owned audio clock. Shared media sessions and Range algorithms belong to music-workbench; runtimes inject actual GM reads or Rust media grants/cancellation.

Core owns the public music adapter `compileSegmentRecipe`: it requires ordinary leaf tracks and converts engine failures to `AppError`. The timeline algorithm has one owner in audio-composition. UI export-format types also originate from the pure audio entry.

## Reusing plugin management

`PluginCatalog` neither executes third-party code nor grants domains or reads storage. It can manage non-music plugins such as document exporters. The music adapter accepts `builtInPlugins` and native-verified runtime projections. The Vue composable only synchronizes snapshots and unsubscribes on scope disposal. Only the latest availability request may publish state, including across removal and reinstallation.

Current product snapshots contain host records and plugin namespaces. External `.amplugin` manifests and installation state belong to native package storage and are excluded from portable product data. Neither runtime assembles the old source JSON interpreter, installer or archive UI. Desktop external catalogs use native package transactions and named ports; Userscript remains built-in-only. See [data ownership](../modules/plugins/data-ownership.md) and [runtime policy](../modules/plugins/runtime-policy.md).

## SDK, execution and tooling boundaries

plugin-sdk root and /music have no framework/core/runtime dependency; /schema uses generated validators, /node is Node-only package validation, and /guest and /host adapt DTO continuations. Workbench plugin-adapters convert core/wire and connect S15 catalogs through named native ports without granting authority. See [S15](../modules/plugins/desktop-delivery.md) for versions and supported capabilities.

The table describes implemented packages. Package manifests and scripts/check-package-boundaries.mjs define the actual dependency allowlist. The [redesign plan](../modules/plugins/extensions.md) also includes unsupported capabilities; a package’s existence does not enable them.

| Module                 | Adopted responsibility and dependency limit                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| plugin-sdk             | Framework-free manifests, contributions, wire/executor ports; /music serializable DTOs; no core, Vue, or runtime dependency            |
| plugin-center          | Identity, lifecycle, contributions, grant-display cache; abstract ports only, no concrete Worker/WASM or authoritative Tauri grants    |
| plugin-vm              | SDK and fixed QuickJS; shared budgets, bridge and serialization; engine-free /profile and /control                                     |
| plugin-sandbox-browser | Trusted Worker adapter using SDK/VM; Tauri requires S15 exact target admission; excluded from Userscript                               |
| plugin-ui-vue          | Declarative rendering using SDK and public ui exports; no reverse ui dependency                                                        |
| Feature/source plugins | Lightweight root, own specialized rules/state/views, trusted /vue entry; externals receive public SDK only                             |
| am-plugin-protocol     | SDK Schema-generated native DTOs, versions and bounded validation; no transport or business authority                                  |
| am-plugin-policy       | IO-free subject/operation/scope/risk/budget decisions with injected trusted snapshots and time                                         |
| am-plugin-runtime      | Install/grant/context/provenance and commit/revoke ordering through Store/Clock/Ids/InstallFiles; no concrete IO                       |
| am-plugin-net          | Anonymous HTTP and public-target/bounded transport checks; native Gate supplies authority; no account credentials or proxies           |
| am-plugin-package      | Bounded package/resource verification, integrity and signatures; no install/grant authority, networking or execution                   |
| Tauri native adapters  | Concrete SQLite/filesystem/HTTP, account isolation, caller checks, consent and Gate composition through the public crate contracts     |
| plugin-testkit / CLI   | Testkit uses SDK/VM as a Node test host; production cannot depend on it. S15 accepts CLI/standalone artifacts; no registry publication |

Trusted adapters convert current core music models and SDK DTOs, avoiding SDK/core/plugin-center cycles. MusicSourcePlugin is the current host source contract; do not duplicate timelines, canonical errors, download scheduling or persistence, or add previous-architecture readers/forwarding packages. Applications separately inject trusted built-in account/page ports; shared contribution points do not expose them to externals.

Update boundary scripts, exports, lightweight tests, and both consumer builds in each migration batch. The concrete external-protocol requirement justifies the SDK; it does not justify re-extracting every core model, utility, or media implementation.

## Music sources and hosts

Hosts construct `new BilibiliApi(httpClient)` or `new DouyinApi(httpClient, getRequestState, getPageSignature?, getTargetCookieState?)`. A protected-page source can optionally be injected into `DouyinMusicSourcePlugin`. The userscript supplies GM HTTP, browser state, page signing and target cookies. Document-start bridges, GM permissions and persistence keys stay in the application.

Tauri injects account Rust HTTP, local signing and native CDP catalog ports into built-ins. Douyin session/search, supported personal lists and work details use account system-browser capture; media bytes retain Rust HTTP/grants. This desktop Douyin path does not reuse Userscript page bridges or establish mobile login support. External packages use anonymous native Gate transport only. Resolution and export propagate cancellation from the resolution stage.

## Further extraction criteria

- **Future users/Web/services:** local-user scope, binding verification and canonical write authority stay with the host; provider login, synchronization, sharing and reports belong to optional integrations/independent services. Extract Tauri-free host use cases/API adapters for Web, without making core or workbench depend on provider implementations. `account-pool` remains a source-account abstraction. No new package/capability is implied; see the [proposal](../plans/future/local-users.md).
- **Media runtime:** Userscript and Tauri renderers share music-workbench's Range, decoding and clock scheduling, with injected HTTP/cancellation/media grants. Extract a general media package only for a concrete non-music consumer.
- **Download scheduling:** concurrency, retry and cancellation already live in core. A forwarding-only package adds little without a non-music consumer.
- **Design system:** keep primitives and product panels in UI until separate distribution or real multi-product consumers justify a split. Use subpaths and lazy loading for bundle boundaries meanwhile.
- **Contracts:** the external wire protocol is owned by independent SDK DTOs and trusted adapters as described above. Any later extraction of Track, HTTP or errors must migrate consumers coherently without cycles and requires its own concrete reuse need.

## Validation and performance

`pnpm lint` checks dependency ownership and entry graphs before linting. Shared packages cannot import application aliases, escaping relative paths, undeclared internal dependencies or private exports. Pure audio, generic catalog and source metadata entry points must not eagerly load Vue, codecs or browser providers. Tests move with their implementations; host composition tests remain in the application.

Regression coverage includes independent assets, real PCM encoding, mixed sample rates, one read per reused asset, cancellation, encoder initialization retry, availability races and large nested recipes. Window selection no longer linearly rescans after binary search. Large recipe expansion avoids function argument limits. Failed prefetch workers stop claiming queued work. Invalid bounds and timeline overflow are rejected before encoding.

This page describes module contracts. Stage records distinguish automated and live acceptance. Documentation maintenance adds no live host/device evidence and does not update platform captureDate.

## Plugin data and native authority

Applications inject the tag/creation implementations and build-known theme loaders. Workbench consumes named ports, host records and projections; it never imports those plugin implementations. User associations/drafts remain in plugin namespaces, while published recipes stay host-owned. See [data ownership](../modules/plugins/data-ownership.md).

The source registry receives built-ins and native-verified catalog projections. Userscript fixes none; Tauri derives capabilities natively. `.amplugin` byte verification, install/consent, anonymous Gate, execution and revocation remain native-owned. No old source package or JSON interpreter is assembled. See [runtime policy](../modules/plugins/runtime-policy.md), [S15](../modules/plugins/desktop-delivery.md) and [S16](../modules/tauri/mobile.md).

New theme-* packages inherit dependency, metadata and style boundaries automatically. See [Independent Theme Development](../modules/ui/themes.md).
