# Plugin SDK

- Public shared ESM contracts. Root and `/music` have no core, Vue, Node, DOM, runtime or engine dependency and expose no trusted service/theme tokens.
- `schema/v1` owns DTOs; `schema/registry.json` separately registers Manifest, wire, contribution, Profile, package, data and budget versions. Change Schema/corpus first, then run `pnpm --filter @any-music/plugin-sdk generate`. Never hand-edit `src/generated`.
- `/schema` uses build-generated standalone validators and bounded parsers only. No remote `$ref`, guest-supplied Schema, runtime AJV/eval/Function. Decode untrusted bytes before validation.
- music-workbench owns core/wire conversion. SDK defines serializable data, named ports and compatibility negotiation, without authorization authority, transport or sandbox implementation.
- `test/fixtures/corpus` stores raw positive/negative JSON shared with Rust. Pure SDK tests do not establish QuickJS testkit or isolation acceptance.
- integrity/signature/revocation DTOs use the same Schema. `test/fixtures/packages` holds raw package corpus and public signature vectors. Node verification stays outside browser root entries. Sign the fixed domain prefix plus original directory bytes; fixture generation keeps temporary private keys only in memory, never files/logs.
- `/node` is a Node-only verifier shared by scripts and CLI. Root, `/music` and browser Schema must not load it eagerly. Build rewrites local Schema references; standalone tests cover actual published exports.
- `/guest` produces GuestStep DTOs; `/host` validates/dispatches explicit ports only. The runtime must execute each continuation in a fresh realm and authorize every step; SDK helpers grant nothing. Schema changes regenerate TS/Rust together. Host glue does not automatically change the kernel Profile.
