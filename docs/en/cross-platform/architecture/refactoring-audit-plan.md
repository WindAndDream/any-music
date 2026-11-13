---
documentType: audit-plan
runtimeScope: repository
---

# Refactoring Audit Plan

Chinese counterpart: [重构分板块排查计划](../../../zh-cn/跨平台/架构/重构分板块排查计划.md). Planned on 2026-10-21 (Asia/Shanghai).

Determine whether implementation has the correct owner, meets current refactoring standards, and has the required acceptance evidence. Work through area → sub-batch → one call chain, completing one sub-batch per conversation. This is the reusable audit procedure, not a completed audit report; candidates start unreviewed. For the existing run's actual reviewed and pending scope, consult its [ledger](../../../baselines/refactoring-audit/2026-10-21-b00-e0884a5/summary.json) rather than treating the initial state as current.

## 1. Usage and baseline

1. Run B00 once to establish the baseline, area inventory and execution queue.
2. Select an area in section 4, then one sub-batch; for example, `B10-bilibili-listing-shared`, rather than all of B10.
3. Read sections 2, 3 and 5, the selected area entry, and necessary standards only. Do not load the entire plan, its translation and every stage record.
4. Follow section 5 to locate implementation, trace a chain, test and assess status. Save the section 7 handoff, then continue in a new conversation.
5. Run B21 aggregation and repository gates after the relevant local batches. Running repository commands does not require loading repository-wide source.

Use authorities by responsibility: root and target `AGENTS.md` define constraints; [project architecture](project-architecture.md), [package boundaries](reusable-package-boundaries.md) and [development workflow](development-workflow.md) define ownership; [implementation steps](plugin-system-refactoring-steps.md) record current progress; [S15](plugin-system-s15-tools-and-desktop-delivery.md)/[S16](plugin-system-s16-mobile-delivery.md) matrices bound actual capabilities. Historical counts and closed stages do not replace current evidence. Record conflicts and check maintained guidance against actual matrices instead of inferring authority from dates alone.

Current documentation declares the shared plugin architecture and S11–S15 implemented, with S16 in progress. Userscript is built-in-only, mobile external policy is `none`, and desktop externals require exact target admission and native consent. External catalogs have no media resolution; registry publication, OS installer associations and mobile device/channel acceptance have separate exits. These declarations establish expected scope, not findings from this audit.

## 2. Context and token limits

| Item         | Default per sub-batch                                                                             | When the limit is reached                                                         |
| ------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Behavior     | One invariant or user operation; one source and runtime                                           | Create another sub-batch                                                          |
| Code         | One primary module plus direct caller/adapter neighbors; initially 6–10 implementation/test files | Split after about 15 new files instead of tracing the entire dependency tree      |
| Standards    | Root guide, local guides, relevant sections of 1–2 documents, necessary skills                    | Explain the concrete question before adding another reference                     |
| Tool output  | Filenames/symbols first, then numbered excerpts; about 150 lines per response                     | Narrow paths/excerpts after truncation; incomplete output cannot establish a pass |
| Conversation | Roughly 6k–10k tokens of new reading as a splitting reminder                                      | An estimate, not a billing guarantee; split complex native transactions further   |
| Handoff      | Approximately 150–300 English words, retaining evidence locations and next action                 | Keep raw logs locally rather than pasting them in full                            |

Locate files with `rg --files <explicit-directory>`, then search with `rg -n <symbol> <explicit-files-or-directory>`. Read bounded excerpts using `Get-Content -LiteralPath <file> | Select-Object -Skip <offset> -First <count>`. Inspect matching filenames before bodies. Use equivalent scoped discovery if `rg` is unavailable.

Do not default to unscoped full-text searches, reading every `AGENTS.md`, or loading complete lockfiles, build outputs, generated code or large fixtures. B00 may inventory workspaces and B21 may run repository boundary checks; neither constitutes a source audit of the entire repository. Check generation consistency before opening the smallest relevant Schema/generated difference.

Record cross-boundary questions as caller → public contract → callee, open question, and owning batch. Read a direct neighbor only when necessary to decide the current invariant, recording why scope expanded. Queue fixes, additional features and unrelated naming cleanup separately; auditing does not modify product implementation by default.

## 3. Common assessment rules

Choose 3–5 concrete criteria per sub-batch. Record pass/fail/unknown/not applicable and evidence for each. Explain capability boundaries for exclusions. After finding a failure, finish other independently assessable criteria within scope.

