---
documentType: architecture
runtimeScope: tauri
---

# Desktop Backend Engineering

Chinese counterpart: [后端工程规范](../../zh-cn/桌面端/后端工程规范.md). Official documentation checked on **2026-10-08**. Applies to the root Cargo workspace native crates and `apps/tauri/src-tauri` alongside [Desktop Development](development.md). These responsibilities and budgets are repository decisions, not framework requirements.

## Versions and syntax

Keep the locked Tauri **2.12.1** and v2 documentation. The Rust crate now uses **2024 Edition**, inherits workspace MSRV **1.90**, with release toolchain **1.91.1** pinned in `rust-toolchain.toml`. Edition and compiler versions are separate. Prefer stable let chains, let else, `?`, iterators and ownership transfers supported by the MSRV. Avoid nightly features, extra allocations for shorter syntax, and unintended changes to lock lifetimes.

Sources: [Tauri commands](https://v2.tauri.app/develop/calling-rust/), [Rust releases](https://doc.rust-lang.org/releases.html), [Rust 2024](https://doc.rust-lang.org/edition-guide/rust-2024/index.html).

## Modules and directories

The root virtual workspace uses resolver 3, explicit members and the application as default member; members share root `Cargo.lock` and `target/`. Each crate retains its own `Cargo.toml` and `src/lib.rs`/`src/main.rs` entry points; business modules need not be flat. Rust module trees can nest by responsibility. This project uses `module.rs + module/child.rs`, with child declarations in named entry files rather than `#[path]` mappings to the old layout. Module documentation was checked on **2026-10-11**; this is not a live platform capture date.

```text
src/
├── lib.rs                 # Tauri composition, IPC registration and exit cleanup
├── main.rs                # Executable entry point
├── accounts.rs + accounts/ # Account commands, login, state and usage leases
├── browser.rs + browser/   # Manual verification, CDP, process trees, Douyin and experiments
├── network.rs + network/   # Native HTTP, proxies and request cancellation registry
├── storage.rs + storage/   # Encrypted credentials, atomic files and separate product snapshots
├── system.rs + system/     # File saving and external application capabilities
├── media.rs               # Bounded, revocable loopback media grants
├── model.rs               # Native public projections and request validation
└── state.rs               # Cross-module native state composition
```

Child modules remain crate-visible by default; reorganizing files does not create external APIs. The crate-root public re-export of `login_experiment` preserves the standalone example's import path. IPC command names, arguments, binary responses, stored filenames and permissions do not change with Rust module paths. Native unit tests remain colocated. Embedded JS assets and frontend contract tests follow their owning browser directory; process-tree tests derive subprocess test names from `module_path!()`.

The `product.json` commands belong to `storage/product.rs`, separately from account commands and encrypted credentials. Shared business logic and protocols remain in TypeScript packages. The workspace includes `am-plugin-protocol` (SDK Schema-generated serde DTOs, bounded decoding and field checks) and `am-plugin-policy` (pure compatibility, authorization and budget decisions). Application business modules stay in place; native plugin authority, networking, package transactions and execution are now composed by plugins. See the [package boundaries](../cross-platform/architecture/reusable-package-boundaries.md).

Sources: [Cargo package layout](https://doc.rust-lang.org/cargo/guide/project-layout.html), [Rust module files](https://doc.rust-lang.org/book/ch07-05-separating-modules-into-different-files.html).

## Workspace and plugin crate boundaries

Keep one Git monorepo and one root Cargo workspace. `workspace.package`, `workspace.dependencies` and `workspace.lints` centralize versions, dependency constraints and native lints with explicit member inheritance. Internal crates use path dependencies and `publish = false`; pnpm manages `apps/*` and `packages/*`. Preserve the application package/lib names, mobile entry and public example imports when reorganizing modules. Extract application modules only for stable ports, independent tests and concrete reuse or isolation needs.

| Crate                | Responsibility and dependency boundary                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `am-plugin-protocol` | SDK Schema-generated DTOs, versions and bounded validation; no Tauri, Tokio, IO, credentials or music rules                                                                              |
| `am-plugin-policy`   | Depends on protocol; pure subject/operation/scope/risk/budget decisions with injected time and policy snapshots                                                                          |
| `am-plugin-package`  | Depends on protocol; bounded ZIP/resources, integrity and signatures; no networking, installation/grant authority or execution                                                           |
| `am-plugin-runtime`  | Depends on protocol/policy; install/grant/context/provenance and journal state machines through Store/Clock/Ids/InstallFiles; no concrete DB, HTTP or filesystem IO                      |
| `am-plugin-net`      | Anonymous transport and public-target checks through an application-injected Gate; no protocol/policy/runtime dependency, Tauri, account CookieStores, proxies or installation authority |
| Application          | Composes runtime/package/net, SQLite/files, native consent, commands, executors and platform adapters                                                                                    |

Runtime and net do not depend on each other. Native dispatch binds installation/session/epoch, destination policy, cumulative budgets and cancellation before net receives a context; redirects, retries and Range reads retain it. No net command bypasses runtime or reuses an account-authenticated client. Public ports use bounded DTOs, named operations and opaque IDs; a policy result is not a renderer bearer grant. Verify transitive boundaries through Cargo metadata and independent crate tests.

Cargo features prune compilation; actual runtime capabilities, channel policy and user consent still determine authority. Test default and explicit release target/feature combinations to prevent desktop capability leakage into mobile. Portable crates do not depend on AppHandle, WebView labels or desktop process APIs. Missing platform adapters report unavailable. QuickJS-WASM runs in the restricted WebView/Worker; changing the executor requires new isolation acceptance.

Sources: [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html), [feature resolver](https://doc.rust-lang.org/cargo/reference/resolver.html#resolver-versions). Current capability support follows the [S15 matrix](../cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md) and [S16 record](../cross-platform/architecture/plugin-system-s16-mobile-delivery.md).

## Application commands and isolation

`src/ipc.rs` is the single registry; build.rs derives explicit AppManifest coverage. `permissions/product.toml` grants product commands only to the exact main WebView. The diagnostic relay binds the actual native caller; only the separate `s03-isolation-probe` example creates fixed sessions. Product, executor and Worker CSPs are separate. `pnpm check:plugin:isolation` is an offline build/test check. Product execution requires [exact target/resource admission](../cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md#evidence-and-limits); prototype acceptance cannot admit a changed product build.

## Search responsibilities

| Layer                      | Responsibility and implementation                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer / shared packages | Input, presentation and public account selection; music-sources retains shared protocols, signing, JSON/frame parsing, DTO mapping and lazy pagination for both runtimes              |
| Rust commands              | `browser/douyin_browser/commands.rs` validates complete search identity before account queuing or browser startup                                                                     |
| Rust account actor         | Owns the browser/Profile, CookieStore and proxy; serializes operations, checks generations, handles cancellation/deadlines, commits credentials and reaps idle resources              |
| Rust CDP search            | `search.rs` drives official controls and matches responses; `search/cache.rs` owns bounded transport bytes, deduplication and stale-cursor reclamation without duplicating music DTOs |

Bilibili search already uses `native-http -> IPC -> Rust HTTP`. Shared pagination and mappings do not need a Rust duplicate. Douyin login, session checks and search all use CDP. Verification and ordinary network/page timeout failures stop. Explicit proxy/tunnel errors may select ordered user-configured backups while retaining the same account. Existing later pages require a refresh rather than reuse a cursor across browser sessions. Requests, policy and process control stay native; shared packages continue to map DTOs.

## Async state and ownership

- Use async Tauri commands for network, waits and substantial work. Protect pure memory with short standard Mutex scopes; use async locks or a single actor for resources spanning await. Never hold a standard MutexGuard across await. Move blocking work to bounded blocking tasks where needed; dropping their future does not stop underlying work.
- Preserve serialized account operations, fixed generations and cancellation tokens. Deadlines cover queuing, startup and reading. Reclaim timed-out work rather than only ignoring renderer results. Preserve acknowledged target creation and bounded process-tree cleanup.
- Pending replies in `browser/cdp.rs` have a Drop guard: an outer timeout/select dropping a future releases its slot immediately and late replies cannot satisfy another command. The reader moves JSON Values instead of cloning large bodies. Plain response Strings become bytes by ownership transfer; Base64 lengths are checked before decoding.
- Closing a renderer listing sends cancel_request before queuing target closure and rejects late successes. The native account actor closes CDP targets and reclaims cancelled reads. Preserve the first failure and prevent late events from reviving closed listings.
- Preserve existing native/AppErrorState projections. Upstream diagnostics and private context stay inside adapters. Do not add arbitrary URLs or remote-page IPC privileges.

Sources: [Tauri state management](https://v2.tauri.app/develop/state-management/), [Tokio bounded channels](https://docs.rs/tokio/latest/tokio/sync/mpsc/index.html).

## Structures and budgets

- Account signing projections borrow only the required Cookie fields instead of copying the entire Cookie map. Preserve last-value precedence for duplicate names, UIFID priority over UIFID_TEMP, empty values and missing fields. Native request-header filtering compares ASCII case without allocating lowercase names. Response headers are written directly into one String, retaining duplicate headers, order and empty projections for non-text values while still filtering Set-Cookie.
- Platform identity switches retain account cancellation order, then build one borrowed HashSet to revoke matching media grants in expected O(accounts + grants) rather than a cross-product scan. Anonymous media and other platforms remain intact, as do configuration and credentials.
- Rust session/cache keys use expected O(1) HashMap lookups. Incremental account byte accounting replaces a full cache scan on each body completion. Cursor deduplication scans at most 8 pending requests, and reclamation at most 3 packets; these small bounded collections do not need extra mirrored indexes.
- CDP bodies are limited to **12 MiB each**, **3 packets per listing**, and **24 MiB cached bytes per account**. Keep at most 8 pending requests per listing and 8 listings per account. Reject duplicate requests/cursors. Consuming a cursor frees older packets/pending records; full or stale caches skip getResponseBody calls.
- Independent timer checks close search listings after two idle minutes. Authenticated hidden account browsers also reclaim their process trees after two minutes without operations; later requests can reopen the same Profile.
- CDP response capture matches fixed HTTPS origin/port, XHR/Fetch type, unique keyword/offset, and ASCII decimal bounded cursors. Reject duplicate empty parameters and fragments.
- Keep raw binary IPC Responses, with renderer buffer views rather than JSON number arrays/Base64. These budgets cover cached bodies, not browser memory, WebSocket/decode intermediates or the complete process tree; those require separate measurement.

## Quality and acceptance

The application typecheck includes Vue/TS, Rust formatting and `cargo clippy --workspace --all-targets --locked -- -D warnings`. Native checks include all targets. Do not silence warnings globally; explain necessary fixed-IPC and process-tree-fixture exceptions locally.

Native tests use `cargo test --workspace --locked`; formatting uses `cargo fmt --all --check`. `pnpm check:rust:boundaries` checks complete pure dependency closures from metadata; `pnpm check:protocol` compares the shared corpus. `pnpm check:rust:msrv`, `pnpm check:rust:release` and `pnpm check:rust:deny` check the minimum toolchain, explicit target/features and dependencies. `scripts/native-targets.json` declares Windows x64, macOS arm64/x64 and Linux x64 build configurations; never release with `--all-features`. Build checks do not establish runtime or external-plugin admission; see the [release workflow](../cross-platform/architecture/github-actions-release.md).

Run targeted tests, application typecheck/check:native and the root test/typecheck/lint/format:check/build gates. Regressions should establish request counts, duplicate handling, cache limits/reclamation, fixed identities and cleanup after cancellation. Public-network elapsed time alone is insufficient.

## Native plugin contracts

- [Authority](../cross-platform/architecture/native-plugin-authority.md): independent schema-3 database, contexts, provenance, serialized commits/revocation and bounded blocking jobs.
- [Networking](../cross-platform/architecture/plugin-networking.md): anonymous Gate, per-hop validation, cumulative budgets and final-delivery barriers.
- [Packages and recovery](../cross-platform/architecture/plugin-packages.md): bounded owned bytes, immutable staging, durability before committed pointers and code/data rollback.
- [Desktop delivery](../cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md): native consent, DEV, controlled results and exact-target admission.

Use fault injection for archive/DB/filesystem boundaries, revocation races and cancellation. Timeouts do not forcibly stop an executing blocking job. Offline tests do not establish physical power-loss or live target/device acceptance.
