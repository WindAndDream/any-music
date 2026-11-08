---
documentType: architecture
runtimeScope: shared
---

# Any Music Project Architecture

Chinese counterpart: [Any Music 项目架构](../../../zh-cn/跨平台/架构/项目架构.md).

Scope: shared ownership and runtime comparison. GM details apply only to Userscript; IPC/Rust details apply only to Tauri. Start runtime work with [userscript](../../userscript/development.md) or [desktop](../../desktop/development.md) rules.

Production runtimes are `apps/userscript` and `apps/tauri`. Workbench features, player, downloads, library, stores and snapshot sanitizers live in `packages/music-workbench`. GM/page bridges remain userscript adapters. See [Tauri Runtime](../../desktop/runtime-architecture.md) for current native/mobile scope.

## Product data ownership

Host/namespace ownership uses generation commits and current-schema portable-data APIs. Tag/creation plugins own their tag/creation sessions; the workbench assembles named ports and projections. Current product partitions initialize directly, without scanning previous business keys. Both runtimes configure `/storage` adapters before mounting. See the [data ownership](plugin-data-ownership.md).

## Presentation assembly

The current graph adds `music-workbench -> plugin-ui-vue -> ui/plugin-sdk`; ui still does not depend on the plugin framework. Application theme-package roots supply metadata, `/trusted` owns trusted Vue assembly/theme transactions and the root renders bounded host UI. Player, download, library and navigation preference ownership stay in place. See the [record](reusable-package-boundaries.md).

production applications inject build-owned metadata, complete roots, loaders and an explicit preloaded classic fallback into one shared workbench. Classic and Studio own their independent complete page trees; workbench projects one stable controller through public ui/theme contracts and never imports theme implementations. Audio, downloads, source sessions, editing and protected native/account surfaces outlive presentation replacement. ui/catalog and ui/library retain neutral interactions; tag/creation plugins retain sessions and namespaces.

Shared/SFC/selected-theme styles are inert values activated transactionally in a stable internal Shadow surface. Protected slots receive separate host-only CSS. Userscript retains its outer Shadow mount and light document-start launcher; Tauri retains embedded/capability-driven composition. Real build audits enforce metadata isolation and delayed optional Studio execution. Partial loaders/dispatch and extraction maps are unsupported. Only one theme.root is allocated; page/row skins stay in independent theme packages. Browser/device acceptance remains T13. See the [theme development](independent-theme-development.md).

## 1. Architecture Goals

Any Music uses a pnpm monorepo for the Tampermonkey userscript and Tauri desktop app. Mobile native adapters will evolve in the same Tauri app.

The architecture is designed to:

- Share Vue components without coupling them to Tampermonkey or Tauri.
- Share music domain models and business logic without coupling them to Vue, the DOM, or platform APIs.
- Keep small helpers with their owning modules and extract packages only for stable, demonstrated reuse.
- Isolate platform capabilities such as networking, storage, file-system access, and Shadow DOM integration inside their respective applications.
- Keep dependencies unidirectional to prevent cycles and simplify cross-platform migration.

## 2. Top-Level Structure

```text
any-music/
├─ apps/
│  ├─ userscript/          # Product Tampermonkey application
│  ├─ tauri/               # Tauri desktop and future mobile adapters
├─ packages/
│  ├─ account-pool/        # Portable account identity, policies and leases
│  ├─ network-routing/     # Pure request competition and proxy health
│  ├─ audio-composition/   # Portable timeline and optional browser codecs
│  ├─ plugin-center/       # Headless plugin lifecycle
│  ├─ plugin-sdk/          # DTO/wire/generated schema validation
│  ├─ plugin-ui-vue/       # Bounded DTO rendering and trusted themes
│  ├─ plugin-tag-management/ # Tag rules, state and lazy specialist views
│  ├─ plugin-music-creation/ # Drafts, materials and lazy creation editor
│  ├─ plugin-vm/           # Fixed permissionless QuickJS kernel
│  ├─ plugin-sandbox-browser/ # Trusted Worker and bounded sessions
│  ├─ plugin-testkit/      # Node-only same-VM author testing
│  ├─ plugin-cli/          # Node-only author CLI and package tools
│  ├─ plugin-source-bilibili/ # Bilibili protocols, metadata and contributions
│  ├─ plugin-source-douyin/   # Douyin protocols, metadata and contributions
│  ├─ music-workbench/     # Shared product composition, playback and stable storage sanitizers
│  ├─ core/                # Music domain and platform capability interfaces
│  └─ ui/                  # Cross-platform Vue components and styles
├─ crates/                 # Native protocol/policy/runtime/net/package libraries
├─ .agents/skills/         # Repository-specific, fragile, or high-risk workflows
├─ scripts/                # Package boundary checks and isolated fixture tests
├─ docs/                   # Project design and architecture documentation
├─ AGENTS.md               # Concise development constraints for AI agents
├─ package.json            # Root commands and repository-level tooling
├─ pnpm-workspace.yaml     # Workspace scope and dependency version catalog
└─ tsconfig.base.json      # Shared TypeScript rules
```