| Criterion                   | Facts to check                                                                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 Ownership/dependencies   | One implementation owner per responsibility; public exports only; `workspace:*` internally; no shared-to-app dependency, private-path escape, cycle or forwarding package without a responsibility                                                                                                                |
| C2 Entries/injection        | Lightweight entries do not eagerly load Vue, codecs, source implementations or engines; explicit runtime injection; failed dynamic imports allow retry                                                                                                                                                            |
| C3 Behavior/lifecycle       | Visible wording, events and results preserve contracts; bounded request count/order/concurrency; explicit owners for cancellation, retry, stale results, subscriptions and resources                                                                                                                              |
| C4 Data/errors              | Product snapshots retain stable identities, recipes and necessary metadata only, excluding ephemeral media URLs, Blob URLs, bytes, final paths and credentials; credentials stay in dedicated owning-runtime storage; cross-layer `AppErrorState` retains upstream causes; namespaces/recovery grant no authority |
| C5 Authority/runtimes       | Separate GM, account-bound built-in Rust HTTP and anonymous external Gate; native identity/epoch/budget checks; unknown capabilities/targets reject; renderer caches grant nothing                                                                                                                                |
| C6 Verification/maintenance | Tests follow owners and cover behavior/failures; evidence matches scope; locales/indexes/progress/matrices agree; documentation edits do not advance `captureDate`                                                                                                                                                |

Keep three independent status fields:

| Field                 | Values and meaning                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refactoring status    | `unreviewed`; `partial` for mixed/incomplete ownership migration; `conformant` within inspected scope; `violating` for a concrete violation/regression                                                |
| Verification evidence | List `static`, targeted `tests`, production `artifact`/resource graph, and exact-environment `live` separately; mark pass/fail/not run/not applicable without assuming that one includes another      |
| Batch verdict         | `pending`; `pass-scoped`; `needs-fix`; `blocked` with an environmental/external cause; `deferred-live` for required missing runtime evidence; `unsupported-by-design` after checking expected refusal |

`conformant + tests passed + live not run` establishes local conformance only. Pure algorithms need no live acceptance; GM, Rust and device capabilities need their own evidence. Website capture, Vite substitutes, IPC mocks, builds and reference-device Debug checks each prove their own scope. Preserve failures and unknowns instead of averaging away authority, data-loss or cancellation defects.

## 4. Area routes and checklists

Suggested order: B00 → foundations B01–B04 → shared product B05–B10 → runtimes B11–B12 → external plugins B13–B18 → mobile B19 → documentation B20 → closure B21. Risk-first alternatives include B06 data, B07 cancellation, B14 authority, B15 network revocation and B16 recovery. Missing dependency evidence creates a queued question, not a repository-wide search.

Paths below are repository-relative. Each ID names an area whose sub-batches run separately; a whole area need not fit one conversation. Load target guides and skills when executing the respective sub-batch. Writing this plan does not review those implementations.

### B00 Baseline and scope (repository)

- Read root guidance, relevant indexes/progress, the root manifest and workspace names only. Record `git rev-parse HEAD`, `git status --short`, scoped differences, tool versions and the question. Preserve pre-existing changes.
- Initialize all areas as `unreviewed`, separating documentation declarations, implementation awaiting review and unsupported capabilities. Select one sub-batch; do not start from complete historical diffs or all package sources.
- Deliver baseline identity, queue, allowed paths, standards and verification commands. Subsequent conversations reuse this record and read changes only.

### B01 Pure utilities, audio algorithms and domain (shared)

- Separate `audio-composition` recipes/prefetch or `/browser`, and `core` errors/library/download/player/ports; select one chain in one directory.
- Check the pure audio root has no internal dependencies or runtime pollution; codecs stay in `/browser`; core has no Vue/DOM/GM/Tauri. Avoid duplicate timelines, error catalogs and download schedulers. Check integer milliseconds, invalid bounds, overflow and cancellation.
- Evidence: public exports/dependencies, direct consumers and corresponding `test/`. Small helpers stay with their owning modules and use those modules' tests and typecheck.

### B02 Account selection and routing algorithms (shared)

- Separate `packages/network-routing`, then `packages/account-pool`; hand desktop wiring to B12.
- Check one-way `account-pool → network-routing`, no music models/DOM/Vue/Node/GM/raw credentials, and injected clocks/transport. Cover lease competition, racing requests, timeout, failure health and cancellation cleanup.
- Evidence: selected policy/failure tests. Userscript retains one host account/proxy; desktop composition does not establish shared or GM integration.

