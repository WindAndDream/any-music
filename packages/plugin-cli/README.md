# am-plugin 0.1.0

Node 24.11+, ESM author tooling for SDK/testkit 0.1.0 and wire/Profile/package/data 1.
The previous wire major receives at least 180 days after a successor stable release;
wire 1 has no predecessor. Security revocation may shorten support.

`create <dir> --template source-code|source-declarative|source-gateway|tag-suggestion|export` creates a
versioned project without installing dependencies. Run `doctor`, `check --target desktop`,
`test --profile desktop`, `pack --reproducible`, `inspect <file>`, `verify <file>`,
`permissions diff <old> <new>`, `sign <file> --key <file> --output <file>`, and
`migrate check --from <fixture> --to <file>`. Pass `--project <dir>` for project commands.
All results use JSON stdout; diagnostics never include keys, tokens or upstream bodies.
Exit codes: 0 success, 1 validation/test failure, 2 arguments/configuration, 3 environment,
4 incompatible target, 130 cancelled. `--yes` cannot authorize the native host.

Only static JSON config is supported. Builds use a fixed Vite graph sealed from selected
project files; no project hooks, loaders, Vite config, .env or Node guest imports run.
The initial release accepts local pure sources, erased SDK type imports and runtime /guest helpers. `pack` runs
a fixed VM smoke; `test` compiles the test entry into that same VM. Code on mobile fails
closed pending device admission. Local source maps are not emitted by this version.

`dev --pairing-file <file>` requires a host-created current-user pairing file, watches
without following links and sends sealed packages over the authenticated local endpoint.
It never starts the product/browser. Host approval and production admission remain gates.
Unverified self-signatures are explicitly unverified publishers. No marketplace/publish
command is provided. Build tools execute in the developer's Node environment; the guest
VM is the execution boundary. Install dependencies explicitly with scripts disabled and
use a resolved frozen lockfile in CI.

The tools use MIT; bundled engine licenses remain intact. DEV requires host approval for every immutable reload, uses independent native DB/code/data/profiles and changes the permission epoch. Disconnect/end revokes DEV grants; no product data/Cookies are inherited.

Source templates register metadata catalogs in the workbench source picker. `source-gateway` preserves versioned QR/credential/SMS declarations in the final `.amplugin`; the host handles the fixed API gateway without guest access to tokens. See [Music Source Authentication](../../docs/en/desktop/source-authentication.md) for endpoints, consent and current desktop admission limits. Code catalogs can optionally read a public HTTPS JSON catalog (64 KiB, anonymous, request/read/release) and consume 20-item pages on demand. Grant confirmation is native. Tag suggestions write only their own namespace; exports use the native save dialog. Audio resolution is explicitly unavailable; no guest URL is loaded by the product. Unsupported required capabilities/extensions fail; optional ones remain unavailable. SDK /host allows an independent host to execute the same named continuation contract in the same testkit VM.

See the bilingual S15 record and docs/baselines/plugin-system-s15 compatibility, SBOM and real desktop evidence. Unknown OS/WebView/Profile/resource combinations cannot activate code. Mobile remains S16.
