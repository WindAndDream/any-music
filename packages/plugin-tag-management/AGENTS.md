# Built-in tag management

- Own user-tag rules, associations, state, namespace adapter, renderless editor adapters, neutral specialist controls and tests. Source tags remain Track metadata. Whole-page classic layouts and page CSS belong to theme-default.
- `Panel` is a renderless scoped-slot adapter. Its public `TagManagementPresentation` exposes readonly projections, named editing actions and bounded neutral controls; it never exposes session disposal or namespace storage. The host binds events to the originating session.
- Root exports lightweight metadata/contributions; `/vue` is lazy and `/styles` exports neutral CSS for application-owned Shadow resources. No app, workbench, private repository, network or native imports.
- Consume named host ports and UI public exports. Disabled/disposed sessions reject old events. No delayed writes or replay on re-enable.
- Each session owns its transient filters, maintenance inputs and per-track tag drafts above presentation lifetime. These editing cells never enter association snapshots or host library storage; presentation disposal does not dispose the session.
- Tests mirror src in test. Run package checks, both consumer builds and root gates. Follow the root no-launch rule.