### B03 SDK, Schema and native protocol (shared / tauri)

- Separate `packages/plugin-sdk` root/music/schema/guest/host/node; audit `crates/am-plugin-protocol` generated contracts separately.
- Check DTO/wire versions and named ports; no SDK dependency on core/UI/runtimes; generated `/schema` validators; `/node` excluded from production browser graphs; same-source Rust generation; version/Schema field validation and rejection of unknown required capabilities.
- Evidence: public entries, version/budget tests, generated consistency and the same cross-language corpus. Do not hand-edit generated Rust or create a second Schema authority.

### B04 Plugin lifecycle and contributions (shared)

- Separate `packages/plugin-center` generic root, `/music-sources`, dependencies, activation and availability.
- Check generic identity/lifecycle separation from music; catalog descriptors rather than components/business instances; app-injected implementations. Cover missing dependencies, built-in protection, remove/reinstall, stale availability and unsubscribe.
- Evidence: public contracts, one registration→disable chain and race tests. Grant-display caches provide no native authority.

### B05 Shared workbench orchestration (shared)

- Choose one library/music-sources/plugins/settings feature under `packages/music-workbench/src/features`; separate `runtime`, `stores` and `plugin-adapters` wiring.
- Check explicit ports without GM/Tauri/Electron/Node/app imports. Roots compose dependencies, composables own cross-view state/races, UI stays controlled, and workbench never imports tag/creation implementations.
- Evidence: one action→port→state projection, feature tests and direct caller. Hand storage to B06 and media to B07 without expanding them again.

### B06 Data ownership, persistence and recovery (separate runtimes)

- Separate workbench `src/storage`/[data ownership](plugin-data-ownership.md), Userscript GM generations, Tauri renderer/native product mirrors, and plugin-namespace portable data. Inspect one boundary per sub-batch.
- Check host/tag/creation ownership, disablement retaining data while withdrawing projections, current-format startup without old business-key scans/compatibility readers, stage/journal/commit pointers, version/revision, stopping after save failures, and retaining unknown namespaces without execution authority.
- Evidence: writes/import preflight and corruption/interruption/concurrent-write failure injection, with separate runtime recovery tests. Exclude transient URLs/bytes/paths/credentials. Plugin SQLite authority and paired code/data recovery belong to B14/B16.

### B07 Playback, Range, downloads and export (shared; separate runtime wiring)

- Separate workbench `src/media`, features/player, downloads and audio-export; hand off one GM/Rust adapter chain where necessary.
- Check lightweight description → native streaming → bounded Range/MSE → complete-read fallback, bounded leaf prefetch, and seek/switch/disable/dispose aborting old reads. Complete encoding is not ordinary startup preparation. Each production runtime has one download manager.
- Evidence: request count/order/concurrency/cancel/retry, late results, one read per reused asset, failed workers stopping queue claims, and Object URL/grant cleanup. Queue GM/Rust live checks separately; network elapsed time is not acceptance.

### B08 Controlled UI, themes and view assembly (shared)

- Separate one `packages/ui` family and `packages/plugin-ui-vue` root/directory/trusted; queue actual layout acceptance separately.
- Check Composition API, typed props/emits, visible contracts, focus/keyboard semantics and cleanup. UI never depends on plugin infrastructure; theme directories exclude Vue/styles; trusted themes use build-known loaders, recoverable switching and complete teardown.
- Evidence: black-box interactions, theme transaction/retry tests and public dependencies. Component tests do not prove real layout/focus/mobile behavior. Apply `$any-music-ui-delivery` and Vue skills; this task does not authorize UI inspection.

### B09 Tag and creation built-ins (shared)

- Separate `packages/plugin-tag-management` and `packages/plugin-music-creation`, then each app injection point.
- Check lightweight roots, lazy `/vue`, public core/plugin-center/ui contracts only. Plugins own rules/associations or drafts/materials; the host owns published recipes and library writes do not rewrite plugin namespaces.
- Evidence: disable→retain data/withdraw projections→restore tests; standard recipes still execute with creation disabled; disabling a leaf source explicitly fails affected media.

### B10 Source protocols and lazy loading (shared; split source/operation)

