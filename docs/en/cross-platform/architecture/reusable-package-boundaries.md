---
documentType: architecture
runtimeScope: shared
---

# Reusable Package Boundaries

`music-workbench` is shared production composition for the userscript and Tauri, depending on core/ui/audio-composition/plugin-center, with trusted adapters additionally consuming plugin-sdk, and injecting HTTP/storage/login/media/file-save ports. It imports no apps, GM, Node, Tauri or Electron; renderer media remains lazy. Account composition now belongs to `apps/tauri`; the userscript retains one host account/proxy. See [Tauri Runtime](../../desktop/runtime-architecture.md).

Chinese counterpart: [可复用包边界](../../../zh-cn/跨平台/架构/可复用包边界.md).

The project uses pnpm workspaces, catalogs and recursive scripts for audio, plugins, sources, account and routing packages. Business packages remain private TypeScript source consumed by application builds. SDK/CLI/testkit 0.1.0 are locally packable and passed standalone acceptance; registry publication has not occurred.

## Dynamic presentation boundary

Workbench additionally depends on `plugin-ui-vue`, which depends only on ui, plugin-sdk and Vue. Its root renders bounded DTOs; `/trusted` assembles build-owned themes and the view outlet; `/directory` stays free of Vue/styles. ui defines controlled presentation/contribution injection without importing SDK or the plugin framework. The registry still stores descriptors rather than components/business instances. Both apps inject the lightweight theme directory.

## Packages and entry points

`VirtualTrackCardGrid` can compose its own mounted-cell focus/composition retention with `interaction`, and stable-key compensation with `anchor` / `anchorResetKey`; both default off. It exposes the same retention/anchor ports for consumer reorder and deliberate navigation, merges retained indexes under the existing cap, and accepts `animate` to suspend keyed motion during handoff. Its optional collection layout preserves collection-card widths/gaps independently of track layout. `useQueueReorder` forwards optional virtual geometry, explicit viewport, retention and abortable focus ports while preserving its default DOM adapter. Live measured geometry refreshes same-identity row heights on spatial revisions and rebases pointer/release positions; incompatible layout/root/identity changes still cancel. The Classic Favorites candidate uses these ports behind a theme-private, default-closed gate for tracks and platform overview; production admission remains open.

The lightweight `ui/theme` continuity contract registers transient occurrence/offset/control adapters without importing Vue or a virtualizer. `ui/library` owns the renderer helper using injected full virtual geometry or native item boxes; themes supply their own stable occurrence/control mappings. The trusted presentation transaction in `plugin-ui-vue` cancels obsolete work and awaits restoration, including mounting retained offscreen targets before focus. Restoration temporarily leases exclusive scroll ownership by suspending ordinary anchoring, then releases it on completion/cancellation; measured alignment is bounded and fails explicitly if it cannot settle. Classic's synchronous bridge waits for its lazy candidate rather than assuming a render tick means loading completed. Overview return reuses the same transient semantic contract, with neutral return metadata retained by the existing editing-session owner across presentation replacement. No snapshots, measurement caches or restores enter product persistence or business commands. Automated C00 integration does not establish native focus/layout acceptance or admit other consumers.

`ui/virtual-scroll` owns renderer-only pooled scroll contexts, pure occurrence/logical-row geometry, fixed/measured lists, responsive measured grids, native table geometry, opt-in semantic anchoring and bounded interaction retention. Callers inject existing roots, lists and bounded preceding headers; no business/storage/runtime authority enters this entry. List/grid snapshots expose full count/extent and immutable keyed geometry, with no source reindexing during ordinary scroll. Natural border-box heights use a presentation-local cache (default 512), current width/layout/content generations; changed typed row membership invalidates only affected stretched-height entries; same-row permutations and unrelated measured rows retain their valid heights, preventing a transient extent collapse during reorder. `VirtualTrackCardGrid` is available through the public component subpath: CSS remains the density/mobile/column authority, cells keep a flat keyed parent, visible rows use natural auto tracks and missing intervals use compressed tracks. The controlled grid fixes implicit columns at `0px`; the CSS reader excludes trailing zero tracks only under that contract, so stale placements cannot keep an obsolete column count after shrinking. Only the measured virtual surface disables content-visibility placeholders. `useVirtualScrollAnchor` compensates by stable key/offset while input, native scroll, reset generations and replacement cancel stale work; native anchoring suppression is leased/restored. `useVirtualItemRetention` defaults to 8 distinct active occurrences, configurable up to 32; raw retained-index ports also cap at 32. Callers own editor/menu sessions and register only mounted targets; keyed focus validates actual current focus and disposes stale work. Root/readiness handoffs invalidate old registrations, and retained keyed grid cells re-register after that handoff. A retained grid occurrence retains its logical row. These APIs are opt-in, the pagination loader consumes full geometry without new measurements, and production adoption/native focus/layout parity remain in the [virtual-list plan](virtual-list-implementation-plan.md). The selected virtualizer belongs only to UI and stays out of metadata and `ui/theme`.

`useMeasuredVirtualTable` reuses the measured-list height authority and derives complete physical row positions, including caller-declared header/footer counts. `VirtualTable` renders legal native table sections with fixed column layout and zero spacing, a persistent origin below caption/headers, sparse spacer intervals and keyed natural `tbody` units containing main/detail rows. Ordinary theme cell rules cannot add padding/borders to structural spacers. Supply column widths through the columns slot, exact physical row counts, content revisions and raw-row ARIA indexes; the `rows` slot preserves existing `tr` components. Row spans stay inside one logical measurement unit. Row-count changes invalidate aggregate height automatically. Native column/sticky-header/accessibility-tree acceptance and consumer-specific semantic host restoration remain open.

