---
documentType: architecture
runtimeScope: repository
---

# Plugin Implementation Status

Chinese counterpart: [插件实施状态](../../../zh-cn/跨平台/架构/插件系统重构实施步骤.md). Current implementation is the only product baseline; the unreleased product carries no earlier architecture compatibility layers.

| Area             | Current implementation                                                                                                                       | Reference                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Shared ownership | Required host modules and optional built-in tag/creation/source modules, lifecycle and bounded contributions                                 | [Package boundaries](reusable-package-boundaries.md)          |
| Sources          | Independent Bilibili/Douyin packages, injected GM/Rust ports, cancellable listings and media lifetimes                                       | [Source architecture](music-source-plugin-architecture.md)    |
| Data             | Current host/namespace partitions, generation commits, current-schema portable-data APIs                                                     | [Data ownership](plugin-data-ownership.md)                    |
| Runtime policy   | Userscript built-ins; native capability-driven desktop/mobile composition; `.amplugin` only                                                  | [Runtime policy](plugin-runtime-policy.md)                    |
| VM               | Fixed QuickJS/Profile, permissionless execution, trusted Worker and same-VM testkit                                                          | [Execution](plugin-execution.md)                              |
| Native authority | Install/grant/context/provenance and serialized commit/revoke                                                                                | [Authority](native-plugin-authority.md)                       |
| Networking       | Anonymous native Gate, public targets, cumulative budgets and revocation barriers                                                            | [Networking](plugin-networking.md)                            |
| Packages         | Bounded verification/signatures, immutable bytes and paired code/data recovery                                                               | [Packages](plugin-packages.md)                                |
| Desktop delivery | CLI/testkit, native consent, commands/catalogs and isolated DEV on exact accepted targets                                                    | [S15 matrix](plugin-system-s15-tools-and-desktop-delivery.md) |
| Mobile           | S16 in progress; Android document/Keystore/save, Bilibili account/proxy/media adapters and signed artifacts; external execution remains none | [S16](plugin-system-s16-mobile-delivery.md)                   |

`feature.composer` now owns both Custom Music and Segment Creation navigation/views/open commands. Its switch withdraws or restores both sections together; published assets and their ordinary host playback/download remain independent. See [data ownership](plugin-data-ownership.md).

## Remaining delivery work

Declarative desktop source gateways now implement versioned QR, credential and SMS authentication, explicit no-login policy, native token ownership and account-bound pagination. Built-in account admission requires login and Profile deletion uses background tombstone collection. These changes have offline tests; live gateways and renewed exact-target admission remain separate. See [Music Source Authentication](../../desktop/source-authentication.md).

### Independent theme acceptance

Both production runtimes use complete Classic/Studio themes above stable business, media, download and editor owners. [Theme development](independent-theme-development.md) owns implementation contracts; [T13 acceptance](independent-theme-ui-migration-plan.md#current-acceptance-and-next-work--2026-11-01) owns per-build evidence and remaining GM, physical-input, native-dialog and mobile cases. Historical passes do not accept the current working tree.

### Other delivery work

External catalogs currently have no media resolution. Registry publication and OS installer/channel acceptance remain separate work. Android Bilibili account/proxy/foreground media adapters exist; signed optimized reference-device builds have native proxy, saving and partial [playback/audio-interruption acceptance](../../desktop/android-audio-acceptance.md). Broader media/proxy/device and real-call/headset/measured-ducking acceptance, minimum-device/execution/channel exits and iOS account/media acceptance remain pending. Android requires API 26 and WebView 111+; existing emulator/reference-device evidence does not admit mobile external execution.

The [design](plugin-extension-contracts.md) describes complete target boundaries, including unsupported extensions. Exact capability/target matrices determine shipped behavior. Preserve current data/authority transactions and runtime transport isolation when implementing remaining features.

### Local users, independent services and Web proposal

The [local/cloud plan](multi-user-local-cloud-plan.md) tracks A01–J04; none has started. It separates host-owned local users/isolation/verified bindings from optional account-provider, sync, sharing and report plugins/services, while preserving backend/Web extraction. Current profile display-name settings are not local-user switching. These are follow-up contracts, not S15/S16 delivery claims; no present secret/private-network/cross-plugin authority is implied.

## Verification

Run targeted tests and the five root checks. Native changes also run native/MSRV/deny checks. Use failure injection for current-generation writes, package install/update/rollback and revocation; source/playback changes cover request count/order/concurrency/cancellation/retry. Live product/browser/device work requires explicit authorization. Report test, artifact and live-runtime evidence separately; do not copy historical test counts into current acceptance claims.
