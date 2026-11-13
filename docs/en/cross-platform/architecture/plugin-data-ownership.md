---
documentType: architecture
runtimeScope: shared
---

# Product and Plugin Data Ownership

Chinese counterpart: [产品与插件数据归属](../../../zh-cn/跨平台/架构/插件数据归属.md).

The unreleased product reads and writes the current architecture directly. It does not import previous product layouts, source JSON manifests or repository schema versions.

| Data                                                       | Owner                        | Behavior when an optional plugin is disabled          |
| ---------------------------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| Tracks, favorites, playlists, queue and histories          | Host core                    | Remain available                                      |
| Published recipes and creator credits                      | Host core                    | Compile and play independently of the creation editor |
| User tags and associations                                 | `feature.tags` namespace     | Retain data; withdraw editing/filter projections      |
| Materials, pending tracks, drafts and editing associations | `feature.composer` namespace | Retain data; stop editor sessions                     |
| Workspace, navigation, theme and recovery settings         | Host                         | Persist separately from business assets               |
| Installation, grants, provenance and revocation            | Native plugin authority      | Never restore through ordinary product backups        |

## Current product storage

The optional `feature.composer` plugin owns both Custom Music (`custom-tracks`) and Segment Creation (`composer`) navigation, views and open commands. Disabling it withdraws both sections together and leaves the current section for Discover. Re-enabling restores both with their saved navigation preferences, works, materials and drafts. Published assets stay in host core, so works already in Favorites, playlists or Listen Later retain ordinary playback and download without the editor.

Both applications create generation storage before configuring the workbench. The only partitions are `core`, `host` and `namespaces`. Repository keys such as `local-library:v1` are named storage ports into these partitions; they are not separate persisted copies. No startup scan of prior business keys or automatic conversion is performed.

The library accepts its current schema 6 and downloads accept schema 2. The runtime library view recompiles published recipes and supplies empty host tag/collection associations; plugins read their own namespaces through named ports. Ordinary library writes cannot modify plugin data. Library and download track metadata retain HTTP(S) or protocol-relative artwork/page URLs, excluding Blob/data/file URLs and embedded credentials. Filter-history tag conditions use their namespace writer; unknown namespace schemas remain bounded opaque data and cannot be overwritten by a writer that cannot interpret them.

Immutable generation chunks use canonical checksums, a schema-2 manifest and one commit pointer. The runtime supplies `ProductGenerationBackend.withExclusiveWrite`: initial reads and each complete synchronous commit run under exclusive ownership of the durable store. The guard covers the stale-revision check, reclamation, staging, verification and pointer publication; separate reads and writes cannot emulate atomic comparison. Staging verifies the whole candidate before publication. A failed write poisons the active writer until restart, including subsequent proxy-setting writes; a stale tab cannot overwrite a newer generation. Reclamation preserves the live generation. This recovery protocol protects current writes and does not provide old-layout migration.

Userscript uses only `any-music:userscript:*` GM storage and a separate runtime proxy key. Before reading product data, it registers a unique owner with `GM.saveTab` and checks `GM.getTabs`; a second expanded workbench is rejected. Ownership lasts through hidden playback/download sessions until actual disposal or page exit. Startup hydrates the current generation through asynchronous GM reads; ordered, acknowledged GM writes stop at the first failure. Disposal freezes writes immediately, drains queued persistence and then removes only its own registration. Closed tabs disappear from the manager inventory; suspended owners never expire by time. Tauri guards renderer commits against reentry and changes to the persisted mirror; native saves still serialize revision checks and atomic replacement. It mirrors current schema-2 envelopes between the renderer and `product.json`; committed generation and revision select the complete snapshot. Unsupported formats are rejected. Account credentials, CookieStores and proxy secrets stay outside product data.

After validating a complete Tauri mirror, startup reclaims unreachable generation chunks left by interrupted staging before persisting the mirror. The committed generation, its immediate predecessor and unrelated keys are retained; damaged or unsupported candidates are never rewritten by reclamation. This prevents abandoned chunks from exhausting WebView storage and blocking download history or the last selected source. Native JSON decoding preserves exact JavaScript floating-point values through IPC and disk so fractional playback history does not invalidate canonical checksums. Source selection restores from the committed workspace; each platform's selected account restores independently and displays its current native account state.

## Portable business data

Future local users and bindings follow the [local/cloud plan](multi-user-local-cloud-plan.md), not the current single-profile storage model. The host will own local identity/library scope and verified bindings; account providers and sync/sharing/report plugins own their specialized state/services. Namespace access must also be scoped to local user/library and, where needed, binding/instance. Ordinary data exports must exclude binding proofs and session secrets even inside plugin namespaces; imported author IDs cannot establish ownership. These are planned constraints, not implemented multi-user/sync support.

`exportPortableProductData` and `previewPortableProductImport` carry stable core records and plugin ID/schema namespaces. Preflight rejects duplicate IDs, dangling recipes, unknown core schemas, excess bytes/depth and conflicting backup identities. Namespace contents remain opaque. Import commits once and requires a full workbench reload before further writes.

Exports exclude credentials, grants, installation metadata, proxy secrets, media URLs/bytes, handles and disk paths. Restoring data never registers or enables a plugin. Native package upgrades and rollback still pair verified code/data generations and preserve monotonic epochs and revocation; those current transactions are independent of product storage.

See [package boundaries](reusable-package-boundaries.md), [runtime policy](plugin-runtime-policy.md) and [native package delivery](plugin-system-s15-tools-and-desktop-delivery.md).
