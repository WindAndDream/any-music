---
documentType: architecture
runtimeScope: repository
---

# Any Music system architecture

[中文](../../zh-cn/系统架构/文档索引.md)

Any Music resolves music from stable source identities. It plays ordinary tracks and segment recipes through the same library, player and download workflows. The applications assemble these workflows with runtime-specific services and the Classic interface.

| Layer                   | Responsibilities                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applications            | `apps/userscript` injects GM transport, storage and host-page integration. `apps/tauri` injects IPC, native storage, account/proxy context, media and OS capabilities. |
| Shared workbench        | `packages/music-workbench` owns player, library, downloads, contribution lifecycles and runtime composition ports. A theme switch keeps those controllers alive.       |
| Presentation            | `packages/ui` owns controlled Vue UI and interaction primitives. `theme-default` assembles the complete Classic interface.                                             |
| Domain and providers    | `packages/core` owns stable models, errors and ports. Source packages map upstream responses. `audio-composition` compiles and schedules custom recipes.               |
| Native plugin authority | On Tauri, Rust owns verified package state, grants, credentials and bounded delivery. Plugin SDK, VM and adapters expose versioned, limited contracts.                 |

The applications depend on shared packages. Trusted adapters inject transport, data access and permissions into shared behavior. UI emits intents to the workbench. Product data persists stable identities and recipes, while credentials, transient media and runtime caches stay in their owning runtime.

| For more detail                                      | Read                                        |
| ---------------------------------------------------- | ------------------------------------------- |
| Public exports, ownership and dependencies           | [Package boundaries](package-boundaries.md) |
| Runtime entry points, data flow or feature contracts | [Module index](../modules/README.md)        |
| What is changing and what passed acceptance          | [Documentation index](../README.md)         |
