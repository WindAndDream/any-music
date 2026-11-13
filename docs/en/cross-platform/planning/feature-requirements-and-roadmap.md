---
documentType: product-planning
runtimeScope: shared
---

# Any Music Feature Requirements and Roadmap

Chinese counterpart: [功能需求与路线图](../../../zh-cn/跨平台/产品规划/功能需求与路线图.md).

## 1. Product Boundary

Any Music is not limited to traditional music services. Any content with stable identity and on-demand audio resolution may become music, including videos, multipart sections, platform audio uploads, and virtual tracks assembled from user-selected segments.

The UI is a replaceable shell. Source plugins own discovery, import, details, and media resolution. Components consume unified models and never understand Bilibili/Douyin DTOs, WBI or `a_bogus`, cookies, or ephemeral CDN addresses.

Future account systems, cloud synchronization, sharing/social and advanced reports are optional plugins with independent services. The host retains local users, isolation, verified bindings, canonical music data and controlled capabilities. One local user may bind multiple accounts across providers/instances; no cloud login is required for local music. This direction is unimplemented; see the [local-user and service plan](../architecture/multi-user-local-cloud-plan.md).

## Current product references

Implemented behavior belongs to [source architecture](../architecture/music-source-plugin-architecture.md), [library/playback/download contracts](../features/local-library-and-custom-plugins.md), [UI interactions](../features/cross-platform-ui-and-interaction.md) and [runtime indexes](../../README.md). Source inventories and completed implementation milestones are not a separate roadmap.

## 4. Next Feature Layers

### P0: Remaining release acceptance and performance

- Close the per-runtime/input/device cases in [theme acceptance](../architecture/independent-theme-ui-migration-plan.md), including host-page, physical-input and native-dialog scope.
- Complete [virtual-list implementation and acceptance](../architecture/virtual-list-implementation-plan.md); retain drag continuity and keyboard/reduced-motion alternatives.
- Measure launcher/first-expansion paths, production `.user.js` size and heavy async modules. Mobile pruning uses real entries/dependency graphs rather than CSS hiding.
- Download pause/resume is implemented. Download prioritization, richer timeline editing and plugin batch checks remain follow-up enhancements; define their domain/persistence contracts before exposing them as working controls.

### P1: Library Management and Settings

- Configure track activation as play, play-and-open-source, or open-source only.
- Add bounded library summaries; tag statistics belong to the tag plugin, while advanced listening reports belong to an optional report plugin consuming consented playback facts. Private-data uploads need separate authorization.
- Configure preload thresholds, page-size requests, retry policy, and navigation per source.
- Add user-triggered export, import, and recoverable cleanup for the library, workspace, and permanent download history.

### P1: Unified plugins and runtime-specific release

Current capability and admission limits belong to [desktop delivery](../architecture/plugin-system-s15-tools-and-desktop-delivery.md) and [mobile delivery](../architecture/plugin-system-s16-mobile-delivery.md).

- Renew exact-target desktop admission after Profile/resource changes and perform live declarative-gateway acceptance.
- Finish Android's remaining optimized-release, minimum-device, audio/proxy and channel exits, and iOS native adapters/device acceptance. Existing Android adapters and signed artifacts do not admit mobile external execution.
- Additional external extensions/media, marketplace/automatic updates, distribution roots, SecretRef and cross-plugin services need their own contracts and acceptance. External themes remain unavailable.

Restore/update/DEV/downgrade cannot bypass policy, native approval or target admission. Implemented portable-data APIs do not establish a complete product import/export UI.

### Planned local users, independent services and Web

- Host foundation: stable local-user IDs/display names, isolated libraries, explicit switching/deletion and cancellation of old source/playback/download/plugin contexts. Current single-profile settings do not implement this.
- Account-provider plugins: multiple systems, instances and accounts per local user; verified binding, explicit per-operation account selection, secure credentials and separate read/upload grants. Registration/password/email/recovery remain independent account-service business.
- Optional sync/sharing/report/remote-backup plugins: separate namespaces, services, retention and disablement. Disabling them preserves local music. One initial sync coordinator per data scope prevents conflicting providers and loops.
- Web/backend: extract Tauri-free host use cases and API adapters, then a separate browser entry. Server-verified external subjects map to trusted actors/library rights; caller profile IDs do not grant access. This is independent of optional cloud-service business.

The [deployment plan](../architecture/multi-user-local-cloud-plan.md) owns A01–J04 and dependencies. Local multi-user work does not wait for remote registration/mail/cloud deployment. Secret injection, private-network connections, private egress and cross-plugin services remain unopened capabilities pending their own acceptance; no change to Userscript/mobile external policy is implied.

## 5. Non-Functional Requirements

- Separate parsing, requesting, validation, mapping, pagination, state transitions, and playback.
- Use `Map`/`Set` for stable-ID lookup while arrays preserve user order.
- Never prefetch, copy, or sort entire large listings without measurement.
- Render every third-party cover with no Referer and a stable fallback.
- Bundle userscript dependencies with the installed script. Mount only the native launcher initially; execute Vue/Pinia, adapters, and heavy media modules on demand.
- Share colors, state semantics, navigation IDs, and headless contracts across runtimes while using platform-appropriate desktop and mobile shells. Responsive hiding is not mobile bundle pruning; verify runtime entries through actual build output.
- Keep operational errors in the shared catalog while retaining upstream diagnostics inside adapters.
- Never persist or document cookies, tokens, signatures, ephemeral URLs, media bytes, Blob URLs, proxy credentials, or final disk paths.

## 6. Definition of Done

A completed capability keeps platform fields out of unified models, enters explicit error/state-machine branches, terminates pagination, restores stable data, re-resolves ephemeral media, updates both language trees, and passes `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build`. UI acceptance identifies the requested runtime: Shadow DOM applies to Userscript, IPC/native saving to desktop. UI work also meets the keyboard, touch, theme, narrow-layout, reduced-motion, and Shadow DOM acceptance in [Cross-Platform UI and Interaction](../features/cross-platform-ui-and-interaction.md).
