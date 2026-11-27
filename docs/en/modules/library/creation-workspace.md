---
documentType: module-contract
runtimeScope: shared
---

# Creation workspace and material ownership

[中文](../../../zh-cn/板块/资料库/创作工作区.md)

Userscript and Tauri currently omit the creation workspace. The retained `feature.composer` module owns the Custom Music and Segment Creation contributions, material and draft logic. Existing published tracks remain playable and downloadable through the host wherever already referenced.

## Materials, drafts and published tracks

- `plugin-music-creation` owns draft, pending-material and collection state in its namespace. The host owns canonical source tracks and published tracks. The plugin reads and writes through named ports.
- Clipping stages a track in the persisted pending-material area. Choosing a `material-collection:<uuid>` adds the track by stable ID and removes it from pending in the same state update. One track may belong to more than one collection. Every direct ingredient for a new recipe belongs to the selected collection.
- Saving creates a host-owned published track and adds it to the creation collection. [Recipe compilation](custom-tracks.md) resolves nested references to leaf media. Removing a collection member used by one of its works fails with a conflict.
- Deleting a collection with works requires explicit cascade. The host rejects deletion if another recipe still references one of the works. Keep source tracks referenced by favorites, playlists, other collections, recipes, the current draft or the pending-material area.

The shared [recipe and playback contract](custom-tracks.md) also covers published tracks imported from playlists.
