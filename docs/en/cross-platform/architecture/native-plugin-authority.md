---
documentType: architecture
runtimeScope: tauri
---

# Native Plugin Authority

Chinese counterpart: [插件原生权威](../../../zh-cn/跨平台/架构/插件原生权威.md). Native authority is composed by the application; [desktop delivery](plugin-system-s15-tools-and-desktop-delivery.md) determines admitted capabilities and targets.

## Persistence and identity

`am-plugin-runtime` owns installation/grant/context/provenance and commit/revoke state machines through `Store`, `Clock`, `Ids` and `InstallFiles`. It owns no SQLite, Tauri, HTTP, accounts or concrete filesystem IO. The application injects independent `plugins.sqlite3` schema 3, separate from product snapshots and credentials. Unknown database schemas or damaged authority deny plugin operations while preserving files and core product views; product backups never import authority ledgers.

Native callers cannot be deserialized from guest messages. Sessions bind the actual channel/document/account scope, installId, pluginId, content hash, publisher, package/data generations, permissionEpoch and expiry. Only verified native installation and explicit consent create product authority; fixture seeds, arbitrary grant/session creation and general data-relay IPC are unavailable.

Each read/prepare/commit reloads identity and authority. `BEGIN IMMEDIATE` transactions with `synchronous=FULL` atomically persist values, provenance and idempotency receipts and acknowledge only after COMMIT. A single-concurrency blocking pool retains a running job's permit after the waiting future is cancelled.

## Contexts, commits and revocation

The host publishes selected copies and issues task-bound contexts with allowed fields, object versions and expiry. Selected Title, Artist and Note fields do not expose arbitrary IDs, repositories or credentials. Selection changes, completion and cancellation close contexts/reservations. Reads and writes recheck identity, epoch, account, expectedVersion and operationId. An identical retry returns its receipt; changed payloads or another channel cannot replay it.

Own-namespace state and non-destructive display-title annotations use native versioned commits. Annotations preserve source titles, recipes and product snapshots. The workbench consumes committed native results rather than performing a second repository write after revocation. There are no generic favorites/playlist/deletion write APIs.

Revocation increments the epoch, removes grants and closes sessions/contexts/pending tasks in one serialized transaction. Persist it before cancelling native resources and acknowledging. If revocation commits first, old reservations and late replies cannot write; an earlier committed value remains. Rollback never restores old epochs or grants; already delivered bytes cannot be recalled. Restart advances epochs and clears ephemeral handles/reservations while retaining data, history and committed receipts.

## Provenance and budgets

Deliveries, namespaces and annotations retain installation/context/data-level/package-generation provenance. Outputs inherit the highest selected-input, retained-namespace and historical-delivery level, including publisher/plugin lineage. Missing history is L2, notes are at least L2, and secrets are never delivered. Encoding a private note as a display title cannot downgrade it for another plugin. This tracks observable host API flows rather than arbitrary JavaScript information flow.

Limits: 128 installations, 16 native sessions, 100 objects/context, 16 pending writes/session, 16 KiB text values, 1 MiB namespaces, 4,096 rows/ledger table and 16 MiB logical DB payload plus a SQLite page limit. Sessions/contexts last at most five minutes and never outlive grants. Exhaustion rejects new work without deleting user data.

Host-controlled authority UI displays native snapshots and emits refresh/revoke intents; revocation waits for native confirmation. It never derives or persists renderer grants. Test guessed IDs, cross-plugin/account/channel calls, expiry, selection/version races, restart, atomic rollback, idempotency and A→host→B provenance. Network combinations follow [plugin networking](plugin-networking.md); installation follows [plugin packages](plugin-packages.md).
