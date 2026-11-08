# @any-music/plugin-sdk 0.1.0

MIT-licensed public ESM contracts with no runtime dependencies. Locally packable; not published to npm.

- Root: Manifest, named requests/responses, compatibility and injected ports. No trusted service/theme tokens.
- /music: serializable tracks/listings/pages/media references and named provider ports.
- /schema: bounded JSON and generated standalone validators, without runtime AJV/eval.
- /node: Node-only bounded package/integrity/Ed25519 validation shared with CLI.
- /guest: complete/requestHost helpers returning GuestStep DTOs, never a host function.
- /host: runGuestProgram validates named continuations and dispatches an injected HostPort; the host must supply authorization, deadlines, cancellation and a fresh admitted VM for each step.

GuestInvocation/GuestStep are generated from schema/v1. commandId carries the host-bound declared command, independently of inputJson; command names never grant authority or classify input provenance. No live object, function or Promise crosses into the guest. Production Tauri authorizes each request natively; SDK helpers grant nothing. The public testkit embeds the production QuickJS engine/Profile without a private workspace dependency. The independent standalone host consumes only public SDK/testkit artifacts.

Bounded JSON: 256 KiB UTF-8, depth 32, 10,000 nodes and 65,536 scalar values/string; canonical decimal safe integers only. Duplicate/dangerous keys, unknown fields, custom prototypes, accessors, sparse arrays and non-JSON values fail. Decode untrusted bytes before schema validation.

CLI/SDK/testkit 0.1.0 support wire/Profile/package/data/budget 1. No predecessor wire major exists; previous-major migration support is at least 180 days after a successor stable release, except security revocation. Required incompatibilities fail closed. Actual native target/capability admission is separate from tool compatibility.

From repository root run generate, generate:check, test and check:package with pnpm --filter @any-music/plugin-sdk. pnpm check:plugin:tools verifies real standalone tarballs and bundled templates outside the repository, without publishing or launching an application.

Declarative music sources can declare `sourceAuthentication` with QR, credentials, SMS phone methods and an explicit no-login policy. Schema excludes system-browser authentication for external packages. The host owns token storage and injection; the generic guest network API remains anonymous. See [Music Source Authentication](../../docs/en/desktop/source-authentication.md).

See the [S15 delivery and capability matrix](../../docs/en/cross-platform/architecture/plugin-system-s15-tools-and-desktop-delivery.md) and its Chinese counterpart. music-workbench still owns core/wire conversion; SDK never depends on core, Vue, Node through its root entry, or a runtime.
