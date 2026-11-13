---
documentType: architecture
runtimeScope: shared
---

# Plugin Runtime Policy

Chinese counterpart: [插件运行策略](../../../zh-cn/跨平台/架构/插件运行策略.md).

Built-in identity comes exclusively from the application's build directory. Names, signatures and self-reported fields never establish that identity. Optional tag, creation and source modules share lifecycle/contribution management; required host modules cannot be disabled or removed.

Userscript fixes `externalPlugins: none` and constructs only shipped plugins. Its production graph excludes external installers, interpreters, VM/executor resources and anonymous public-network brokers. GM requests, single host account/proxy, document-start bridges and hide-preserves-session behavior remain runtime-owned.

Tauri obtains form, transport and external policy from `runtime_capabilities` before composition. Exact admitted desktop targets return `sandboxed`; other desktop targets return `declarative`, and mobile returns `none`. Native installation still rejects unadmitted targets. A policy string or renderer source projection cannot create installation/grant authority.

External packages use only `.amplugin`, native byte verification and explicit native consent. Supported declarative packages contain the current static catalog; code catalogs execute in the fixed VM/Profile with named native ports. Catalogs currently provide no media resolution. Current package previews accept bounded package bytes only; JSON source installation and archive management do not exist.

The source registry receives built-ins and native-verified runtime projections. It cannot install raw manifests. Policy applies before source registration and at activation, enablement, availability, media and prefetch. Replacing a native generation disposes old cursors and media lifetimes. External catalogs cannot enter background media prefetch.

Built-in HTTP uses its owning GM/Rust transport with included credentials. Generic guest networking remains anonymous behind the native Gate and bounded target/budget/revocation checks. Separately admitted [declarative source gateways](../../desktop/source-authentication.md) use source-owned native credentials and explicit source/network consent; they do not establish product-user/account-system bindings. Native built-in source adapters own account-bound media grants; the renderer does not re-register arbitrary URLs anonymously.

Use [S15 capability/admission evidence](plugin-system-s15-tools-and-desktop-delivery.md) and [S16 mobile engineering](plugin-system-s16-mobile-delivery.md) for actual support. Unit/build checks do not establish live GM, WebView or device acceptance.

The [future local-user/service proposal](multi-user-local-cloud-plan.md) assigns independent accounts, cloud synchronization, sharing and reports to optional plugins/services. It grants no present authority: secret injection, private-service connections, private-data egress and cross-plugin services need separately versioned capabilities and runtime acceptance. Local profile switching and verified binding authority remain host responsibilities; current anonymous networking and Userscript/mobile restrictions stay in force.
