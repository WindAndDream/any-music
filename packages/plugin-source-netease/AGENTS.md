# Built-in NetEase Cloud Music source

- Own lightweight metadata, URL validation, official API DTOs, mapping and lazy listings. Root exports no protocol implementation; load `/runtime` on use.
- Consume public core/plugin-center contracts only. Inject HTTP; no Node, Vue, GM, Tauri, cookies or host fetch. Built-in requests explicitly include credentials.
- Keep provider ID `netease`, module ID `source.netease` and stable song IDs. Never synthesize playable URLs or infer actual quality from requested quality.
- Page complete playlist track IDs in bounded batches, preserving order. Stop/cancellation must prevent later requests. Media URLs remain session-only.
- Use `$music-source-adapter`; runtime adapters follow their application's guide. Tests live in `test/`. Live browser/application inspection needs explicit user direction.
