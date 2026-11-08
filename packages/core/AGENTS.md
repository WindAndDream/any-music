# Music domain and ports

- Own music models, business validation, AppError, download concurrency/retry and platform capability contracts. Applications inject implementations of `src/ports`.
- Depend only on pure audio-composition entries. No Vue, DOM, Node, GM, Tauri or audio `/browser`. Cancellation/retry waits use platform-independent contracts.
- audio-composition owns recipe/timeline algorithms. Adapt music leaf validation, music-specific APIs and AppError without duplicating the engine.
- HostLocalMusicLibrarySnapshot/PublishedCustomTrackAsset express host persistence without plugin tags, material collections or compiled caches. LocalMusicLibrarySnapshot is the compiled host runtime view. Host library reads do not join creation associations or user tags; tag rules belong to their plugin, without a second state store.
- Allocate `AppError` codes and `AM-*` status codes in one catalog; never reuse published codes. Persist only `AppErrorState`, without stack/cause.
- Colocate types with domain modules and export through `src/index.ts`. Mirror source paths under `test/`. Start with `pnpm --filter @any-music/core test` and `pnpm --filter @any-music/core typecheck`.

- The product is unreleased: implement the current architecture directly. Do not add compatibility packages, previous product-schema readers, source JSON importers, archive UI or duplicate IPC aliases. Current plugin upgrade/rollback and crash recovery remain supported.
