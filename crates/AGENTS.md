# Native plugin protocol and policy

- Follow the root guide and the [Rust backend rules](../docs/en/desktop/backend-engineering.md). These are native, framework independent libraries with no Tauri, accounts or credentials. Protocol/policy/runtime have no concrete IO/global clock; package validates owned bytes; net owns anonymous HTTP/TLS. Apply each crate's local guide and dependency closure separately.
- `am-plugin-protocol` consumes the SDK's versioned Schema/registry and raw corpus. Regenerate serde DTOs and field checks with `pnpm generate:protocol`; never edit generated Rust or create another Schema authority.
- `am-plugin-policy -> am-plugin-protocol`; all time, subject, scope, grant and usage snapshots come from trusted callers. Runtime and the application consume decisions as native values, never renderer bearer grants; no framework or IPC dependency belongs in policy.
- Inherit workspace edition/MSRV/lints, use private modules and explicit public contracts. Keep tests in each crate's `tests/` and use SDK-owned protocol fixtures by their actual path.
- Run target tests first, then root checks and `pnpm check:native`. The metadata check must prove the pure crates' complete dependency closure and release feature matrix. No UI/browser launch without explicit user instruction.

- am-plugin-runtime -> protocol/policy/serde/serde_json, with injected Store/Clock/Ids/InstallFiles and no concrete IO/clock/DB/HTTP dependencies. Transactions serialize provenance/receipts with revocation. Application SQLite, native caller checks and approval stay in apps/tauri; fixture seeding remains test-only.

- The IO-only am-plugin-net crate has no runtime, Tauri, accounts, vault or SQLite. Keep pure dependency closure checks separate from its HTTP/TLS closure. Native Gate supplies authority; unsupported proxy/cookie/credential exits fail closed. Local TLS tests never enable production package activation.

- am-plugin-package -> protocol/ZIP/SHA-256/Ed25519/Unicode, with bounded owned reads and no filesystem/network/authority or execution. Keep its dependency closure separate from pure runtime. Runtime's InstallFiles port orders journals/paired generations; the app owns durability, paths, process locks and schema 3. Loading consumes returned verified bytes, never a reopened path. SDK-owned package corpus and public signature vectors are shared with Node tooling; CLI/distribution remains separate.