Desktop and mobile share `apps/tauri`. Split it into `apps/desktop` and `apps/mobile` only after their page structures, navigation, or native capabilities diverge significantly.

Each workspace package has one package-level `test/` directory that mirrors the responsibility hierarchy under `src/`. This keeps production code out of the test tree without flattening unrelated tests; fixtures stay under the owning package’s `test/` directory.

## 3. Dependency Direction

```text
apps/userscript ──┐
apps/tauri ───────┴───> packages/music-workbench ───> ui / core / plugin-center
       │               packages/core ─────> packages/audio-composition
       └──────────────> runtime adapters and account composition


```

Allowed internal dependencies:

- The pure `audio-composition` entry has no internal dependencies.
- `network-routing` has no internal dependencies; `account-pool` depends only on `network-routing`, composed by runtimes. Integration status: [desktop accounts and proxies](../../desktop/runtime-architecture.md#accounts-and-verification).
- `core` may depend on the pure `audio-composition` entry.
- `ui` may depend on `core` and pure `audio-composition` contracts, but never on `apps/*`.
- `music-workbench` composes ui/core/audio-composition/plugin-center, with trusted conversions consuming plugin-sdk, through injected runtime ports, without GM, Tauri, Node or app imports.
- `apps/*` may compose all shared packages and implement the platform interfaces defined by `core`.
- Circular dependencies between shared packages are prohibited.

See [Reusable Package Boundaries](reusable-package-boundaries.md) for entry points, runtime adapters and further extraction criteria.

### 3.1 Target plugin architecture and migration boundaries

The plugin framework owns lifecycle, static contributions, dependencies/allocation and trusted themes. Current data, feature, VM and native contracts follow [implementation status](plugin-system-refactoring-steps.md); [desktop delivery](plugin-system-s15-tools-and-desktop-delivery.md) determines admitted targets and capabilities.

The boundaries below distinguish implemented layers from targets still requiring acceptance. The [redesign plan](plugin-extension-contracts.md) also covers unsupported extensions, distribution and mobile behavior; design alone does not enable them.

- The host retains Discover, queue, favorites, playlists, downloads/history, playback history, Center, playback, authorization, scheduling, and persistence. Tags and creation become independent built-ins; each source is a source plugin rather than expanding MusicSourcePlugin into every feature.
- Use manifests, multiple declarative contributions, and authorized services. Separate wire contracts, executor ports, and capability brokers; applications inject implementations. Workbench never reads plugin internals and ui never depends on concrete plugins.
- Desktop/mobile share package format and installation transactions. Files, associations, share reception, URLs, and deep links are acquisition entries into the same preview/compatibility/grant flow. Platform adapters turn files/URIs into private staging snapshots; execution kind and effective policy remain independent. A later marketplace reuses the installer.
- Rust owns authoritative Tauri installation instances, grants, and budgets; frontend state is a display cache. Native dangerous operations recheck authority. SDK does not expose GM, IPC, accounts, CDP, or the complete workbench. Trusted built-ins and malicious externals have distinct trust models.
- The host owns canonical data and published recipes; plugins own draft/tag namespaces. Creation disablement preserves standard recipe execution, while disabled leaf sources still stop affected media. Missing-plugin data is retained without execution.
- Planned local users remain host-owned; independent account providers, cloud synchronization, sharing and reports belong to optional plugins/services. A local user may bind multiple accounts across provider instances. Web motivates host service/API extraction, without moving account-provider business into core. These contracts are not implemented; see the [local-user and service plan](multi-user-local-cloud-plan.md).
- Deliver built-in contributions and recoverable migration before no-capability sandboxing, network authorization, and mobile adapters. Create packages/public SDKs/Rust crates only with concrete testable responsibilities; update boundary checks and local guides with implementation stages.

## 4. `apps/userscript`: The Tampermonkey Application

`apps/userscript` is the current runnable and buildable product entry point. It owns all code that is specific to the browser userscript environment.

```text
apps/userscript/
├─ public/
├─ src/
│  ├─ features/            # Runtime composition for built-in sources
│  ├─ platform/            # DOM, GM HTTP/storage and page bridges
│  ├─ styles/              # Application styles injected into the Shadow Root
│  ├─ App.vue
│  ├─ bootstrap-userscript-app.ts
│  ├─ main.ts
│  └─ vite-env.d.ts
├─ test/                   # Product-app tests mirroring src responsibilities
├─ index.html
├─ package.json
├─ tsconfig.app.json
├─ tsconfig.node.json
└─ vite.config.ts
```

### 4.1 `src/main.ts`

This is the lightweight `document-start` entry point. It is responsible for:

- Installing the required shortcut boundary and Douyin page bridge before host scripts.
- Separating capture-only fallback tabs from the normal visible entry.
- Mounting a framework-free launcher on normal HTTP(S) top-level pages.

It must not import Vue, Pinia, the library, player, or media encoders. The first user expansion dynamically loads `bootstrap-userscript-app.ts`, which creates Pinia, collects inline styles, and mounts `App.vue` in the Shadow Root. A failed load keeps a retryable launcher.

### 4.2 `src/App.vue`

The root composition component currently composes `MusicSourceWorkbench`. The product workbench connects sources, Listen Later, playback, library, segment creation, downloads, histories, plugins, and global settings; feature composables still own their state.

Keep the root component lightweight. When a feature gains independent state, a distinct UI region, or reusable logic, extract it into a feature component or composable instead of continuing to expand `App.vue`.

### 4.3 `src/platform/dom`

This directory contains DOM capabilities that apply only to userscript page injection. The current mount module is responsible for:

- Creating a unique `<any-music-root>` host element.
- Mounting the host under `document.documentElement`.
- Creating the Shadow Root, style nodes, and Vue mount point.
- Monitoring whether the target site removes the host and remounting it when necessary.
- Providing a complete unmount function that cleans up both the Vue instance and the `MutationObserver`.

These capabilities must not move to `ui`, because a Tauri page does not need the userscript injection process.

### 4.4 `src/platform/http`

This directory contains the Tampermonkey networking adapter. `gm-http-client.ts` implements the `HttpClient` interface from `core` using `GM_xmlhttpRequest`.

Shared code depends on `HttpClient`, without direct GM calls. Tauri implements isolated CookieStores and proxies through Rust commands; the renderer holds no complete credentials.

The same principle applies to storage, the clipboard, the file system, and system notifications: interfaces belong in `core`, while concrete implementations belong in the corresponding `apps/*/platform` directory.

### 4.5 `src/styles/host.scss`

This file is responsible only for style isolation between the Shadow Host and the host page, including:

- Resetting inherited properties on the host.
- Fixing the `color-scheme` and root font size.
- Applying a consistent box model to elements inside the Shadow Root.

Shared component styles do not belong here; they are provided by `packages/ui`.

### 4.6 `vite.config.ts`

This Vite configuration is exclusive to the userscript. It contains `vite-plugin-monkey`, script match patterns, and `GM_*` permissions. Vue and other runtime dependencies are bundled into the installed script so opening another host page does not request a CDN runtime. Other applications must not reuse or import it.

For the local Vite page, `index.html` loads `src/platform/dev/install-dev-userscript-runtime.ts` before the product entry and exposes only the minimum `GM_*` compatibility needed for layout, theme, focus, and accessibility regression checks. The production entry never imports this module. Cross-origin requests, cookies, authenticated sessions, downloads, and host-page compatibility still require the real Tampermonkey artifact.

Directory extraction is determined by responsibility, not file count. Portable platform signing, API, types and mappings belong to `packages/plugin-source-*/src`; application platform directories keep only runtime adapters. Built-in sources keep `MusicSourceDescriptor` separate from their implementation so registration can show metadata and validate URL scopes without executing platform code; the first session, listing consumption, or media resolution dynamically imports the adapter, and failed imports remain retryable.

The userscript retains `*://*/*` and `@noframes` metadata so cross-site requests and Douyin fallback tasks remain authorized. It provides its native launcher on normal HTTP(S) top-level pages and keeps `document-start` bridges separate from the Vue tree loaded after first expansion.

The product workspace persists enabled IDs, search/import drafts, proxy/download settings, and replayable drawer recipes. It never persists `Track` results, loaded-page counts, iterators, or media. Restored drawers stay collapsed and fetch one first page only when reopened.

Each production runtime has one download manager. core/download owns workers/retries/cancellation; music-workbench/src/features/downloads owns media and MP3/ZIP output; music-workbench/src/storage persists metadata through injected storage ports. Userscript converts GM proxy only in platform/http, keeping secrets in script configuration. Desktop Rust binds account/proxy transport and native commands save files.

See [Music Source Plugin Architecture](music-source-plugin-architecture.md) for the shared plugin contract, lazy pagination, and ephemeral-media constraints used by the Bilibili and Douyin slices. See [Feature Requirements and Roadmap](../planning/feature-requirements-and-roadmap.md) for milestones and definitions of done. Captured fields are documented in [Bilibili Web API Contract](../platforms/bilibili/web-api-contract.md) and [Douyin Web API Contract](../platforms/douyin/web-api-contract.md).

## 5. `packages/core`: Domain and Platform Interfaces

`core` describes what Any Music is and what it can do, but not how the current platform performs those operations. It uses only TypeScript and does not depend on Vue, the DOM, Tampermonkey, or Tauri.

```text
packages/core/src/
├─ errors/                 # semantic errors, stable AM status codes, serializable states
├─ download/               # platform-neutral concurrency, retries, and cancellation
├─ library/                # Local library models, tags, and segment recipes
├─ models/
│  └─ track.ts
├─ music-source/           # Plugin contracts, manifest validation, pagination, and media policies
├─ player/
│  ├─ normalize-progress.ts
│  └─ playback-mode.ts
├─ ports/
│  └─ http-client.ts
└─ index.ts
```

### 5.1 `models`

This directory contains music domain models such as tracks, artists, albums, lyrics, playback queues, and source platforms. Keep types close to the domains they describe instead of creating an unowned, global `types` directory.

### 5.2 Domain Modules

Organize pure logic by business capability. `music-source/policies.ts` centralizes page-size normalization and media loading policies. `library` manages persistable data and virtual segments; `player` owns playback rules; `download` schedules fixed workers without DOM `AbortSignal`, timers, or Blob; and `errors` is the single catalog for expected operational failures and `AM-*` status codes.

If a function understands music concepts such as tracks, lyrics, artists, or playback queues, it belongs in `core`, even when it is a pure function.

### 5.3 `ports`

This directory defines the platform capability interfaces required by the business layer, such as:

- `HttpClient`
- `KeyValueStorage`
- `AudioOutput`
- `FileSystem`
- `NotificationService`

Interfaces are defined by `core` and implemented by `apps/userscript` and `apps/tauri`. This prevents business code from binding directly to `GM_*` or Tauri APIs.

### 5.4 `index.ts`

This is the shared package's public entry point. Other packages should import from `@any-music/core` rather than reaching into internal paths under `core/src`. Export only APIs that the project is prepared to maintain over the long term.

## 6. `packages/ui`: Shared Vue Components

`ui` provides Vue components, UI composables, and design styles for the userscript, Tauri desktop and future mobile adapters. See [Cross-Platform UI and Interaction](../features/cross-platform-ui-and-interaction.md) for the visual and interaction contract.

```text
packages/ui/src/
├─ components/
│  ├─ AppIcon.vue
│  ├─ NavigationRail.vue
│  ├─ MobileBottomNavigation.vue
│  ├─ MusicAppShell.vue
│  ├─ BottomSheet.vue
│  └─ PanelShell.vue
├─ styles/
│  └─ index.scss
└─ index.ts
```

### 6.1 `components`

Components use the Vue 3 Composition API, `<script setup lang="ts">`, and explicit props, emits, and slots contracts. They receive data through props and express interactions through events; they do not read `GM_*` or Tauri state directly.

Shared foundations and controlled product panels live in `packages/ui`, including navigation, the shell, library, catalog, filters, settings and plugin forms; `PanelShell` retains a minimal compatibility contract. `music-workbench` owns product composition, playback and snapshot sanitizers. Applications keep runtime adapters, account composition and Shadow DOM/native mounting. Tests follow responsibility in each package's `test/`.

When several related components are added, organize them into feature directories such as `components/player` and `components/lyrics` instead of allowing every file to accumulate at the same level.

### 6.2 `styles`

Shared styles are exported separately through `@any-music/ui/styles`:

- The userscript uses Vite's `?inline` query to inject them into the Shadow Root as a string.
- A Tauri application can import them as regular styles.
- Custom properties use the `--am-*` prefix and provide defaults on `.am-root`.
- Shared dimensions should prefer `px` or controlled, local `em` units instead of depending on the third-party page's root `rem` value.

Component styles can usually remain alongside their SFCs. However, common styles that must be injected into the same Shadow Root need to use the unified style entry point. Styles that Vite injects into the page head by default cannot cross the Shadow DOM boundary.

### 6.3 Vue Dependency

`ui` declares Vue as a peer dependency, with each application providing its runtime version. This prevents the component package from bundling a second copy of Vue. Userscript applications still bundle that single provided runtime into the final `.user.js`; peer ownership does not require remote `@require` loading.

## 7. Local Helpers and Package Extraction

Keep small helpers with their owning module. Playback progress normalization belongs in `core/src/player/normalize-progress.ts`, including its numeric bounds; it does not need a separate general-purpose package.

Music semantics belong in `core`, Vue/DOM behavior in `ui`, and GM/Tauri logic in the corresponding application's `platform` directory. Extract a new shared package only when several independent consumers demonstrate a stable responsibility and a clear dependency boundary. Do not reserve empty packages for possible future utilities.

Each workspace package contains a local `AGENTS.md` at its root. AI agents and developers working in a specific package should follow both the root constraints and the package-level instructions nearest to the current file. Local files supplement the package's responsibilities instead of repeating the full architecture documentation.

## 8. Deciding Where Code Belongs

Evaluate new code in this order:

1. Does it call `GM_*`, Tauri, or another runtime-specific API? Put it in the corresponding `apps/*/platform` directory.
2. Does it depend on Vue, the DOM, or visual interaction? Put it in `ui`; if it serves only one runtime, keep it in the corresponding `apps/*` package.
3. Does it understand music concepts such as tracks, lyrics, playback, or search? Put it in `core`.
4. Is it short and used by only one caller? Keep it near that caller.
5. Do independent consumers share a stable responsibility? Reuse an existing package with that responsibility, or evaluate extraction once that need is demonstrated.

## 9. Package Exports and Build Strategy

Existing business packages remain private, source-first workspaces. plugin-sdk additionally provides locally packed ESM/declaration artifacts consumed outside the repository and has not been published to npm (see [contracts](plugin-extension-contracts.md)):

- Each `package.json` points its `exports` directly to `src`.
- Vite processes shared TypeScript, Vue SFCs, and Sass while building an application.
- Each package uses its own `typecheck` script to validate its complete source tree.
- Internal dependencies must use `workspace:*`.

Add independent build artifacts and declaration-file builds to shared packages only when they need to be published to npm, consumed by a non-Vite project, or when build performance is measurably affected. Other business packages do not gain another packaging layer; plugin-sdk is the exception with an established external-contract consumer.

### 9.1 Userscript Dependency Caching

The userscript manager's persisted installation artifact is the boundary for "strong caching":

- Vue, `js-md5`, and other runtime dependencies are bundled into the `.user.js`; refreshing a page, navigating across sites, or changing SPA routes does not download them again.
- `pnpm-lock.yaml` and the catalog pin dependency versions. Upgrades are verified and released with a new script version.
- Floating CDN `@require` values such as `vue@3` are prohibited because their content can change without a project release and is unavailable offline.
- An exact-version external URL is allowed only after measurement shows that a dependency materially slows installation or updates and the project explicitly accepts CDN availability and supply-chain risk.

The product and test scripts bundle the Vue, Pinia, Mediabunny, MP3 encoder, ZIP, and platform adapters that each consumes into installable artifacts. Dynamic modules delay execution, but a dynamic import alone is not evidence that a future mobile build is smaller. A mobile app needs its own entry, tree-shakeable exports, and output analysis so desktop-only navigation, operators, and heavyweight editors are absent from its dependency graph. Record output size after each material dependency change instead of relying on an outdated fixed number.

### 9.2 Third-Party Library Admission

Before adding a library, check in order whether a clear browser or CSS API already solves the problem; whether the library supports browser ESM and tree-shaking; whether its maintenance, license, and tests are trustworthy; whether it introduces Node.js polyfills; and whether its gzip increase is proportional to the benefit. The workbench used GSAP for one horizontal translation, which was replaced with CSS `transform`/`transition` and removed. WBI continues to use the small `js-md5` package. Douyin SM3 and RC4 remain local because they are tightly coupled to the `a_bogus` contract and already have fixed-vector tests; they are not replaced merely to "standardize dependencies."

## 10. Common Commands

Run these commands from the repository root:

```bash
pnpm install           # Install all workspace dependencies
pnpm dev               # Start the product userscript in dev mode
pnpm dev:staging       # Start the product userscript in staging mode
pnpm dev:prod          # Start the product userscript in prod mode
pnpm typecheck         # Check all applications and shared packages
pnpm test              # Run domain algorithm and manifest validation tests
pnpm lint              # Run oxlint
pnpm format            # Format with oxfmt
pnpm format:check      # Check formatting without making changes
pnpm build             # Type-check, then build every buildable application
```

Use pnpm filters to target a single package:

```bash
pnpm --filter @any-music/userscript build
pnpm --filter @any-music/ui typecheck
pnpm --filter @any-music/core typecheck
```

## 11. Runtime Extensions

Tauri already exists in apps/tauri. Read [desktop rules](../../desktop/development.md) and the native local guide before changing it. Implement runtime ports in the application; shared workbench/UI import neither GM nor Tauri. New runtimes consume shared contracts and own transport, storage, media and permissions. Add packages only for stable reused responsibilities.

The current three applications and nine shared packages are covered by the pnpm workspace, catalog, `workspace:*`, and recursive scripts. Installation rejects circular dependencies through `disallowWorkspaceCycles: true`; the project currently does not use Nx or Turborepo. Run a proof of concept only after at least one measurable condition appears:

- full CI tests and builds consistently exceed about five minutes while most changes affect only a few packages;
- the repository needs a reliable affected graph, cross-machine remote cache, or distributed tasks;
- applications and packages grow into the teens, several teams own them independently, and existing scripts no longer express task dependencies clearly.

The proof of concept must compare cold and warm build time, cache hit rate, CI configuration complexity, and vendor coupling. Continue using pnpm when the data shows no benefit, and do not describe a task orchestrator as "multi-repository management." If the project is ever split into multiple Git repositories, evaluate releases, contract compatibility, and cross-repository dependencies separately; the current monorepo tooling cannot substitute for that design.

## 12. Repository Skills

Repository skills capture recurring, error-prone workflows rather than repeating ordinary TypeScript or Vue knowledge:

- `$any-music-userscript-runtime`: Userscript GM requests, cookies/page bridges, storage and permissions;
- `$any-music-tauri-runtime`: desktop IPC, Rust requests, accounts/media and native capabilities;
- `$music-source-adapter`: shared adapter boundaries, lazy pagination, state machines, and on-demand media resolution for every platform;
- `$bilibili-contract-capture`: redacted Bilibili contract recapture in the dedicated test browser;
- `$douyin-contract-capture`: redacted Douyin contract recapture in the dedicated test browser; suspend automation on 2483, a verification page, or CAPTCHA until the user handles it;
- `$any-music-ui-delivery`: align cross-runtime semantics, Shadow DOM styles, responsive behavior, motion, accessibility, and real bundle boundaries while implementing or reviewing product UI;
- do not create a skill for every platform that only performs ordinary REST mapping; add one only when signing, risk control, browser state, or redaction becomes a stable and non-obvious independent boundary.

Skills provide task workflows and `AGENTS.md` keeps durable guidance. See [Development Workflow](development-workflow.md) for naming, Vue boundaries, build modes and official guidance maintenance. Synchronize changed platform contracts, types, parsers and mappers; update captureDate only after explicitly requested live recapture actually runs.

## Current plugin contracts

Use [data ownership](plugin-data-ownership.md), [runtime policy](plugin-runtime-policy.md) and [package boundaries](reusable-package-boundaries.md) for implementation. [S15](plugin-system-s15-tools-and-desktop-delivery.md) and [S16](plugin-system-s16-mobile-delivery.md) define actual desktop/mobile delivery and remaining gates.

See [Independent Theme Development](independent-theme-development.md) for adding a third theme through the same contracts, build resources and boundary checks.
