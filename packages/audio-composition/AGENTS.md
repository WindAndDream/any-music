# Audio composition

- Keep the root entry pure TypeScript, without internal packages, Vue, DOM or media codecs.
- Export `src/browser` only through `/browser`. Do not read application libraries, GM, Tauri or network resources directly.
- Segments use stable source IDs and safe-integer millisecond ranges. Callers inject media reads. Complete encoding/decoding is for explicit export or the final playback fallback, never ordinary startup.
- Consumers map engine errors into their own business error catalog; do not introduce a core dependency cycle.
- Expose public APIs through package entries. Tests mirror `src/` under `test/`. Run package test/typecheck and root boundary checks.
