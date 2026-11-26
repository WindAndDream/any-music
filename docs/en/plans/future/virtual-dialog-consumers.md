---
documentType: future-plan
runtimeScope: shared
status: proposed
---

# Dialog, picker and filter list consumers

[中文](../../../zh-cn/计划/未来/弹窗虚拟列表消费方.md)

**Proposed.** Retain each control's editing session and focus return. Derive the desired window from the actual dialog scroll root and data. Reuse [UI primitives](../../modules/ui/virtual-lists.md).

| Batch | Consumer                                                         | Behavior to verify                                                                                                               |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| C06   | Classic `ReadonlyTrackCollection` callers                        | Drawer/editor lists retain the selected identities, full counts and original action availability.                                |
| C07   | Studio `StudioReadonlyTracks` callers                            | Both native table and styled-card presentations; focus back to the originating dialog.                                           |
| C16   | Classic `PlaylistPickerPanel` callers                            | Query, multi-selection, counts, keyboard focus and dialog-close drafts.                                                          |
| C17   | Studio `StudioPlaylistPicker` callers                            | Picker query/selection survive filters and table/card layout as currently supported.                                             |
| C18   | Classic `ReadonlyPlaylistCollection` callers                     | Same validation/selection and controlled navigation, including long dialog lists.                                                |
| C19   | Studio `StudioReadonlyPlaylists` callers                         | Its independent controls and focus restoration, without importing Classic.                                                       |
| C35   | Classic `CatalogFilterHistoryList`                               | History application/removal, variable range summaries and nested scroll boundaries.                                              |
| C36   | Classic `CatalogTrackFilterEditor` tag-option branch             | Full tag filtering/counts and existing control semantics; assign C51+ to independent callers with different scrolling contracts. |
| C37   | Classic `CatalogTrackFilterEditor` source-option branch          | Complete source selection; constant calendar/dimension groups remain separately classified.                                      |
| C38   | Studio `StudioFilters` tag-option branch                         | Keep draft selection across virtual unmount/remount without writing preferences early.                                           |
| C39   | Studio `StudioFilters` retained-history branch                   | Preserve applying/removing an entry and variable filter summaries; this is not the constant settings-dimension table.            |
| C40   | Studio `StudioFilters` source-option branch                      | Preserve all eligible sources and full-selection semantics.                                                                      |
| C49   | Studio `StudioFavoriteFilters` source-option branch              | Preserve favorite-specific draft and apply semantics; static text fields stay unchanged.                                         |
| C50   | Classic `PlaylistOverviewFilterEditor` tag-option branch         | Preserve playlist-specific tag statistics, query and draft application independently of track filters.                           |
| C59   | Classic `CatalogTrackActionsDialog` tag choices                  | Preserve the full directory and original-track confirmation in this independent dialog, beyond C36.                              |
| C60   | Classic `PlaylistEditorDialog` tag directory                     | Preserve drafts, IME input and tag-detail navigation.                                                                            |
| C61   | Studio `StudioPlaylistActions` tag directory                     | Preserve the independent theme editor and explicit commit.                                                                       |
| C69   | Classic `CollectionFilterChoices` tag-management platform caller | Only `TagManagementFilters` has dynamic platform choices; other production callers use fixed enums.                              |

Use the [recorded branch inventory](../../../baselines/virtual-lists/2026-11-03-p00-p03/collection-surfaces.json) to locate candidate callers. Recheck current source and select one reusable batch before editing.