- Choose Bilibili or Douyin, then one descriptor/session/search/import-listing/media operation in `packages/plugin-source-*`; hand GM/Rust wiring to B11/B12 separately.
- Check metadata does not eagerly load `/runtime`; source-owned signing/DTO/mapping/pagination with injected HTTP/account/page capabilities; on-demand listings, bounded cursor/dedup state, cancellation/retry and explicit built-in `credentials: 'include'`.
- Evidence: one operation's request count/order/concurrency/cancel/retry. Keep optional Douyin contracts/browser entries separate. Apply `$music-source-adapter`; recapture proves neither GM nor Rust acceptance and does not advance during this audit.

### B11 Userscript runtime (userscript)

- Separate document-start/launcher, Shadow DOM, platform/http, page bridges, storage, single proxy and production graph in `apps/userscript`. Read its guide, [development rules](../../userscript/development.md) and `$any-music-userscript-runtime`.
- Check GM_xmlhttpRequest, timeout/size/abort, target cookies and GM proxy boundaries without host fetch substitution. Bridges allow minimal DTOs; nonces do not authorize same-page code. Expansion loads with retry; hiding preserves sessions, unmount cleans up.
- Evidence: GM doubles/bridge tests, `@grant/@connect/@noframes`, production graph and `externalPlugins: none` at every entry. No source JSON installer or external Worker/WASM/Gate. Real Tampermonkey acceptance remains separate.

### B12 Tauri built-ins, accounts and media (tauri)

- Separate `apps/tauri/src/platform`, native network/request_registry, accounts/vault/proxy, one browser/CDP operation, media grants, system/download and IPC/ACL.
- Check renderer→IPC→Rust HTTP; native CookieStore/credentials/proxies; request-ID cancellation of native reads; public identities without secrets. Douyin browsing returns bounded identity/cursor-matched responses and closes targets; media uses account-bound Rust loopback grants.
- Evidence: identity/stale-request/account-change/revocation/Range/save tests and exact main-WebView permissions, with remote pages lacking IPC. Read app/native guides, [desktop rules](../../desktop/development.md), [backend rules](../../desktop/backend-engineering.md) and `$any-music-tauri-runtime`. CDP success does not establish Rust playback.

### B13 Permissionless VM, Worker and same-engine tests (shared)

- Separate `packages/plugin-vm` Profile/control, engine/bridge, `plugin-sandbox-browser` and `plugin-testkit`.
- Check SDK/fixed-engine-only VM dependencies; engine-free profile/control/adapter roots; no guest live host objects/native functions/business authority; budgets, serialization, Promise bridge, single-use sessions and forced termination. Hosts never import guest entries.
- Evidence: malicious corpus, timeout/memory/cancel, same-engine tests and resource hashes. `pnpm check:plugin:vm` is offline evidence, not WebView isolation or production admission. CLI/testkit stay outside production.

### B14 Native policy, authority and transactions (tauri)

- Separate `crates/am-plugin-policy`, `am-plugin-runtime` ports, app `storage/plugins`, and named commit/revoke operations.
- Check pure crates exclude concrete IO/databases/global clocks and inject Store/Clock/Ids/InstallFiles. Separate schema-3 `plugins.sqlite3` transactions serialize identity/epoch/version/idempotency and values/provenance/receipts. Persist revocation before ACK.
- Evidence: commit/revoke races, canceled waits retaining blocking permits, unknown-schema/damaged-grant refusal, and no production fixture seeds/arbitrary grants/sessions/general relays. Read crate root/target guides.

### B15 Anonymous external networking and revocation (tauri)

- Separate public-target/bounded transport in `crates/am-plugin-net`, and app `plugins/network` Gate, ledgers and final delivery.
- Check each redirect/Range/final sink shares identity/epoch/budgets/revocation barriers. No external account cookies/keys/arbitrary links/host writes. Unsupported proxies reject without account-client fallback.
- Evidence: local tests for private targets, redirects, exhaustion, cancellation and in-flight/final revocation. Anonymous media registration rejects; generic omit reads current loopback grants only. Local TLS success does not activate production packages.

### B16 Packages, installation, upgrades and recovery (tauri)

- Separate `crates/am-plugin-package`, runtime InstallFiles, and app `plugins/package_files`, packages and revocations.
- Check bounded ZIP/resources/integrity/signatures/paths; owned immutable verified bytes without reopening; code/data durability before DB pointers; locks across install/recovery/GC; monotonic rollback epochs and owned-copy migration.
- Evidence: write-step fault injection, paired generations, update/rollback/revoke. Preview grants nothing; self-signing is not publisher trust; unknown roots are not trusted. Add no old-architecture compatibility while retaining current plugin upgrades/rollback/recovery.

