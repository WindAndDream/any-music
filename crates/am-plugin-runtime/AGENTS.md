# Native plugin authority

- The runtime owns identity, contexts, provenance, reservations and commit/revoke ordering through an injected transactional `Store`, `Clock` and `Ids`. No Tauri, SQLite, HTTP, filesystem, accounts or global clock dependencies.
- A `Caller` is supplied by the native adapter from its real channel/document/account scope. Never deserialize it from plugin messages. Only trusted host code can create sessions/contexts; package activation follows verified transactions and exact target admission/native approval.
- Every operation rechecks installation identity, epoch, lifetime and selected object/version. Commit and revocation share the same durable transaction. Unknown provenance is L2; labels survive host forwarding and retained history cannot be lowered by reinstall.
- Public DB models support the persistence adapter, not a renderer installation API. Product install/rollback consumes native-verified candidates and explicit consent; production exposes no fixture seed or arbitrary grant/session command. Test fixtures write records through test-owned stores only.
- Keep integration tests in `tests/`; exercise the same runtime with the application's SQLite adapter. Tests require no network or UI launch.

- Own native network grant/exit/audit records and combined data checks. Finished requests retain cumulative session costs, imported/retained history cannot be lowered, and final application sink delivery shares the revoke barrier. Runtime remains free of HTTP/DNS/clock/DB implementations.

- Verified host installation uses preview identity/epoch/revocation/history bindings and an injected InstallFiles port. Candidate records come from native package verification, never IPC deserialization. Publish complete code/data before committed pointers. Suspend old instances during copy migration; rollback/erasure cannot restore rights, epochs or forget security history. host_package_session revalidates every pair and returns owned verified bytes; host_session rejects committed external packages. Product commands and executor relay belong to the application, not this crate.
