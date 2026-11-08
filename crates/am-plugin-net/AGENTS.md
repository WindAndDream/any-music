# Anonymous plugin transport

- Follow crates/AGENTS.md and the desktop backend guide. This IO crate is separate from pure protocol/policy/runtime; no Tauri, accounts, vault, CDP or installation authority.
- Public targets use the versioned conservative address policy, all DNS answers are checked and connections bind a verified address with original-host TLS. Never enable environment proxies, automatic redirect/retry, pooled cross-subject connections or certificate bypass.
- All exits use a native Gate, cumulative budgets and cancellation, including resource Range reads. Unsafe proxy routes fail closed. Test-only loopback TLS wiring must never be a production option.
- Tests live in tests/; local controlled backends do not require UI/browser launch. Package activation follows native approval and exact target admission; transport tests alone do not establish either.