### B17 Author tools, public packages and DEV (separate Node / tauri)

- Separate `packages/plugin-cli` build/pack/sign, standalone SDK `/node`/testkit artifacts, and Windows DEV pairing/update/end.
- Check directory source sealing, fixed JSON/Vite, no project hooks/config/.env/host tests, independent public artifacts and licenses, and no production CLI/testkit dependency. Locally packable is not registry-published.
- Evidence: standalone tests, fixed builds and redaction; current-SID single-use pairing; separate DB/code/data/Profile; consent/higher epochs on every reload; close contexts before cancellation ACK; end blocks late installs.

### B18 Desktop external execution and admission (tauri)

- Separate native delivery/control, executor window/relay, production resource filtering and one command/catalog/diagnostic-save operation.
- Check native preview tokens/explicit consent; actual OS/WebView/Profile/resource hashes; all-source filter before guest bytes; independent Worker CSP; bound context/deadline/sequence/cross-realm budgets; epoch recheck on saving.
- Evidence: automated refusal, production graph and exact-target live checks separately. Unknown capabilities/contributions/targets reject; catalogs have no media resolution. S03/offline S11 do not replace S15; old command counts cannot prove ACL correctness.

### B19 Mobile engineering and exits (separate Android/iOS)

- Separate Android runtime_capabilities/ACL, URI/save/Keystore, lifecycle, Bilibili account/proxy/media, signing, minimum devices/channels and iOS adapters. Use the current [S16 matrix](plugin-system-s16-mobile-delivery.md).
- Check API 26/WebView 111+, native obsolete-engine messaging, distinct main-android/main-mobile permissions with external `none` and no install/command/DEV, suspension cleanup and no general JS credential/URI/path bridge.
- Evidence separates offline checks, signed APK/AAB, emulator, physical Debug, optimized Release and channels. Reference Android playback/seek/save/proxy does not prove broader-device/Release/audio interruption acceptance. iOS/minimum devices/mobile external execution/channels keep separate exits.

### B20 Documentation, guides, skills and obsolete paths (repository)

- Review maintained references for inspected areas only; distinguish historical stages/current progress; check locale counterparts/indexes.
- Correct obsolete ownership/status/scope in place without contradictory appendices. Keep AGENTS/skills English, declare runtimeScope, preserve platform-contract documentType/platform/real captureDate and mark archived proposals archived.
- Evidence: scoped checks for old source JSON installers, compatibility packages and duplicate IPC aliases. Keep current upgrades/rollback/recovery; a legacy filename alone is no deletion reason. Tests/fixtures/generated artifacts/exports follow ownership.

### B21 Aggregation, regression and final status (repository)

- Read reports and necessary final differences, not all source again. Check coverage/dependencies/failures/unknowns/freshness/exact runtimes. Fill gaps with minimal batches.
- Run section 6 gates. Assign failures, rerun affected tests/invalidated gates after fixes, and never treat a missing result as passed because of budget pressure.
- Deliver verified conformance, confirmed fixes, unreviewed scope, implementation lacking live acceptance and unsupported-by-design scope. Close only the agreed scope with required evidence. Preserve incomplete S16/channel exits instead of declaring whole-project acceptance.

## 5. Fixed procedure per sub-batch

1. **Frame:** ID, runtime, one invariant, allowed paths/exclusions, 3–5 criteria and expected evidence. Separate runtime reports.
2. **Read constraints:** root/nearest target guides, necessary skills and relevant standards. Native work adds crate/app native guides/backend rules; unrelated guides stay unloaded.
3. **Locate:** manifest/exports, entry, direct caller and tests; initially 6–10 files. Record inspected files/lines.
4. **Trace:** entry→owner→injected port→adapter→return/commit→cancel/release. Check success/failure/cancel/recovery separately; uninspected paths remain unknown.
5. **Verify:** smallest meaningful tests; expand to direct consumers for interface/dependency changes. Check exit codes and retain causes. Add tests only for substantive uncovered risks, not implementation mirrors.
6. **Assess/handoff:** evidence per criterion, gaps/risks/owners, three status fields, short handoff, then stop expanding. Confirmed issues need triggers/effects, not unsupported global claims.

## 6. Layered verification commands

Run from the repository root and check current `package.json` first. Replace `<...>` placeholders before execution. Prefer owner test scripts; satisfy build/generation preconditions before selecting a Vitest file directly.

