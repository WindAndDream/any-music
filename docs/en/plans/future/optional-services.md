---
documentType: future-plan
runtimeScope: repository
status: proposed
---

# Optional account, sync, sharing and report services

[中文](../../../zh-cn/计划/未来/可选云服务.md)

**Proposed.** Each optional plugin and service has its own lifecycle, namespace, configuration and user consent. Local library use follows [the local-user plan](local-users.md) independently. Give one use case a named versioned port before expanding access.

| Extension                     | Ownership and acceptance                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account providers (C02–C06)   | Registration, password/MFA/mail/recovery and remote sessions stay in the provider. Host verifies binding proof and assigns operation rights. Two instances of one provider remain distinct.                                                                         |
| Listening reports (E01–E03)   | The host optionally records minimal user-consented playback facts with seek/pause/interruption and deduplication semantics. Report plugins aggregate bounded scoped reads, with separate consent for egress and clear retention/deletion.                           |
| Sharing (F04)                 | Use a fixed portable music document with verified recipients, expiry/revocation, scoped preview and idempotent import. Stable attribution conveys no access.                                                                                                        |
| Sync (G01–G07)                | Host owns export/integrity/import and transactional receipts. A selected coordinator per user/scope owns pull cursor, offline intents, instance generation, tombstones, conflict recovery and no-loop handover. Keep unknown namespaces without granting execution. |
| Backups and storage (H05–H06) | Host owns asset identity and local recovery. An optional service owns quota, remote retention, scoped transfer and verified restore.                                                                                                                                |

Choose a single provider or use case first. Establish the shape, budget, grant, revocation and failure behavior with the current local implementation. Private networks, external SecretRef, cross-plugin services and remote egress require separate contracts and admission.
