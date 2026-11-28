---
documentType: future-plan
runtimeScope: shared
status: proposed
---

# Plugin, source and native host list consumers

[中文](../../../zh-cn/计划/未来/宿主虚拟列表消费方.md)

**Proposed.** Preserve protected account/authorization surfaces, native option semantics and installed identities. Classify fixed short controls by their real bound. For example, the eight chosen backup proxies and the growing available-proxy directory have separate scopes.

| Batch | Consumer                                                       | Behavior to verify                                                                                                         |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| C30   | Classic `ClassicPlugins` directory                             | Filtering, enabled state and configuration opening; no guest execution on virtual mount.                                   |
| C32   | Host `NativePluginInstallList` install directory               | Keep exact install identity and native consent authority. Bounded previews retain their existing limits; commands are C48. |
| C33   | Tauri `AccountList` directory                                  | Virtualization must not close account editing or expose secrets to themes; nested selectors are separate steps.            |
| C34   | Host `ProxyManagementList`                                     | Preserve proxy identity, validation and protected state; picker branches are separate steps.                               |
| C41   | Tauri `AccountSwitchDialog` options                            | Keep current/disabled identity, keyboard focus and close/confirmation behavior.                                            |
| C42   | Tauri `AccountPolicyForm` available-account checklist          | Full backup/failover policy selection and explicit save semantics.                                                         |
| C43   | Tauri `AccountConnectionForm` main-proxy directory             | Preserve the selected connection and draft validation; no native writes on remount.                                        |
| C44   | Tauri `AccountConnectionForm` available-backup-proxy directory | The directory can grow despite the eight-chosen-backups cap; preserve limits and ordering.                                 |
| C45   | Host `ContributionInputDialog` option directory                | Search over all options, retain selection and input/IME, and preserve origin-bound confirmation.                           |
| C46   | Host `NativePluginCommandResult` text-item branch              | Preserve complete ordered bounded output; justify a short-output exclusion from actual protocol/runtime limits.            |
| C47   | Host `NativePluginCommandResult` suggestion branch             | Preserve provenance, item identity and explicit annotation actions; no authority change.                                   |
| C48   | Host `NativePluginInstallList` nested command directory        | Preserve command/install identity and consent gates independently of parent-directory virtualization.                      |
| C62   | Classic `MusicSourcePickerDialog` source directory             | Two fixed group headings do not bound their source directories; reselecting the current source only closes the dialog.     |
| C63   | Classic `MusicSourceSettings` source directory                 | Preserve external-source state and host operations; fixed groups do not bound their members.                               |
| C67   | Tauri `AccountPlatformList` account platform directory         | Native source identities are extensible; the two built-ins do not justify exclusion. Keep host authority.                  |
| C70   | Classic `PlayerSettingsDialog` quality directory               | Source candidates have no enforced count limit; investigate actual cost and preserve quality selection/playback lifetime.  |

Use the [recorded branch inventory](../../../baselines/virtual-lists/2026-11-03-p00-p03/collection-surfaces.json) to locate candidate callers. Recheck current source and select one reusable batch before editing.