```powershell
# One TS / shared Vue package
pnpm --filter @any-music/core test
pnpm --filter @any-music/core typecheck
# One file/directory, retaining required build/generation preconditions
pnpm --filter @any-music/<package> exec vitest run <test-path>
# Tauri frontend without the test script's Cargo workspace expansion
pnpm --filter @any-music/tauri exec vitest run <test-path>
# One crate / named native module
cargo test -p am-plugin-policy --locked
cargo test -p any-music-tauri --lib <module-filter> --locked
```

Select gates by area, without repeating all per sub-batch:

| Area           | Offline checks/builds                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01–B12 wiring | Target tests/typecheck; after public-entry changes, `pnpm build:userscript` and `pnpm build:tauri`; final lint checks repository dependencies/production graphs |
| B03 protocol   | `pnpm check:protocol:generated`, `pnpm check:protocol`                                                                                                          |
| B13 VM         | `pnpm check:plugin:vm`                                                                                                                                          |
| B14–B16 native | Target crate/module tests; `pnpm check:plugin:package` for packages/recovery; required toolchains                                                               |
| B17 tools      | `pnpm check:plugin:tools` plus targeted CLI/testkit tests                                                                                                       |
| B19 mobile     | `pnpm check:mobile:boundaries`; `pnpm check:mobile:android` with Android tools; `pnpm check:mobile:release` after corresponding artifacts exist                 |
| B20 docs       | Changed-file formatting, metadata, counterparts and local links                                                                                                 |

At final closure and before any commit, complete `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` and `pnpm build`. Native changes also require `pnpm check:native`, `pnpm check:rust:msrv` and `pnpm check:rust:deny`. Preserve explicit release target/features, never all-features. Missing systems/toolchains are blockers. Reuse valid same-baseline results when no change/invalidation requires rerunning.

This plan and static auditing do not authorize servers/previews/apps/browsers/emulators/screenshots/clicks/live regression. Run live checks only after explicit user browser/application-inspection requests in the respective task and scope. `accept:*` is not an ordinary offline gate. Do not automatically recapture, commit, push or publish.

## 7. Reports, continuation and completion

Create `docs/baselines/refactoring-audit/<run-id>/summary.json` and per-sub-batch `<batch-id>.json` only when actual auditing starts, using stable fields/enums. Keep raw logs local and redact secrets. This task creates the plan, not fictional pass records. Minimum fields:

```text
batchId / runtime / scope / criteria
baseline: HEAD + relevant working-tree changes or file hashes + environment
declaredStatus: document claim and reference
refactorStatus / verdict
checks: criterion, pass|fail|unknown|not-applicable, file:line, test evidence
verification: static/tests/artifact/live, result, exact command, exit code, time, log path
findings: trigger, effect, severity, owner, evidence, suggested next action
unreadPaths / missingEvidence / dependencies / nextBatch
```

Short handoff:

```text
Batch / runtime / baseline:
Question and allowed scope:
Inspected files and evidence locations:
Per-criterion results and confirmed issues:
Commands, exit codes, evidence categories and omitted-check reasons:
Refactoring status / verdict:
Unread paths, cross-area questions and one next-batch entry:
```

Before reuse, check relevant files/contracts/dependencies/Schema/Profile/resource hashes/toolchains/environments. Unchanged HEAD does not imply unchanged dirty files; unrelated changes need not invalidate every result. Return affected checks to pending, retaining previous records as history.

New-conversation prompt; replace placeholders:

```text
Follow the Refactoring Audit Plan for <batchId> only, runtime=<shared/userscript/tauri>.
Question: <one invariant>; allowed paths: <one primary directory and direct neighbors>.
Read root/target AGENTS.md, plan sections 2/3/5 and this area entry, then necessary skills.
Reuse <previous handoff/report path> after checking baseline changes. Do not scan other
areas or load complete history. Audit and record only; do not change product code.
Run the smallest meaningful tests. Queue cross-boundary questions separately.
Report refactoring status, static/tests/artifact/live evidence and verdict, with unknowns.
At the reading limit or a second independent chain, save a handoff and stop expanding.
Do not launch products/browsers/emulators or commit/push. Name one next sub-batch only.
```

A sub-batch completes when criteria have individual conclusions, necessary tests ran or gaps are explained, confirmed issues have owners, unread scope is visible and continuation needs no reread. An area completes when planned sub-batches/dependencies close. Overall completion follows agreed scope, valid evidence and an explicit gap list, not reading every file or passing one full test run.
