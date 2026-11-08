# @any-music/plugin-testkit 0.1.0

Runs guest source text in the exact locked Any Music QuickJS VM. Guest tests are never
imported into Node. `createTestVm()` exposes `run(source, json, signal, 'module')` for a
single ESM module exporting a default function, plus disposal and pending-handle counts.
`runGuestTest(body, json)` runs a function body. Instances are ephemeral after each run.

The package embeds the reviewed production VM, WASM, Profile manifest and engine licenses.
It grants no product, network, account or native storage authority. Deterministic fixtures
are JSON. Production target isolation, native authorization and device acceptance remain
independent gates. SDK, CLI and testkit 0.1.0 support wire/Profile/package/data version 1.

MIT applies to the tool wrapper; retain the bundled QuickJS/binding licenses. Use the public SDK /host runGuestProgram with createTestVm for each fresh continuation realm; inject named fixture ports outside the VM. Production/native permission checks and exact target admission are not replaced by these fixtures. See the bilingual S15 delivery record and off-repository release-artifact evidence.
