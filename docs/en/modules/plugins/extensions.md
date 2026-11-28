---
documentType: module-contract
runtimeScope: shared
---

# Plugin lifecycle, contributions and allocation

[中文](../../../zh-cn/板块/插件/贡献与扩展.md)

`plugin-center` owns data-only descriptors, registration, dependency and lifecycle coordination, and allocation. A distribution package can contain modules. Modules own versioned contributions; a host allocator matches them to typed points under trust, scope and cardinality rules. A mounted view or track row is a use of a definition with its own disposal scope. Tracks and playlists stay in the domain.

## Assembly and failure recovery

1. Applications assemble required host modules and the optional build-known tag, creation and source modules from lightweight metadata. The built-in origin comes from the build directory. The Plugin Center is a view over this running system.
2. Registration validates owner, contribution/point IDs, contract version, supported implementation type and scopes. Required incompatible dependencies block activation of affected modules. Lazy activation coalesces concurrent work, retries failed loads and publishes only the current generation.
3. The allocator derives deterministic assignments and reasons for rejection. Use controlled inputs and named host commands for interaction. Revocation or disablement disposes registrations, effects, data projections and old async work; retained storage stays in its owner. The minimal recovery surface can restore defaults without mounting a failing feature.
4. The stable workbench keeps library, playback, download and editor lifetimes. `plugin-ui-vue` binds the allocated views and trusted theme renderers. Themes share public UI contracts and stable view IDs. The host owns login, authorization, install/rollback, native saving and recovery surfaces.

## Protocol and native boundary

The SDK owns versioned schemas and generated TypeScript/Rust validation. Wire, Profile, package, data, budget and contribution versions are separate. Check known points/capabilities before execution. Required unknown features fail; optional ones remain unallocated. Renderer preferences and signed package metadata cannot grant native authority.

Native external packages use the currently admitted catalog and named command surfaces in [desktop delivery](desktop-delivery.md). The same source picker displays the verified catalog and built-ins. Media, external theme assembly, arbitrary Vue/component replacement and protected UI are unavailable to external packages. See [independent themes](../ui/themes.md), [native authority](native-authority.md) and [external expansion proposal](../../plans/future/external-plugin-expansion.md) for their respective scopes.
