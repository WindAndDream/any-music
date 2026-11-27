---
documentType: module-contract
runtimeScope: shared
---

# Library, playback and downloads

[中文](../../../zh-cn/板块/资料库/文档索引.md)

The workbench owns canonical tracks, favorites, local playlists and managed tasks. The runtime injects stable-value storage and saving. Userscript isolates product values under `any-music:userscript:*`; Tauri uses native generation snapshots and its product mirror. Current library schema is 6 and downloads schema is 2. Host product data and per-plugin namespaces commit through their owning ports. See [data ownership](../plugins/data-ownership.md).

## Library and tags

- Playlists use `playlist:<uuid>` and store ordered stable track IDs. Platform collections remain source `TrackListing` values. Bulk actions operate on the complete filtered collection.
- `plugin-tag-management` owns user labels in `feature.tags`. NFKC, whitespace, length and case-insensitive deduplication apply at writes. Enabled sessions project editing, filtering and sorting into library pages. Disablement keeps associations and withdraws projections. Source labels remain core metadata.

## Creation and published tracks

The creation workspace is paused in both applications. Published tracks remain available through existing library references. See [creation workspace](creation-workspace.md) for material and recipe ownership.

## Related contracts

- [Playlists and portable transfer](playlists.md)

- [Playback history, Listen Later and downloads](history-and-downloads.md)
- [Custom recipes, chunked playback and export](custom-tracks.md)
- [Ordinary source media startup](../sources/media.md)
- [External source settings and native previews](../plugins/external-sources.md)
