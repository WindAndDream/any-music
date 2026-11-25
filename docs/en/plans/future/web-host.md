---
documentType: future-plan
runtimeScope: repository
status: proposed
---

# Headless host and Web entry

[中文](../../../zh-cn/计划/未来/Web宿主.md)

**Proposed.** Build on [local-user isolation](local-users.md) and existing named workbench operations. Keep Tauri, WebView, system vault, native media and bundled source transports in adapters. Extract proven asynchronous host use cases before exposing a separate browser entry.

| Scope                               | Next design and exit                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01–F03, J04 · host API and browser | Extract Tauri-free operations. Authenticate remote subjects server-side and map to trusted actors/scope per request. Reject caller-supplied local IDs as authority. Implement a Web entry with explicit browser limitations and independently deployable host services. |
| H01–H06 · jobs, caching and assets  | Introduce bounded leases/retry/Outbox only for real restart needs. Measure a local cache before adding a sidecar. Shared cache or remote assets follow demonstrated load, invalidation and degraded-mode behavior.                                                      |
| I01–I03 · scaling and isolation     | Validate migrations/recovery, tenant ownership and worker fencing. Add partitioning, pooled connections, RLS or multiple workers only when the chosen storage/service needs them.                                                                                       |
| J01–J03 · runtime acceptance        | Verify desktop artifacts and Android/iOS release gates separately from the Web deploy. Source credentials and native execution remain runtime-scoped.                                                                                                                   |

Support standalone offline, private self-hosted and public service deployment through configuration. A standalone runtime needs no HTTP listener or cache sidecar. Optional service business stays in [its own layer](optional-services.md).
