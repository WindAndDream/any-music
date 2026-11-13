# Collection card styles

- Own reusable, controlled item presentation for music and playlist cards. Metadata at `.` stays free of Vue/styles; `/vue` contains components and presentation context.
- Depend only on public UI primitives/contracts and core types. Never import themes, workbench, apps, repositories, dialogs or runtime APIs.
- Cards emit named intents. Playback position, selection, errors and availability are readonly inputs; cards never start media, persist preferences or create timers.
- Use semantic `--am-*` tokens, no-referrer images, keyboard/touch alternatives and reduced-motion rules. Keep styles local to card components.
- Put tests in `test/` mirroring `src/`. Node component tests do not establish visual or runtime acceptance.
