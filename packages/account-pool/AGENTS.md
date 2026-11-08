# Portable account pool

- Own public account identity, platform/operation policies, random selection and account leases. Depend only on network-routing's portable executor.
- No music models, Vue, DOM, Node, GM, credentials, platform requests or persistence. A credentialKey is an opaque runtime reference, never a cookie/token.
- Delete, disable and authentication/configuration changes cancel old leases. Renaming does not interrupt valid work.
- Do not replay writes. Runtime classifies API failures and maps library exceptions to AppErrorState at the application boundary.
- Run package tests/typecheck and root gates. Current product integration belongs in apps/tauri, which injects native transport. The userscript retains one host account.