`card-styles -> ui/core` owns reusable controlled music/playlist card presentation. Its root exports framework-free style metadata and pure progress normalization; `/vue` exports cards and readonly presentation injection. Themes consume it without importing one another. Cards emit intents and never own dialogs, playback, download state or persistence. UI owns the extensible display-category dialog, and workbench owns independently persisted board/style slots. The shared SFC resource collector includes these scoped styles for both production runtimes.

production composition uses public ui/theme readonly feature contracts and application-owned complete theme registrations. theme-default/theme-studio own independent roots/pages/styles; workbench imports neither in production. plugin-ui-vue/trusted owns the single generic transaction and isolated presentation/protected surfaces. Apps preload the classic fallback and dynamically load Studio; metadata roots remain free of Vue/styles. The build-owned SFC resource collector matches template scope IDs and supplies inert CSS values to those surfaces. UI and specialist plugins retain neutral controls/editing; host controllers retain business/media/download/storage authority. Only complete definitions at theme.root are supported; partial mappings/loaders/dispatch are unsupported. Classic page/row skins and creation timeline controls have their owning package styles; UI retains neutral controls and fixed host surfaces. T13 owns live acceptance. See the [theme development](independent-theme-development.md).

`account-pool` owns public account identity/policies/leases; `network-routing` owns bounded request competition/passive proxy health. `account-pool -> network-routing`; the latter has no internal dependencies. Neither includes DOM, Node, GM, credentials or music models; runtimes inject clocks/transport. Tauri now integrates account competition and isolated proxies; proxy groups remain unavailable and the old local account-service proposal is archived. See [Desktop Accounts and Proxies](../../desktop/runtime-architecture.md#accounts-and-verification).

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

Current product snapshots contain host records and plugin namespaces. External `.amplugin` manifests and installation state belong to native package storage and are excluded from portable product data. Neither runtime assembles the old source JSON interpreter, installer or archive UI. Desktop external catalogs use native package transactions and named ports; Userscript remains built-in-only. See [data ownership](plugin-data-ownership.md) and [runtime policy](plugin-runtime-policy.md).

## SDK, execution and tooling boundaries

plugin-sdk root and /music have no framework/core/runtime dependency; /schema uses generated validators, /node is Node-only package validation, and /guest and /host adapt DTO continuations. Workbench plugin-adapters convert core/wire and connect S15 catalogs through named native ports without granting authority. See [S15](plugin-system-s15-tools-and-desktop-delivery.md) for versions and supported capabilities.

The table describes implemented packages. Package manifests and scripts/check-package-boundaries.mjs define the actual dependency allowlist. The [redesign plan](plugin-extension-contracts.md) also includes unsupported capabilities; a package’s existence does not enable them.

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

- **Future users/Web/services:** local-user scope, binding verification and canonical write authority stay with the host; provider login, synchronization, sharing and reports belong to optional integrations/independent services. Extract Tauri-free host use cases/API adapters for Web, without making core or workbench depend on provider implementations. `account-pool` remains a source-account abstraction. No new package/capability is implied; see the [proposal](multi-user-local-cloud-plan.md).
- **Media runtime:** Userscript and Tauri renderers share music-workbench's Range, decoding and clock scheduling, with injected HTTP/cancellation/media grants. Extract a general media package only for a concrete non-music consumer.
- **Download scheduling:** concurrency, retry and cancellation already live in core. A forwarding-only package adds little without a non-music consumer.
- **Design system:** keep primitives and product panels in UI until separate distribution or real multi-product consumers justify a split. Use subpaths and lazy loading for bundle boundaries meanwhile.
- **Contracts:** the external wire protocol is owned by independent SDK DTOs and trusted adapters as described above. Any later extraction of Track, HTTP or errors must migrate consumers coherently without cycles and requires its own concrete reuse need.

## Validation and performance

`pnpm lint` checks dependency ownership and entry graphs before linting. Shared packages cannot import application aliases, escaping relative paths, undeclared internal dependencies or private exports. Pure audio, generic catalog and source metadata entry points must not eagerly load Vue, codecs or browser providers. Tests move with their implementations; host composition tests remain in the application.

Regression coverage includes independent assets, real PCM encoding, mixed sample rates, one read per reused asset, cancellation, encoder initialization retry, availability races and large nested recipes. Window selection no longer linearly rescans after binary search. Large recipe expansion avoids function argument limits. Failed prefetch workers stop claiming queued work. Invalid bounds and timeline overflow are rejected before encoding.

This page describes module contracts. Stage records distinguish automated and live acceptance. Documentation maintenance adds no live host/device evidence and does not update platform captureDate.

## Plugin data and native authority

Applications inject the tag/creation implementations and build-known theme loaders. Workbench consumes named ports, host records and projections; it never imports those plugin implementations. User associations/drafts remain in plugin namespaces, while published recipes stay host-owned. See [data ownership](plugin-data-ownership.md).

The source registry receives built-ins and native-verified catalog projections. Userscript fixes none; Tauri derives capabilities natively. `.amplugin` byte verification, install/consent, anonymous Gate, execution and revocation remain native-owned. No old source package or JSON interpreter is assembled. See [runtime policy](plugin-runtime-policy.md), [S15](plugin-system-s15-tools-and-desktop-delivery.md) and [S16](plugin-system-s16-mobile-delivery.md).

New theme-* packages inherit dependency, metadata and style boundaries automatically. See [Independent Theme Development](independent-theme-development.md).
