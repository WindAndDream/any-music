# Plugin CLI

- Node-only author tooling; never import guest entries, tests, configuration or hooks into Node. JSON metadata is bounded and validated with the public SDK.
- Use the fixed Vite library build, a single ESM guest entry and the production testkit. No automatic dependency installation, server, application or browser launch.
- All source reads stay in the selected directory identity; links, key files and unapproved imports fail closed. Sealed package bytes are the only DEV payload.
- Keep diagnostics structured, stdout machine-readable and secrets out of logs. Signing keys are explicit local inputs, never project assets.
- Test public packed tools outside the repository; production applications must never depend on CLI/testkit. Target admission and native host approval cannot be overridden by CLI flags.
