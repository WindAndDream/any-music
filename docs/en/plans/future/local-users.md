---
documentType: future-plan
runtimeScope: repository
status: proposed
---

# Local users and verified account bindings

[中文](../../../zh-cn/计划/未来/本地多用户.md)

**Proposed.** The library currently has one local profile and Tauri's music-source accounts have their own native credentials. The first batch is A01, an inventory of host/plugin/service ownership and switch/deletion lifetimes.

- Keep stable LocalUser IDs, display names, create/select/delete, private libraries, settings and leases in the host. Selection changes the current actor only after old source/playback/download/plugin sessions are stopped and pending writes finish or cancel. Data, caches, native grants, queues and portable imports stay scoped to their owner.
- Separate the local ID, provider/instance, external subject and music-source account. Allow multiple verified bindings per user, with explicit per-operation account selection. Native proof validates instance/audience, one-time challenge and source of the callback before a binding commit. User-supplied names and portable author IDs only provide attribution.
- Keep credential storage/revocation in trusted runtime ports. Provider registration, sign-in, MFA and recovery belong to [optional services](optional-services.md). Local data stays usable offline.
- Prefer an incrementally adopted authoritative data port with current-schema preflight, versioned migrations, backups/recoverable failure and checked ownership. Keep one writer while adding asynchronous use cases. Preserve current storage until there is measured justification for a replacement.

| Work                                                                   | Relevant batches |
| ---------------------------------------------------------------------- | ---------------- |
| Ownership, identity, contracts and persistence choice                  | A01–A04          |
| Scoped startup, migration runner and verified restore                  | B01–B03          |
| Local create/select/switch/delete and controlled UI                    | C01, C05b, C07   |
| Provider/instance proof, account selection and revocation              | C02–C05a, C06    |
| Authoritative library writes, order, favorites, metadata and migration | D01–D07          |

Start with local switching/isolation. Agree requirements and validate cross-user rejection, stale writes, recovery and cancellation before migrating real data. Web actor binding can reuse these boundaries. [Web host](web-host.md).
