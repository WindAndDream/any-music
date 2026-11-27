# Built-in music creation

- The creation workspace is paused in both products. This package retains drafts, material collections, pending order, renderless editing, neutral timeline controls and tests. Its optional Custom Music and Segment Creation contributions share one lifecycle. Published recipe assets remain host-owned.
- `Composer` is a renderless scoped-slot adapter with the public `MusicCreationPresentation` contract. Page layouts receive readonly editing projections, named actions and neutral controls, never namespace writes or session disposal. Publish remains a named host operation.
- Root metadata stays lightweight; Vue and sessions load only through /vue; the public /styles entry supplies neutral CSS values for application-owned Shadow surfaces. No workbench, private repository, app, native or network imports.
- Use named host ports for retaining tracks, publishing validated assets and explicit material cleanup. No player or playlist repository access.
- Every write and delayed event checks its session identity. Disable preserves data, cancels editing work and withdraws contributions; clearing data is a separate explicit action.
- The session owns transient editing cells for composer/material inputs and selection above presentation lifetime. Keep persisted drafts in the namespace; presentation remount must not replay draft writes. Reset transient editors only after successful explicit publish/clear, and dispose them with the owning session.
- Keep recipe validation and timeline algorithms in core/audio-composition. Follow root checks and no-launch policy.
