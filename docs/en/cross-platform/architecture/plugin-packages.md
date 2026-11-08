---
documentType: architecture
runtimeScope: tauri
---

# Plugin Packages and Recovery

Chinese counterpart: [插件包与恢复](../../../zh-cn/跨平台/架构/插件包与恢复.md). This guide owns package verification and installation/recovery ordering. [Desktop delivery](plugin-system-s15-tools-and-desktop-delivery.md) owns native consent and target admission.

## Packages and signatures

- [am-plugin-package](../../../../crates/am-plugin-package/src/lib.rs) consumes owned bounded bytes and validates containers, resources, manifests, integrity and signatures. It has no networking, extraction into user paths, authorization or execution. Runtime does not depend on package/ZIP/HTTP; the application composes them.
- SDK Schema defines integrity entry/directory, signature and revocation DTOs to the existing TS/Rust generation chain. Raw JSON still passes duplicate-key, Unicode, safe-integer, depth and node-count checks.
- The v1 ZIP profile permits STORE/DEFLATE only, rejecting encryption, split/ZIP64 archives, directory entries, extras/comments, data descriptors, prefixes/trailers and inconsistent local/central headers. Counts are checked before archive allocation; actual output is metered in chunks. Limits remain 16 MiB archive, 64 MiB total output, 8 MiB per file, 1,024 entries, depth 8, 240-byte paths and 100:1 compression. JSON retains the 256 KiB protocol limit.
- Paths reject traversal, UNC/drives/ADS, devices, links, executable modes and case/NFKC collisions; input must be NFC. Only fixed metadata/entry/local map, bounded PNG/JPEG/WebP, JSON, license text and SBOM are permitted. Resources never become host URLs. External WASM/native/HTML/SVG/fonts and remote sourcemaps/sourceRoot are refused.
- Integrity covers the exact payload set, including manifest and excluding integrity/signature files. Ed25519 signs `AnyMusic.amplugin.integrity.v1\0` plus the **original integrity bytes**; revocations use `AnyMusic.amplugin.revocations.v1\0`. Fingerprints are SHA-256 of the 32-byte public key. Rust uses dalek verify_strict; Node standard crypto additionally rejects weak-point encodings. A self-signature proves possession, not a verified publisher.
- The [shared corpus](../../../../packages/plugin-sdk/test/fixtures/packages/corpus.json) has explicit positive cases and malicious packages; Node/Rust compare rejection categories. Fixed public Node→Rust vectors and ephemeral Rust→Node signatures are checked. Generators never save private material. `pnpm check:plugin:package` is an offline package check.

## Installation authority and recovery

[Runtime orchestration](../../../../crates/am-plugin-runtime/src/install.rs) uses Store/Clock/Ids/InstallFiles ports. The [application adapter](../../../../apps/tauri/src-tauri/src/plugins/package_files.rs) owns private content-addressed files, process locks and cooperative cancellation. Guest paths never become filesystem destinations. Stored files/staging have a 256 MiB quota; exhaustion stops installation without deleting active data.

1. All inputs become bounded immutable snapshots before validation and preview. Previews bind the candidate hash, previous identity/epoch, revocation sequence, historical data level and expiry; renderer authorization claims are not deserialized.
2. SQLite initializes schema 3 with packages, install_journal and a mandatory revocations authority row. Previous database schemas are rejected; the unreleased product has no old-schema reader. Missing revocation state, unknown schemas or corrupt authority fail closed while preserving the database.
3. Prepare records the old pair and a copy of the plugin's own namespace, suspends the old instance, increases epoch and invalidates sessions/contexts/exits. Migration supports copy and a named host Rename operation. Unknown upgrades beyond data schema 1 are refused; no external JS, networking or host business writes run during migration.
4. Old data and candidate code/data become durable before one DB transaction changes committed pointers, namespace, effective rights and epoch. Publication uses create-new, file sync and immutable content addresses; Windows uses write-through moves and other systems sync parent directories. Precommit failure restores the whole old pair; startup consumes committed records only.
5. Every package session revalidates code/data, identity and epoch; test fixture APIs cannot bypass this in production. A failed committed load may restore a safe non-revoked old pair, disabled with grants removed. Without a safe version, disable and preserve data. Manual rollback never restores grants, sessions or old epochs.
6. Uninstall retains namespaces. Separate erasure removes namespace/rollback references while preserving security history and revocations. GC deletes only files unreferenced by active/rollback/journal/current preview roots. Portable backup APIs do not export authority ledgers.

Unsigned packages require consent per content hash; changed content at the same version does not silently inherit rights. Publisher replacement/unverified reinstalls require explicit data-transfer consent. Pinned publisher version upgrades inherit only unchanged, currently effective grants. Added/revoked rights and increased historical levels require review. Secrets are never delivered. L2/network combinations require a declared private-egress capability and separate highest-risk consent; unsupported declarations fail preview.

Application-root-verified revocation lists persist monotonic sequence/issuedAt/expiry and the union of known revocations. Offline operation or disabled refresh cannot forget revocations. Multiple provisioned roots support distribution-key rotation. Production has no provisioned distribution root/source and never trusts package-provided keys to revoke others; Distribution refresh uses native entry points. The application persists revocation before cancelling affected network tasks.

## Preview and compatibility

The controlled host preview shows identity/fingerprint, content hash, execution type, permission differences and history. Selection and closing only stage/release immutable snapshots; they create no grants. Native delivery consumes a fresh bound preview after explicit consent and rechecks identity, revocation, epoch, expiry and target admission. Executors receive no preview/install IPC or renderer authorization claims.

Only `.amplugin` package snapshots enter native previews. Previous source JSON formats are unsupported; Userscript has no external installation surface.

## Verification boundary

`pnpm check:plugin:package` checks the shared malicious-package corpus and native package tests. Cover bidirectional signatures, signed revocation/replay, directory/pointer/SQLite fault cuts, locks, cancellation, quotas, restart, paired migration/rollback, per-load tampering, publisher continuity and garbage collection. Fault injection does not prove physical power-loss, installer registration or device acceptance.
