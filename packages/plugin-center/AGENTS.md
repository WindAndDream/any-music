# Plugin center

- Root is a framework-free generic catalog without music models, Vue, network or storage.
- controller/registry/dependencies/allocator own lifecycle, static contributions, service dependencies and pure allocation. Separate instances from descriptors. Applications inject trusted built-ins; the framework itself supplies no external install/execution authority.
- Required providers cannot be disabled/replaced. Async activation and command results check installation identity/generation. Keep recovery independent of registration/allocation; native policy ports consume authority results without creating grants here.
- `src/music-sources` may depend on core; runtimes inject construction factories.
- Catalog installation registers identity only, without domain permissions or arbitrary code execution. Applications own permission workflows.
- Availability results check instance/request tokens. Failures allow retry; removal/reinstallation must reject stale results.
- Tests mirror source under `test/`; application composition regressions stay in apps.
- music adapters own task generations, cancellation and media-release barriers. Disablement, invalidation, removal and disposal terminate old work. Re-enabling never restores old listings/leases. Generic root does not inherit music behavior.
- music registry takes explicit externalPlugins. none blocks construction during restore, and also gates install/enable/check/media/prefetch. Only build-injected instances define built-in identity; ignore manifest/factory builtIn, provenance or signatures. This package owns no external-code permission authority or new install transaction.
- setRuntimeSources accepts trusted runtime projections of verified installs without assigning built-in identity. Generation replacement cleans up old lifecycles first; none constructs no external instances. Generic root remains free of music/runtime dependencies.
